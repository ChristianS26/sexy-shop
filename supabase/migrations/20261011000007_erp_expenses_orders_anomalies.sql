-- ============================================================================
-- SONROJA ERP — 007 Gastos, puente pedidos web -> ventas, detección de anomalías
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Gastos (evoluciona la tabla legada `expenses`)
-- ---------------------------------------------------------------------------
create table if not exists public.expense_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  is_active       boolean not null default true,
  display_order   int not null default 0,
  unique (organization_id, code)
);

alter table public.expenses
  add column if not exists organization_id     uuid references public.organizations(id) on delete cascade,
  add column if not exists branch_id           uuid references public.branches(id),
  add column if not exists expense_category_id uuid references public.expense_categories(id),
  add column if not exists payment_method_code text,
  add column if not exists cash_shift_id       uuid references public.cash_shifts(id),
  add column if not exists supplier_id         uuid references public.suppliers(id),
  add column if not exists receipt_file_id     uuid references public.files(id),
  add column if not exists receipt_url         text,
  add column if not exists notes               text,
  add column if not exists user_id             uuid,
  add column if not exists updated_at          timestamptz not null default now(),
  add column if not exists deleted_at          timestamptz,
  add column if not exists deleted_by          uuid;
update public.expenses set organization_id = public.default_organization_id() where organization_id is null;
alter table public.expenses alter column organization_id set not null;
drop trigger if exists trg_expenses_fill_org on public.expenses;
create trigger trg_expenses_fill_org before insert on public.expenses for each row execute function public.fill_default_org();
drop trigger if exists trg_expenses_updated on public.expenses;
create trigger trg_expenses_updated before update on public.expenses for each row execute function public.set_updated_at();
create index if not exists idx_expenses_org_date on public.expenses (organization_id, expense_date desc);
create index if not exists idx_expenses_category on public.expenses (expense_category_id);

do $$
declare v_org uuid; v_branch uuid; r record;
begin
  v_org := public.default_organization_id();
  select id into v_branch from public.branches where organization_id = v_org and is_default;
  insert into public.expense_categories (organization_id, code, name, display_order) values
    (v_org, 'RENT', 'Renta', 1), (v_org, 'UTILITIES', 'Servicios', 2), (v_org, 'MARKETING', 'Marketing', 3), (v_org, 'TRANSPORT', 'Transporte', 4),
    (v_org, 'SUPPLIES', 'Compras menores', 5), (v_org, 'PACKAGING', 'Empaque', 6), (v_org, 'PAYROLL', 'Nómina', 7), (v_org, 'OTHER', 'Otros', 9)
  on conflict (organization_id, code) do nothing;
  -- mapea la categoría de texto legada
  update public.expenses e set expense_category_id = c.id
    from public.expense_categories c
   where e.organization_id = v_org and e.expense_category_id is null and c.organization_id = v_org
     and c.code = case lower(e.category) when 'renta' then 'RENT' when 'servicios' then 'UTILITIES' when 'marketing' then 'MARKETING'
                   when 'transporte' then 'TRANSPORT' when 'empaque' then 'PACKAGING' when 'nomina' then 'PAYROLL' when 'nómina' then 'PAYROLL' else 'OTHER' end;
  update public.expenses set branch_id = v_branch where organization_id = v_org and branch_id is null;
end $$;

