-- ============================================================================
-- SONROJA ERP — 005 Compras
-- Órdenes de compra (PO-folio), recepciones parciales -> movimientos PURCHASE.
-- Flujo: DRAFT -> SENT -> PARTIAL -> RECEIVED -> COMPLETED | CANCELLED
-- ============================================================================

create table if not exists public.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folio           text not null,
  supplier_id     uuid not null references public.suppliers(id),
  warehouse_id    uuid not null references public.warehouses(id),
  status          text not null default 'DRAFT' check (status in ('DRAFT','SENT','PARTIAL','RECEIVED','COMPLETED','CANCELLED')),
  expected_date   date,
  subtotal        numeric(12,2) not null default 0,
  tax_amount      numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  notes           text,
  created_by      uuid,
  sent_at         timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  cancelled_by    uuid,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists uq_po_folio on public.purchase_orders (organization_id, folio);
create index if not exists idx_po_org_status on public.purchase_orders (organization_id, status, created_at desc);
create index if not exists idx_po_supplier on public.purchase_orders (supplier_id, created_at desc);
create trigger trg_po_updated before update on public.purchase_orders for each row execute function public.set_updated_at();

create table if not exists public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id        uuid not null references public.products(id),
  variant_id        uuid references public.product_variants(id),
  quantity          int not null check (quantity > 0),
  received_quantity int not null default 0,
  unit_cost         numeric(10,2) not null check (unit_cost >= 0),
  line_total        numeric(12,2) generated always as (quantity * unit_cost) stored
);
create index if not exists idx_po_items on public.purchase_order_items (purchase_order_id);

create table if not exists public.purchase_receipts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  folio             text not null,
  purchase_order_id uuid not null references public.purchase_orders(id),
  warehouse_id      uuid not null references public.warehouses(id),
  received_by       uuid,
  received_at       timestamptz not null default now(),
  invoice_number    text,
  notes             text
);
create unique index if not exists uq_receipts_folio on public.purchase_receipts (organization_id, folio);
create index if not exists idx_receipts_po on public.purchase_receipts (purchase_order_id);

create table if not exists public.purchase_receipt_items (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.purchase_receipts(id) on delete cascade,
  po_item_id      uuid not null references public.purchase_order_items(id),
  product_id      uuid not null references public.products(id),
  variant_id      uuid references public.product_variants(id),
  quantity        int not null check (quantity > 0),
  unit_cost       numeric(10,2) not null
);
create index if not exists idx_receipt_items on public.purchase_receipt_items (receipt_id);

-- Recalcula totales de la orden (precio sin IVA en compras; IVA según tasa por defecto)
create or replace function public.recalc_purchase_order(p_po uuid)
returns void language plpgsql set search_path = public as $$
declare v_sub numeric; v_rate numeric; v_org uuid;
begin
  select organization_id into v_org from public.purchase_orders where id = p_po;
  select coalesce(sum(line_total), 0) into v_sub from public.purchase_order_items where purchase_order_id = p_po;
  select coalesce(rate, 0) into v_rate from public.tax_rates where organization_id = v_org and is_default;
  update public.purchase_orders set subtotal = v_sub, tax_amount = round(v_sub * coalesce(v_rate, 0), 2), total = round(v_sub * (1 + coalesce(v_rate, 0)), 2) where id = p_po;
end $$;

create or replace function public.po_items_after_write()
returns trigger language plpgsql set search_path = public as $$
begin
  perform public.recalc_purchase_order(coalesce(new.purchase_order_id, old.purchase_order_id));
  return null;
end $$;
drop trigger if exists trg_po_items_after_write on public.purchase_order_items;
create trigger trg_po_items_after_write after insert or update or delete on public.purchase_order_items for each row execute function public.po_items_after_write();

