-- ============================================================================
-- SONROJA ERP — 004 Inventario
-- inventory_levels (por almacén/variante), inventory_movements (INV-folio),
-- transferencias, ajustes, conteos. products.stock pasa a ser derivado.
-- Reescribe descontar_stock / devolver_stock para que el checkout web
-- también genere movimientos.
-- ============================================================================

create table if not exists public.inventory_levels (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  variant_id      uuid references public.product_variants(id) on delete cascade,
  quantity        int not null default 0,
  reserved        int not null default 0,
  updated_at      timestamptz not null default now()
);
create unique index if not exists uq_inventory_levels on public.inventory_levels
  (warehouse_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_inventory_levels_product on public.inventory_levels (product_id);
create index if not exists idx_inventory_levels_org_wh on public.inventory_levels (organization_id, warehouse_id);

create table if not exists public.inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference       text not null,
  warehouse_id    uuid not null references public.warehouses(id),
  product_id      uuid not null references public.products(id),
  variant_id      uuid references public.product_variants(id),
  movement_type   text not null check (movement_type in (
                    'PURCHASE','SALE','SALE_RETURN','PURCHASE_RETURN','TRANSFER_IN','TRANSFER_OUT',
                    'ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE','LOSS','INITIAL_STOCK','INVENTORY_COUNT')),
  quantity        int not null,            -- con signo: + entra, - sale
  quantity_before int not null,
  quantity_after  int not null,
  unit_cost       numeric(10,2),
  reason          text,
  reference_type  text,                    -- SALE, ORDER, PURCHASE_RECEIPT, TRANSFER, ADJUSTMENT, COUNT, RETURN
  reference_id    text,
  user_id         uuid,
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_inventory_movements_reference on public.inventory_movements (organization_id, reference);
create index if not exists idx_inv_mov_product_date on public.inventory_movements (product_id, created_at desc);
create index if not exists idx_inv_mov_org_date on public.inventory_movements (organization_id, created_at desc);
create index if not exists idx_inv_mov_type on public.inventory_movements (organization_id, movement_type, created_at desc);
create index if not exists idx_inv_mov_ref on public.inventory_movements (reference_type, reference_id);
-- Un movimiento no se edita ni se borra: se compensa con otro movimiento.
create trigger trg_inventory_movements_immutable before update or delete on public.inventory_movements for each row execute function public.raise_immutable();

-- ---------------------------------------------------------------------------
-- products.stock derivado (suma de todos los almacenes)
-- ---------------------------------------------------------------------------
create or replace function public.sync_product_stock(p_product uuid)
returns void language plpgsql set search_path = public as $$
declare v_total int;
begin
  -- Dentro del guard de products.stock el propio trigger BEFORE fija el valor; no se puede
  -- actualizar la misma fila desde aquí (Postgres lo rechaza).
  if coalesce(current_setting('sonroja.in_guard', true), '0') = '1' then return; end if;
  select coalesce(sum(quantity), 0)::int into v_total from public.inventory_levels where product_id = p_product;
  perform set_config('sonroja.stock_sync', '1', true);
  update public.products set stock = v_total where id = p_product and stock is distinct from v_total;
  perform set_config('sonroja.stock_sync', '0', true);
end $$;

create or replace function public.inventory_levels_after_write()
returns trigger language plpgsql set search_path = public as $$
begin
  perform public.sync_product_stock(coalesce(new.product_id, old.product_id));
  perform public.check_stock_alerts(coalesce(new.product_id, old.product_id));
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Alertas de stock (🔴 agotado · 🟠 crítico · 🟡 bajo · 🟢 saludable)
-- ---------------------------------------------------------------------------
create or replace function public.stock_status(p_qty int, p_min int, p_max int)
returns text language sql immutable as $$
  select case
    when p_qty <= 0 then 'OUT'
    when p_min is not null and p_qty <= ceil(p_min * 0.5) then 'CRITICAL'
    when p_min is not null and p_qty <= p_min then 'LOW'
    when p_max is not null and p_qty > p_max then 'EXCESS'
    else 'HEALTHY' end;
$$;

create or replace function public.check_stock_alerts(p_product uuid)
returns void language plpgsql set search_path = public as $$
declare p record; v_status text; v_min int;
begin
  select id, organization_id, name,
         (select coalesce(sum(quantity), 0)::int from public.inventory_levels where product_id = p_product) as stock,
         low_stock_threshold, max_stock, is_active, deleted_at
    into p from public.products where id = p_product;
  if p.id is null or not p.is_active or p.deleted_at is not null then
    perform public.resolve_notifications_by_key(p.organization_id, 'stock:' || p_product::text);
    return;
  end if;
  v_min := coalesce(p.low_stock_threshold, (select (value->>'default_min_stock')::int from public.organization_settings where organization_id = p.organization_id and key = 'inventory'), 3);
  v_status := public.stock_status(p.stock, v_min, p.max_stock);
  if v_status = 'OUT' then
    perform public.upsert_notification(p.organization_id, 'OUT_OF_STOCK', 'CRITICAL', 'Stock agotado: ' || p.name,
      'No quedan existencias. Considera reordenar.', 'PRODUCT', p.id::text, 'stock:' || p.id::text, null,
      jsonb_build_object('stock', p.stock, 'min', v_min));
  elsif v_status = 'CRITICAL' then
    perform public.upsert_notification(p.organization_id, 'INVENTORY_LOW', 'WARNING', 'Stock crítico: ' || p.name,
      format('Quedan %s unidades (mínimo %s).', p.stock, v_min), 'PRODUCT', p.id::text, 'stock:' || p.id::text, null,
      jsonb_build_object('stock', p.stock, 'min', v_min));
  elsif v_status = 'LOW' then
    perform public.upsert_notification(p.organization_id, 'INVENTORY_LOW', 'INFO', 'Stock bajo: ' || p.name,
      format('Quedan %s unidades (mínimo %s).', p.stock, v_min), 'PRODUCT', p.id::text, 'stock:' || p.id::text, null,
      jsonb_build_object('stock', p.stock, 'min', v_min));
  else
    perform public.resolve_notifications_by_key(p.organization_id, 'stock:' || p.id::text);
  end if;
end $$;

drop trigger if exists trg_inventory_levels_after_write on public.inventory_levels;
create trigger trg_inventory_levels_after_write after insert or update or delete on public.inventory_levels
  for each row execute function public.inventory_levels_after_write();

-- Si alguien cambia products.stock directamente (admin legado), se convierte en ajuste con movimiento.
create or replace function public.products_stock_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_wh uuid; v_delta int;
begin
  if coalesce(current_setting('sonroja.stock_sync', true), '0') = '1' then
    return new;
  end if;
  if new.stock is distinct from old.stock then
    v_delta := new.stock - old.stock;
    select id into v_wh from public.warehouses where organization_id = new.organization_id and is_default_online limit 1;
    if v_wh is null then
      select id into v_wh from public.warehouses where organization_id = new.organization_id and is_active order by is_default desc limit 1;
    end if;
    if v_wh is null then
      raise exception 'NO_WAREHOUSE: la organización no tiene almacén';
    end if;
    perform set_config('sonroja.in_guard', '1', true);
    begin
      perform public.post_inventory_movement(new.organization_id, v_wh, new.id, null,
        case when v_delta > 0 then 'ADJUSTMENT_IN' else 'ADJUSTMENT_OUT' end, v_delta,
        'Ajuste directo de stock', 'LEGACY', null, new.updated_by, new.cost_price);
    exception when others then
      perform set_config('sonroja.in_guard', '0', true);
      raise;
    end;
    perform set_config('sonroja.in_guard', '0', true);
    select coalesce(sum(quantity), 0)::int into new.stock from public.inventory_levels where product_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_products_stock_guard on public.products;
create trigger trg_products_stock_guard before update of stock on public.products for each row execute function public.products_stock_guard();

-- ---------------------------------------------------------------------------
-- Núcleo: registrar un movimiento (atómico, con bloqueo de fila)
-- ---------------------------------------------------------------------------
create or replace function public.post_inventory_movement(
  p_org uuid, p_warehouse uuid, p_product uuid, p_variant uuid,
  p_type text, p_quantity int, p_reason text, p_reference_type text, p_reference_id text,
  p_user uuid, p_unit_cost numeric default null
) returns public.inventory_movements
language plpgsql set search_path = public as $$
declare v_level public.inventory_levels; v_before int; v_after int; v_mov public.inventory_movements; v_allow_negative boolean;
begin
  if p_quantity = 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
  if (p_type in ('PURCHASE','SALE_RETURN','TRANSFER_IN','ADJUSTMENT_IN','INITIAL_STOCK') and p_quantity < 0)
     or (p_type in ('SALE','PURCHASE_RETURN','TRANSFER_OUT','ADJUSTMENT_OUT','DAMAGE','LOSS') and p_quantity > 0) then
    raise exception 'SIGNO_INVALIDO: % con cantidad %', p_type, p_quantity;
  end if;

  insert into public.inventory_levels (organization_id, warehouse_id, product_id, variant_id, quantity)
  values (p_org, p_warehouse, p_product, p_variant, 0)
  on conflict (warehouse_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;

  select * into v_level from public.inventory_levels
   where warehouse_id = p_warehouse and product_id = p_product
     and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_variant, '00000000-0000-0000-0000-000000000000'::uuid)
   for update;

  v_before := v_level.quantity;
  v_after := v_before + p_quantity;

  select coalesce((value->>'allow_negative')::boolean, false) into v_allow_negative
    from public.organization_settings where organization_id = p_org and key = 'inventory';
  if v_after < 0 and not coalesce(v_allow_negative, false) then
    raise exception 'STOCK_INSUFICIENTE' using detail = jsonb_build_object('product_id', p_product, 'variant_id', p_variant, 'available', v_before, 'requested', -p_quantity)::text;
  end if;

  update public.inventory_levels set quantity = v_after, updated_at = now() where id = v_level.id;

  insert into public.inventory_movements (organization_id, reference, warehouse_id, product_id, variant_id, movement_type,
    quantity, quantity_before, quantity_after, unit_cost, reason, reference_type, reference_id, user_id)
  values (p_org, public.next_folio(p_org, 'INV', 'INV'), p_warehouse, p_product, p_variant, p_type,
    p_quantity, v_before, v_after, p_unit_cost, p_reason, p_reference_type, p_reference_id, p_user)
  returning * into v_mov;
  return v_mov;
end $$;

-- ---------------------------------------------------------------------------
-- Compatibilidad con el checkout web (misma firma que antes)
-- ---------------------------------------------------------------------------
create or replace function public.descontar_stock(p_producto uuid, p_cantidad int)
returns int language plpgsql set search_path = public as $$
declare v_org uuid; v_wh uuid; v_mov public.inventory_movements;
begin
  if p_cantidad <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
  select organization_id into v_org from public.products where id = p_producto;
  if v_org is null then raise exception 'STOCK_INSUFICIENTE'; end if;
  select id into v_wh from public.warehouses where organization_id = v_org and is_default_online limit 1;
  if v_wh is null then select id into v_wh from public.warehouses where organization_id = v_org and is_active order by is_default desc limit 1; end if;
  begin
    v_mov := public.post_inventory_movement(v_org, v_wh, p_producto, null, 'SALE', -p_cantidad, 'Pedido en línea', 'ORDER', null, null, null);
  exception when others then
    if sqlerrm like 'STOCK_INSUFICIENTE%' then raise exception 'STOCK_INSUFICIENTE'; end if;
    raise;
  end;
  return (select stock from public.products where id = p_producto);
end $$;

create or replace function public.devolver_stock(p_producto uuid, p_cantidad int)
returns int language plpgsql set search_path = public as $$
declare v_org uuid; v_wh uuid;
begin
  select organization_id into v_org from public.products where id = p_producto;
  if v_org is null then return 0; end if;
  select id into v_wh from public.warehouses where organization_id = v_org and is_default_online limit 1;
  if v_wh is null then select id into v_wh from public.warehouses where organization_id = v_org and is_active order by is_default desc limit 1; end if;
  perform public.post_inventory_movement(v_org, v_wh, p_producto, null, 'SALE_RETURN', p_cantidad, 'Pedido en línea cancelado', 'ORDER', null, null, null);
  return (select stock from public.products where id = p_producto);
end $$;

-- ---------------------------------------------------------------------------
-- Transferencias
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_transfers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  reference         text not null,
  from_warehouse_id uuid not null references public.warehouses(id),
  to_warehouse_id   uuid not null references public.warehouses(id),
  status            text not null default 'DRAFT' check (status in ('DRAFT','IN_TRANSIT','RECEIVED','CANCELLED')),
  notes             text,
  created_by        uuid,
  sent_by           uuid,
  received_by       uuid,
  cancelled_by      uuid,
  sent_at           timestamptz,
  received_at       timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (from_warehouse_id <> to_warehouse_id)
);
create unique index if not exists uq_transfers_reference on public.inventory_transfers (organization_id, reference);
create index if not exists idx_transfers_org_status on public.inventory_transfers (organization_id, status, created_at desc);
create trigger trg_transfers_updated before update on public.inventory_transfers for each row execute function public.set_updated_at();