-- Registrar gasto; si viene con turno abierto y es en efectivo, sale de caja.
create or replace function public.create_expense(
  p_org uuid, p_branch uuid, p_category uuid, p_description text, p_amount numeric, p_date date, p_method text, p_user uuid,
  p_shift uuid default null, p_supplier uuid default null, p_receipt_url text default null, p_notes text default null
) returns public.expenses language plpgsql set search_path = public as $$
declare x public.expenses; v_cat text;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'MONTO_INVALIDO'; end if;
  if coalesce(trim(p_description), '') = '' then raise exception 'DESCRIPCION_REQUERIDA'; end if;
  select name into v_cat from public.expense_categories where id = p_category;
  insert into public.expenses (organization_id, branch_id, expense_category_id, category, description, amount, expense_date, payment_method_code, cash_shift_id, supplier_id, receipt_url, notes, user_id)
  values (p_org, p_branch, p_category, coalesce(v_cat, 'general'), p_description, p_amount, coalesce(p_date, current_date), coalesce(p_method, 'CASH'), p_shift, p_supplier, p_receipt_url, p_notes, p_user)
  returning * into x;
  if p_shift is not null and coalesce(p_method, 'CASH') = 'CASH' then
    perform public.add_cash_movement(p_shift, 'EXPENSE', p_amount, 'Gasto: ' || p_description, p_user, 'EXPENSE', x.id::text);
  end if;
  perform public.audit_log(p_org, p_user, 'expenses.create', 'EXPENSE', x.id::text, null, to_jsonb(x));
  return x;
end $$;

-- ---------------------------------------------------------------------------
-- Puente: pedido web confirmado -> venta ONLINE (sin volver a descontar inventario:
-- el checkout ya lo hizo con descontar_stock). Cancelación -> venta cancelada.
-- ---------------------------------------------------------------------------
create or replace function public.sync_order_to_sale()
returns trigger language plpgsql set search_path = public as $$
declare v_org uuid; v_branch uuid; v_wh uuid; v_customer uuid; v_sale_id uuid; v_folio text; v_prefix text; v_rate numeric; v_neigh uuid;
        it record; v_net numeric; v_tax numeric := 0; v_cost numeric := 0; v_items int := 0; v_pm record; v_method text; v_line numeric; v_sub numeric;