-- Crea una orden con partidas en una transacción. p_items: [{product_id, variant_id, quantity, unit_cost}]
create or replace function public.create_purchase_order(
  p_org uuid, p_supplier uuid, p_warehouse uuid, p_expected date, p_notes text, p_items jsonb, p_user uuid
) returns public.purchase_orders language plpgsql set search_path = public as $$
declare po public.purchase_orders; e jsonb;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'SIN_PARTIDAS'; end if;
  insert into public.purchase_orders (organization_id, folio, supplier_id, warehouse_id, expected_date, notes, created_by)
  values (p_org, public.next_folio(p_org, 'PO', 'PO'), p_supplier, p_warehouse, p_expected, p_notes, p_user) returning * into po;
  for e in select * from jsonb_array_elements(p_items) loop
    insert into public.purchase_order_items (purchase_order_id, product_id, variant_id, quantity, unit_cost)
    values (po.id, (e->>'product_id')::uuid, nullif(e->>'variant_id','')::uuid, (e->>'quantity')::int, (e->>'unit_cost')::numeric);
  end loop;
  select * into po from public.purchase_orders where id = po.id;
  perform public.audit_log(p_org, p_user, 'purchases.create', 'PURCHASE_ORDER', po.id::text, null, to_jsonb(po));
  return po;
end $$;

-- Reemplaza las partidas de una orden en borrador
create or replace function public.update_purchase_order(
  p_po uuid, p_supplier uuid, p_warehouse uuid, p_expected date, p_notes text, p_items jsonb, p_user uuid
) returns public.purchase_orders language plpgsql set search_path = public as $$
declare po public.purchase_orders; before_j jsonb; e jsonb;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if po.id is null then raise exception 'NOT_FOUND'; end if;
  if po.status not in ('DRAFT','SENT') then raise exception 'ESTADO_INVALIDO: solo se editan órdenes en borrador o enviadas'; end if;
  before_j := to_jsonb(po);
  delete from public.purchase_order_items where purchase_order_id = p_po;
  for e in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.purchase_order_items (purchase_order_id, product_id, variant_id, quantity, unit_cost)
    values (p_po, (e->>'product_id')::uuid, nullif(e->>'variant_id','')::uuid, (e->>'quantity')::int, (e->>'unit_cost')::numeric);
  end loop;
  update public.purchase_orders set supplier_id = coalesce(p_supplier, supplier_id), warehouse_id = coalesce(p_warehouse, warehouse_id),
         expected_date = p_expected, notes = p_notes where id = p_po;
  perform public.recalc_purchase_order(p_po);
  select * into po from public.purchase_orders where id = p_po;
  perform public.audit_log(po.organization_id, p_user, 'purchases.update', 'PURCHASE_ORDER', po.id::text, before_j, to_jsonb(po));
  return po;
end $$;

create or replace function public.set_purchase_order_status(p_po uuid, p_status text, p_user uuid, p_reason text default null)
returns public.purchase_orders language plpgsql set search_path = public as $$
declare po public.purchase_orders; before_j jsonb;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if po.id is null then raise exception 'NOT_FOUND'; end if;
  before_j := to_jsonb(po);
  if p_status = 'SENT' then
    if po.status <> 'DRAFT' then raise exception 'ESTADO_INVALIDO: solo un borrador se puede enviar'; end if;
    if not exists (select 1 from public.purchase_order_items where purchase_order_id = p_po) then raise exception 'SIN_PARTIDAS'; end if;
    update public.purchase_orders set status = 'SENT', sent_at = now() where id = p_po;
  elsif p_status = 'COMPLETED' then
    if po.status not in ('RECEIVED','PARTIAL') then raise exception 'ESTADO_INVALIDO: solo se completa una orden recibida'; end if;
    update public.purchase_orders set status = 'COMPLETED', completed_at = now() where id = p_po;
  elsif p_status = 'CANCELLED' then
    if po.status in ('COMPLETED','RECEIVED') then raise exception 'ESTADO_INVALIDO: una orden recibida no se puede cancelar'; end if;
    if exists (select 1 from public.purchase_order_items where purchase_order_id = p_po and received_quantity > 0) then
      raise exception 'ESTADO_INVALIDO: ya hay mercancía recibida; completa la orden en lugar de cancelarla';
    end if;
    update public.purchase_orders set status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_user, cancel_reason = p_reason where id = p_po;
  else
    raise exception 'ESTADO_INVALIDO: %', p_status;
  end if;
  select * into po from public.purchase_orders where id = p_po;
  perform public.audit_log(po.organization_id, p_user, 'purchases.status.' || lower(p_status), 'PURCHASE_ORDER', po.id::text, before_j, to_jsonb(po), jsonb_build_object('reason', p_reason));
  perform public.resolve_notifications_by_key(po.organization_id, 'po:' || po.id::text);
  return po;
end $$;