create table if not exists public.inventory_transfer_items (
  id                uuid primary key default gen_random_uuid(),
  transfer_id       uuid not null references public.inventory_transfers(id) on delete cascade,
  product_id        uuid not null references public.products(id),
  variant_id        uuid references public.product_variants(id),
  quantity          int not null check (quantity > 0),
  received_quantity int
);
create index if not exists idx_transfer_items_transfer on public.inventory_transfer_items (transfer_id);

-- Enviar: descuenta del origen (TRANSFER_OUT)
create or replace function public.send_transfer(p_transfer uuid, p_user uuid)
returns public.inventory_transfers language plpgsql set search_path = public as $$
declare t public.inventory_transfers; it record;
begin
  select * into t from public.inventory_transfers where id = p_transfer for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.status <> 'DRAFT' then raise exception 'ESTADO_INVALIDO: la transferencia ya fue enviada'; end if;
  if not exists (select 1 from public.inventory_transfer_items where transfer_id = p_transfer) then raise exception 'SIN_PARTIDAS'; end if;
  for it in select * from public.inventory_transfer_items where transfer_id = p_transfer loop
    perform public.post_inventory_movement(t.organization_id, t.from_warehouse_id, it.product_id, it.variant_id, 'TRANSFER_OUT', -it.quantity,
      'Transferencia ' || t.reference, 'TRANSFER', t.id::text, p_user, null);
  end loop;
  update public.inventory_transfers set status = 'IN_TRANSIT', sent_by = p_user, sent_at = now() where id = p_transfer returning * into t;
  perform public.audit_log(t.organization_id, p_user, 'inventory.transfer.send', 'TRANSFER', t.id::text, null, to_jsonb(t));
  return t;