begin
  v_org := public.default_organization_id();
  if new.status in ('confirmed','shipped','delivered') and old.status not in ('confirmed','shipped','delivered') and not exists (select 1 from public.sales where source_order_id = new.id) then
    select id into v_wh from public.warehouses where organization_id = v_org and is_default_online;
    select branch_id into v_branch from public.warehouses where id = v_wh;
    select coalesce(value->>'folio_prefix', 'SON') into v_prefix from public.organization_settings where organization_id = v_org and key = 'sales';
    select coalesce(rate, 0) into v_rate from public.tax_rates where organization_id = v_org and is_default;
    -- cliente por teléfono (sin duplicar)
    select id into v_customer from public.customers where organization_id = v_org and phone = regexp_replace(new.customer_phone, '[^0-9+]', '', 'g') and deleted_at is null limit 1;
    if v_customer is null then
      insert into public.customers (organization_id, first_name, last_name, phone, email, source)
      values (v_org, split_part(new.customer_name, ' ', 1), nullif(trim(substr(new.customer_name, length(split_part(new.customer_name, ' ', 1)) + 1)), ''), new.customer_phone, new.customer_email, 'ONLINE')
      returning id into v_customer;
      if coalesce(new.customer_neighborhood, '') <> '' or coalesce(new.customer_street, '') <> '' then
        insert into public.customer_addresses (customer_id, street, ext_number, int_number, neighborhood_text, zip, city, state, references_text, is_default)
        values (v_customer, new.customer_street, new.customer_ext_num, new.customer_int_num, new.customer_neighborhood, new.customer_zip, coalesce(new.customer_city, 'Guaymas'), coalesce(new.customer_state, 'Sonora'), new.customer_references, true);
      end if;
    end if;
    select default_neighborhood_id into v_neigh from public.customers where id = v_customer;
    v_method := case new.payment_method when 'mp' then 'MERCADO_PAGO' when 'transfer' then 'TRANSFER' else 'CASH' end;
    select * into v_pm from public.payment_methods where organization_id = v_org and code = v_method;
    v_folio := public.next_folio(v_org, 'SALE', coalesce(v_prefix, 'SON'));
    insert into public.sales (organization_id, branch_id, warehouse_id, folio, channel, status, customer_id, neighborhood_id, subtotal, discount_amount, tax_amount, total, total_cost, items_count, paid_amount, notes, sold_at, source_order_id, created_by)
    values (v_org, v_branch, v_wh, v_folio, 'ONLINE', 'COMPLETED', v_customer, v_neigh, 0, 0, 0, new.total, 0, 0, new.total, 'Pedido web ' || left(new.id::text, 8), new.created_at, new.id, null)
    returning id into v_sale_id;
    for it in select oi.*, p.category_id, p.brand_id, p.cost_price, p.sku from public.order_items oi left join public.products p on p.id = oi.product_id where oi.order_id = new.id loop
      v_line := it.subtotal; v_net := round(v_line / (1 + coalesce(v_rate, 0)), 2);
      insert into public.sale_items (sale_id, organization_id, branch_id, product_id, category_id, brand_id, product_name, sku, quantity, unit_price, unit_cost, discount_amount, tax_rate, tax_amount, line_total, net_amount, sold_at, customer_id, neighborhood_id, channel, status)
      values (v_sale_id, v_org, v_branch, it.product_id, it.category_id, it.brand_id, it.product_name, it.sku, it.quantity, it.unit_price, coalesce(it.cost_price, 0), 0, coalesce(v_rate, 0), v_line - v_net, v_line, v_net, new.created_at, v_customer, v_neigh, 'ONLINE', 'COMPLETED');
      v_tax := v_tax + (v_line - v_net); v_cost := v_cost + coalesce(it.cost_price, 0) * it.quantity; v_items := v_items + it.quantity;
    end loop;
    -- el envío va como partida sin producto para que el total cuadre con lo cobrado
    if coalesce(new.shipping_cost, 0) > 0 then
      v_net := round(new.shipping_cost / (1 + coalesce(v_rate, 0)), 2);
      insert into public.sale_items (sale_id, organization_id, branch_id, product_name, sku, quantity, unit_price, unit_cost, tax_rate, tax_amount, line_total, net_amount, sold_at, customer_id, neighborhood_id, channel, status)
      values (v_sale_id, v_org, v_branch, 'Envío', 'ENVIO', 1, new.shipping_cost, 0, coalesce(v_rate, 0), new.shipping_cost - v_net, new.shipping_cost, v_net, new.created_at, v_customer, v_neigh, 'ONLINE', 'COMPLETED');
      v_tax := v_tax + (new.shipping_cost - v_net);
    end if;
    select coalesce(sum(line_total), 0) into v_sub from public.sale_items where sale_id = v_sale_id;
    update public.sales set subtotal = round(v_sub - v_tax, 2), tax_amount = v_tax, total = v_sub, paid_amount = v_sub, total_cost = v_cost, items_count = v_items where id = v_sale_id;
    insert into public.sale_payments (sale_id, payment_method_id, method_code, amount, reference) values (v_sale_id, v_pm.id, v_method, v_sub, new.mp_payment_id);
    update public.customers set purchases_count = purchases_count + 1, total_spent = total_spent + v_sub, first_purchase_at = coalesce(first_purchase_at, new.created_at), last_purchase_at = greatest(coalesce(last_purchase_at, new.created_at), new.created_at) where id = v_customer;
    perform public.audit_log(v_org, null, 'sales.create', 'SALE', v_sale_id::text, null, jsonb_build_object('folio', v_folio, 'total', v_sub, 'channel', 'ONLINE', 'order_id', new.id));
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    select id into v_sale_id from public.sales where source_order_id = new.id and status <> 'CANCELLED';
    if v_sale_id is not null then
      update public.sales set status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'Pedido web cancelado', refunded_amount = total where id = v_sale_id;
      update public.sale_items set status = 'CANCELLED' where sale_id = v_sale_id;
      update public.customers c set purchases_count = greatest(purchases_count - 1, 0), total_spent = greatest(total_spent - s.total, 0) from public.sales s where s.id = v_sale_id and c.id = s.customer_id;
      perform public.audit_log(v_org, null, 'sales.cancel', 'SALE', v_sale_id::text, null, null, jsonb_build_object('order_id', new.id, 'reason', 'Pedido web cancelado'));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_orders_sync_sale on public.orders;