-- Recepción (total o parcial). p_items: [{po_item_id, quantity, unit_cost?}]. Sin p_items = recibe todo lo pendiente.
create or replace function public.receive_purchase_order(
  p_po uuid, p_user uuid, p_items jsonb default null, p_invoice text default null, p_notes text default null
) returns public.purchase_receipts language plpgsql set search_path = public as $$
declare po public.purchase_orders; r public.purchase_receipts; it record; v_qty int; v_cost numeric; v_pending int; v_all_received boolean; v_cost_method text;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if po.id is null then raise exception 'NOT_FOUND'; end if;
  if po.status not in ('SENT','PARTIAL') then raise exception 'ESTADO_INVALIDO: la orden debe estar enviada para recibirla'; end if;

  insert into public.purchase_receipts (organization_id, folio, purchase_order_id, warehouse_id, received_by, invoice_number, notes)
  values (po.organization_id, public.next_folio(po.organization_id, 'REC', 'REC'), po.id, po.warehouse_id, p_user, p_invoice, p_notes) returning * into r;

  select coalesce(value->>'cost_method', 'LAST') into v_cost_method from public.organization_settings where organization_id = po.organization_id and key = 'inventory';

  for it in select * from public.purchase_order_items where purchase_order_id = p_po for update loop
    v_pending := it.quantity - it.received_quantity;
    if p_items is null then
      v_qty := v_pending; v_cost := it.unit_cost;
    else
      select (e->>'quantity')::int, coalesce((e->>'unit_cost')::numeric, it.unit_cost) into v_qty, v_cost
        from jsonb_array_elements(p_items) e where (e->>'po_item_id')::uuid = it.id;
      v_qty := coalesce(v_qty, 0); v_cost := coalesce(v_cost, it.unit_cost);
    end if;
    if v_qty < 0 or v_qty > v_pending then raise exception 'CANTIDAD_INVALIDA: partida % pendiente %, recibido %', it.id, v_pending, v_qty; end if;
    if v_qty = 0 then continue; end if;

    insert into public.purchase_receipt_items (receipt_id, po_item_id, product_id, variant_id, quantity, unit_cost)
    values (r.id, it.id, it.product_id, it.variant_id, v_qty, v_cost);
    update public.purchase_order_items set received_quantity = received_quantity + v_qty where id = it.id;

    perform public.post_inventory_movement(po.organization_id, po.warehouse_id, it.product_id, it.variant_id, 'PURCHASE', v_qty,
      'Recepción ' || r.folio || ' (' || po.folio || ')', 'PURCHASE_RECEIPT', r.id::text, p_user, v_cost);

    -- Actualiza costo del producto/variante
    if v_cost_method = 'AVERAGE' then
      update public.products p set cost_price = round(((p.stock - v_qty) * p.cost_price + v_qty * v_cost) / greatest(p.stock, 1), 2), updated_by = p_user
       where p.id = it.product_id and it.variant_id is null and p.stock > 0;
    else
      if it.variant_id is null then
        update public.products set cost_price = v_cost, updated_by = p_user where id = it.product_id and cost_price is distinct from v_cost;
      else
        update public.product_variants set cost_price = v_cost where id = it.variant_id;
      end if;
    end if;
  end loop;

  if not exists (select 1 from public.purchase_receipt_items where receipt_id = r.id) then raise exception 'SIN_PARTIDAS: no se recibió nada'; end if;

  select bool_and(received_quantity >= quantity) into v_all_received from public.purchase_order_items where purchase_order_id = p_po;
  update public.purchase_orders set status = case when v_all_received then 'RECEIVED' else 'PARTIAL' end where id = p_po;
  if v_all_received then
    update public.purchase_orders set status = 'COMPLETED', completed_at = now() where id = p_po;
    perform public.resolve_notifications_by_key(po.organization_id, 'po:' || po.id::text);
  end if;
  perform public.audit_log(po.organization_id, p_user, 'purchases.receive', 'PURCHASE_ORDER', po.id::text, null, to_jsonb(r), jsonb_build_object('items', p_items, 'all_received', v_all_received));
  return r;
end $$;

do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_order_items','purchase_receipts','purchase_receipt_items']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;
revoke all on function public.create_purchase_order(uuid,uuid,uuid,date,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.update_purchase_order(uuid,uuid,uuid,date,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.set_purchase_order_status(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.receive_purchase_order(uuid,uuid,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.recalc_purchase_order(uuid) from public, anon, authenticated;