end $$;

-- Recibir: entra al destino (TRANSFER_IN). Diferencias quedan como LOSS en origen? No: se registran en received_quantity y se alerta.
create or replace function public.receive_transfer(p_transfer uuid, p_user uuid, p_items jsonb default null)
returns public.inventory_transfers language plpgsql set search_path = public as $$
declare t public.inventory_transfers; it record; v_qty int; v_diff int := 0;
begin
  select * into t from public.inventory_transfers where id = p_transfer for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.status <> 'IN_TRANSIT' then raise exception 'ESTADO_INVALIDO: la transferencia no está en tránsito'; end if;
  for it in select * from public.inventory_transfer_items where transfer_id = p_transfer loop
    v_qty := coalesce((select (e->>'received_quantity')::int from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where (e->>'item_id')::uuid = it.id), it.quantity);
    if v_qty < 0 or v_qty > it.quantity then raise exception 'CANTIDAD_INVALIDA'; end if;
    update public.inventory_transfer_items set received_quantity = v_qty where id = it.id;
    if v_qty > 0 then
      perform public.post_inventory_movement(t.organization_id, t.to_warehouse_id, it.product_id, it.variant_id, 'TRANSFER_IN', v_qty,
        'Transferencia ' || t.reference, 'TRANSFER', t.id::text, p_user, null);
    end if;
    if v_qty < it.quantity then
      v_diff := v_diff + (it.quantity - v_qty);
      -- Lo que no llegó se registra como pérdida contra el origen (ya había salido)
      perform public.post_inventory_movement(t.organization_id, t.to_warehouse_id, it.product_id, it.variant_id, 'TRANSFER_IN', it.quantity - v_qty,
        'Faltante en transferencia ' || t.reference, 'TRANSFER', t.id::text, p_user, null);
      perform public.post_inventory_movement(t.organization_id, t.to_warehouse_id, it.product_id, it.variant_id, 'LOSS', -(it.quantity - v_qty),
        'Faltante en transferencia ' || t.reference, 'TRANSFER', t.id::text, p_user, null);
    end if;
  end loop;
  update public.inventory_transfers set status = 'RECEIVED', received_by = p_user, received_at = now() where id = p_transfer returning * into t;
  if v_diff > 0 then
    perform public.upsert_notification(t.organization_id, 'TRANSFER_DISCREPANCY', 'WARNING', 'Faltante en transferencia ' || t.reference,
      format('%s unidades no llegaron al destino.', v_diff), 'TRANSFER', t.id::text, 'transfer:' || t.id::text);
  end if;
  perform public.audit_log(t.organization_id, p_user, 'inventory.transfer.receive', 'TRANSFER', t.id::text, null, to_jsonb(t), jsonb_build_object('missing_units', v_diff));
  return t;