create trigger trg_orders_sync_sale after update of status on public.orders for each row execute function public.sync_order_to_sale();

create or replace function public.sync_order_to_sale_backfill(p_order uuid)
returns void language plpgsql set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null then return; end if;
  -- fuerza el trigger con una transición sintética
  update public.orders set status = 'pending' where id = p_order;
  update public.orders set status = o.status where id = p_order;
end $$;

do $$
declare o record;
begin
  for o in select id from public.orders where status in ('confirmed','shipped','delivered') and not exists (select 1 from public.sales s where s.source_order_id = orders.id) loop
    perform public.sync_order_to_sale_backfill(o.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Detección de anomalías (la ejecuta el backend cada 15 min)
-- ---------------------------------------------------------------------------
create or replace function public.run_anomaly_checks(p_org uuid default null)
returns int language plpgsql set search_path = public as $$
declare org record; cfg jsonb; v_n int := 0; r record; v_tz text; v_today date;
begin
  for org in select * from public.organizations where (p_org is null or id = p_org) loop
    select value into cfg from public.organization_settings where organization_id = org.id and key = 'alerts';
    cfg := coalesce(cfg, '{}'::jsonb);
    v_tz := coalesce(org.timezone, 'America/Hermosillo');
    v_today := (now() at time zone v_tz)::date;

    -- Demasiadas cancelaciones hoy por usuario
    for r in select cancelled_by, count(*) n from public.sales where organization_id = org.id and status = 'CANCELLED' and (cancelled_at at time zone v_tz)::date = v_today and cancelled_by is not null group by 1
             having count(*) >= coalesce((cfg->>'cancellations_per_day')::int, 3) loop
      perform public.upsert_notification(org.id, 'UNUSUAL_CANCELLATIONS', 'WARNING', 'Cancelaciones inusuales',
        format('%s ventas canceladas hoy por %s.', r.n, (select first_name || ' ' || last_name from public.users where id = r.cancelled_by)),
        'USER', r.cancelled_by::text, 'anom:cancel:' || r.cancelled_by::text || ':' || v_today::text, null, jsonb_build_object('count', r.n));
      v_n := v_n + 1;
    end loop;

    -- Descuentos acumulados del día por vendedor por encima del umbral (% sobre bruto)
    for r in select seller_id, sum(discount_amount) d, sum(total + discount_amount) g from public.sales
              where organization_id = org.id and status <> 'CANCELLED' and (sold_at at time zone v_tz)::date = v_today and seller_id is not null group by 1
             having sum(total + discount_amount) > 0 and sum(discount_amount) / sum(total + discount_amount) * 100 >= coalesce((cfg->>'discounts_pct_per_day')::numeric, 15) loop
      perform public.upsert_notification(org.id, 'UNUSUAL_DISCOUNTS', 'WARNING', 'Descuentos elevados hoy',
        format('%s otorgó %s%% de descuento promedio sobre sus ventas de hoy.', (select first_name || ' ' || last_name from public.users where id = r.seller_id), round(r.d / r.g * 100, 1)),
        'USER', r.seller_id::text, 'anom:disc:' || r.seller_id::text || ':' || v_today::text, null, jsonb_build_object('discount', r.d, 'gross', r.g));
      v_n := v_n + 1;
    end loop;

    -- Devoluciones frecuentes esta semana
    select count(*) n into r from public.sale_returns where organization_id = org.id and created_at >= date_trunc('week', now() at time zone v_tz) at time zone v_tz;
    if r.n >= coalesce((cfg->>'returns_per_week')::int, 5) then
      perform public.upsert_notification(org.id, 'FREQUENT_RETURNS', 'WARNING', 'Devoluciones frecuentes', format('%s devoluciones en la semana.', r.n),
        'ORGANIZATION', org.id::text, 'anom:returns:' || to_char(now() at time zone v_tz, 'IYYY-IW'), null, jsonb_build_object('count', r.n));
      v_n := v_n + 1;
    end if;

    -- Ventas fuera de horario
    for r in select id, folio, sold_at from public.sales where organization_id = org.id and channel = 'POS' and sold_at > now() - interval '1 day'
               and (extract(hour from sold_at at time zone v_tz) < coalesce((cfg->'business_hours'->>'open')::int, 10)
                    or extract(hour from sold_at at time zone v_tz) >= coalesce((cfg->'business_hours'->>'close')::int, 21)) loop
      perform public.upsert_notification(org.id, 'UNUSUAL_SALES', 'INFO', 'Venta fuera de horario: ' || r.folio,
        'Registrada a las ' || to_char(r.sold_at at time zone v_tz, 'HH24:MI') || '.', 'SALE', r.id::text, 'anom:offhours:' || r.id::text);
      v_n := v_n + 1;
    end loop;

    -- Ajustes de inventario inusuales (más de N partidas de salida en el día)
    for r in select user_id, count(*) n, sum(-quantity) units from public.inventory_movements
              where organization_id = org.id and movement_type in ('ADJUSTMENT_OUT','LOSS','DAMAGE') and (created_at at time zone v_tz)::date = v_today and user_id is not null group by 1
             having count(*) >= 5 loop
      perform public.upsert_notification(org.id, 'UNUSUAL_ADJUSTMENTS', 'WARNING', 'Ajustes de inventario inusuales',
        format('%s registró %s salidas por ajuste/merma hoy (%s unidades).', (select first_name || ' ' || last_name from public.users where id = r.user_id), r.n, r.units),
        'USER', r.user_id::text, 'anom:adj:' || r.user_id::text || ':' || v_today::text);
      v_n := v_n + 1;
    end loop;

    -- Alta demanda con poco stock: vendió en 14 días más de lo que queda
    for r in select p.id, p.name, p.stock, sum(i.quantity) sold from public.sale_items i join public.products p on p.id = i.product_id
              where i.organization_id = org.id and i.status <> 'CANCELLED' and i.sold_at > now() - interval '14 days' and p.is_active and p.deleted_at is null
              group by p.id, p.name, p.stock having sum(i.quantity) > greatest(p.stock, 0) and p.stock <= coalesce(p.low_stock_threshold, 3) * 2 loop
      perform public.upsert_notification(org.id, 'HIGH_DEMAND', 'WARNING', 'Alta demanda: ' || r.name,
        format('Vendió %s unidades en 14 días y quedan %s. Podría agotarse pronto.', r.sold, r.stock), 'PRODUCT', r.id::text, 'demand:' || r.id::text, null,
        jsonb_build_object('sold_14d', r.sold, 'stock', r.stock));
      v_n := v_n + 1;
    end loop;

    -- Órdenes de compra enviadas sin recibir pasada la fecha esperada
    for r in select id, folio, expected_date from public.purchase_orders where organization_id = org.id and status in ('SENT','PARTIAL') and expected_date < v_today loop
      perform public.upsert_notification(org.id, 'PURCHASE_PENDING', 'INFO', 'Orden de compra pendiente: ' || r.folio,
        'Se esperaba el ' || to_char(r.expected_date, 'DD/MM/YYYY') || ' y aún no se recibe completa.', 'PURCHASE_ORDER', r.id::text, 'po:' || r.id::text);
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;

alter table public.expense_categories enable row level security;
revoke all on function public.create_expense(uuid,uuid,uuid,text,numeric,date,text,uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.run_anomaly_checks(uuid) from public, anon, authenticated;
revoke all on function public.sync_order_to_sale_backfill(uuid) from public, anon, authenticated;