end $$;

create or replace function public.cancel_transfer(p_transfer uuid, p_user uuid, p_reason text)
returns public.inventory_transfers language plpgsql set search_path = public as $$
declare t public.inventory_transfers; it record;
begin
  select * into t from public.inventory_transfers where id = p_transfer for update;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  if t.status = 'RECEIVED' then raise exception 'ESTADO_INVALIDO: una transferencia recibida no se puede cancelar'; end if;
  if t.status = 'CANCELLED' then return t; end if;
  if t.status = 'IN_TRANSIT' then
    for it in select * from public.inventory_transfer_items where transfer_id = p_transfer loop
      perform public.post_inventory_movement(t.organization_id, t.from_warehouse_id, it.product_id, it.variant_id, 'TRANSFER_IN', it.quantity,
        'Cancelación de transferencia ' || t.reference, 'TRANSFER', t.id::text, p_user, null);
    end loop;
  end if;
  update public.inventory_transfers set status = 'CANCELLED', cancelled_by = p_user, cancelled_at = now(), notes = concat_ws(E'\n', notes, 'Cancelada: ' || coalesce(p_reason, '')) where id = p_transfer returning * into t;
  perform public.audit_log(t.organization_id, p_user, 'inventory.transfer.cancel', 'TRANSFER', t.id::text, null, to_jsonb(t), jsonb_build_object('reason', p_reason));
  return t;
end $$;

-- ---------------------------------------------------------------------------
-- Ajustes
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_adjustments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference       text not null,
  warehouse_id    uuid not null references public.warehouses(id),
  adjustment_type text not null check (adjustment_type in ('ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE','LOSS','INITIAL_STOCK')),
  reason          text not null,
  notes           text,
  status          text not null default 'APPLIED' check (status in ('APPLIED','CANCELLED')),
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_adjustments_reference on public.inventory_adjustments (organization_id, reference);
create index if not exists idx_adjustments_org on public.inventory_adjustments (organization_id, created_at desc);

create table if not exists public.inventory_adjustment_items (
  id            uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.inventory_adjustments(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  variant_id    uuid references public.product_variants(id),
  quantity      int not null check (quantity > 0),
  unit_cost     numeric(10,2)
);
create index if not exists idx_adjustment_items on public.inventory_adjustment_items (adjustment_id);

-- Aplica un ajuste completo en una transacción. p_items: [{product_id, variant_id, quantity, unit_cost}]
create or replace function public.apply_inventory_adjustment(
  p_org uuid, p_warehouse uuid, p_type text, p_reason text, p_notes text, p_items jsonb, p_user uuid
) returns public.inventory_adjustments language plpgsql set search_path = public as $$
declare a public.inventory_adjustments; e jsonb; v_sign int; v_qty int;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'SIN_PARTIDAS'; end if;
  v_sign := case when p_type in ('ADJUSTMENT_IN','INITIAL_STOCK') then 1 else -1 end;
  insert into public.inventory_adjustments (organization_id, reference, warehouse_id, adjustment_type, reason, notes, created_by)
  values (p_org, public.next_folio(p_org, 'ADJ', 'ADJ'), p_warehouse, p_type, p_reason, p_notes, p_user) returning * into a;
  for e in select * from jsonb_array_elements(p_items) loop
    v_qty := (e->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
    insert into public.inventory_adjustment_items (adjustment_id, product_id, variant_id, quantity, unit_cost)
    values (a.id, (e->>'product_id')::uuid, nullif(e->>'variant_id','')::uuid, v_qty, (e->>'unit_cost')::numeric);
    perform public.post_inventory_movement(p_org, p_warehouse, (e->>'product_id')::uuid, nullif(e->>'variant_id','')::uuid,
      p_type, v_sign * v_qty, p_reason, 'ADJUSTMENT', a.id::text, p_user, (e->>'unit_cost')::numeric);
  end loop;
  perform public.audit_log(p_org, p_user, 'inventory.adjust', 'ADJUSTMENT', a.id::text, null, to_jsonb(a), jsonb_build_object('items', p_items));
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Conteos físicos
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_counts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference       text not null,
  warehouse_id    uuid not null references public.warehouses(id),
  status          text not null default 'OPEN' check (status in ('OPEN','FINALIZED','CANCELLED')),
  notes           text,
  created_by      uuid,
  finalized_by    uuid,
  finalized_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists uq_counts_reference on public.inventory_counts (organization_id, reference);
create trigger trg_counts_updated before update on public.inventory_counts for each row execute function public.set_updated_at();

create table if not exists public.inventory_count_items (
  id           uuid primary key default gen_random_uuid(),
  count_id     uuid not null references public.inventory_counts(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  variant_id   uuid references public.product_variants(id),
  expected_qty int not null,
  counted_qty  int,
  unique (count_id, product_id, variant_id)
);
create index if not exists idx_count_items on public.inventory_count_items (count_id);

-- Crea un conteo con la foto actual del almacén (todos los productos activos)
create or replace function public.start_inventory_count(p_org uuid, p_warehouse uuid, p_user uuid, p_notes text default null, p_category uuid default null)
returns public.inventory_counts language plpgsql set search_path = public as $$
declare c public.inventory_counts;
begin
  insert into public.inventory_counts (organization_id, reference, warehouse_id, notes, created_by)
  values (p_org, public.next_folio(p_org, 'CNT', 'CNT'), p_warehouse, p_notes, p_user) returning * into c;
  insert into public.inventory_count_items (count_id, product_id, variant_id, expected_qty)
  select c.id, p.id, v.id, coalesce(l.quantity, 0)
    from public.products p
    left join public.product_variants v on v.product_id = p.id and v.deleted_at is null and v.is_active
    left join public.inventory_levels l on l.product_id = p.id and l.warehouse_id = p_warehouse
         and coalesce(l.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v.id, '00000000-0000-0000-0000-000000000000'::uuid)
   where p.organization_id = p_org and p.deleted_at is null and p.status <> 'DRAFT'
     and (p_category is null or p.category_id = p_category)
     and (not p.has_variants or v.id is not null);
  return c;
end $$;

-- Finaliza: cada diferencia genera un movimiento INVENTORY_COUNT
create or replace function public.finalize_inventory_count(p_count uuid, p_user uuid)
returns public.inventory_counts language plpgsql set search_path = public as $$
declare c public.inventory_counts; it record; v_current int; v_diff int; v_adjusted int := 0;
begin
  select * into c from public.inventory_counts where id = p_count for update;
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  if c.status <> 'OPEN' then raise exception 'ESTADO_INVALIDO: el conteo ya fue cerrado'; end if;
  for it in select * from public.inventory_count_items where count_id = p_count and counted_qty is not null loop
    select coalesce(quantity, 0) into v_current from public.inventory_levels
     where warehouse_id = c.warehouse_id and product_id = it.product_id
       and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(it.variant_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_diff := it.counted_qty - coalesce(v_current, 0);
    if v_diff <> 0 then
      v_adjusted := v_adjusted + 1;
      perform public.post_inventory_movement(c.organization_id, c.warehouse_id, it.product_id, it.variant_id, 'INVENTORY_COUNT', v_diff,
        'Conteo físico ' || c.reference, 'COUNT', c.id::text, p_user, null);
    end if;
  end loop;
  update public.inventory_counts set status = 'FINALIZED', finalized_by = p_user, finalized_at = now() where id = p_count returning * into c;
  perform public.audit_log(c.organization_id, p_user, 'inventory.count.finalize', 'COUNT', c.id::text, null, to_jsonb(c), jsonb_build_object('adjusted_items', v_adjusted));
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Vista de existencias (una fila por producto/variante/almacén con semáforo)
-- ---------------------------------------------------------------------------
create or replace view public.v_stock as
select l.id as level_id, l.organization_id, l.warehouse_id, w.name as warehouse_name, w.branch_id,
       p.id as product_id, p.name as product_name, p.sku, p.barcode, p.category_id, c.name as category_name,
       p.brand_id, v.id as variant_id, v.name as variant_name, coalesce(v.sku, p.sku) as effective_sku,
       l.quantity, l.reserved, coalesce(p.low_stock_threshold, 3) as min_stock, p.max_stock,
       coalesce(v.cost_price, p.cost_price) as unit_cost, coalesce(v.price, p.price) as unit_price,
       l.quantity * coalesce(v.cost_price, p.cost_price) as stock_value,
       public.stock_status(l.quantity, coalesce(p.low_stock_threshold, 3), p.max_stock) as stock_status,
       p.status as product_status, p.is_active, l.updated_at
  from public.inventory_levels l
  join public.products p on p.id = l.product_id and p.deleted_at is null
  join public.warehouses w on w.id = l.warehouse_id
  left join public.categories c on c.id = p.category_id
  left join public.product_variants v on v.id = l.variant_id;

-- ---------------------------------------------------------------------------
-- Inicialización: existencias actuales -> almacén por defecto (INITIAL_STOCK)
-- ---------------------------------------------------------------------------
do $$
declare p record; v_wh uuid; v_org uuid;
begin
  v_org := public.default_organization_id();
  select id into v_wh from public.warehouses where organization_id = v_org and is_default_online limit 1;
  if v_wh is null then return; end if;
  if exists (select 1 from public.inventory_movements where organization_id = v_org and movement_type = 'INITIAL_STOCK') then return; end if;
  for p in select id, stock, cost_price from public.products where organization_id = v_org and deleted_at is null loop
    if p.stock > 0 then
      perform public.post_inventory_movement(v_org, v_wh, p.id, null, 'INITIAL_STOCK', p.stock, 'Inventario inicial (migración ERP)', 'MIGRATION', null, null, p.cost_price);
    else
      insert into public.inventory_levels (organization_id, warehouse_id, product_id, quantity) values (v_org, v_wh, p.id, 0) on conflict do nothing;
    end if;
  end loop;
end $$;

-- RLS y permisos de ejecución
do $$
declare t text;
begin
  foreach t in array array['inventory_levels','inventory_movements','inventory_transfers','inventory_transfer_items',
                           'inventory_adjustments','inventory_adjustment_items','inventory_counts','inventory_count_items']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;
revoke all on function public.post_inventory_movement(uuid,uuid,uuid,uuid,text,int,text,text,text,uuid,numeric) from public, anon, authenticated;
revoke all on function public.send_transfer(uuid,uuid) from public, anon, authenticated;
revoke all on function public.receive_transfer(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.cancel_transfer(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.apply_inventory_adjustment(uuid,uuid,text,text,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.start_inventory_count(uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.finalize_inventory_count(uuid,uuid) from public, anon, authenticated;
revoke all on function public.sync_product_stock(uuid) from public, anon, authenticated;
revoke all on function public.check_stock_alerts(uuid) from public, anon, authenticated;
revoke all on public.v_stock from anon, authenticated;
