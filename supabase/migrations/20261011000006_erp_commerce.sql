-- ============================================================================
-- SONROJA ERP — 006 Comercial
-- Clientes + direcciones + colonias normalizadas, métodos de pago, cajas y
-- turnos, promociones, ventas (SON-folio), pagos, devoluciones (DEV-folio).
-- Las operaciones críticas son funciones = una transacción cada una.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Colonias normalizadas (BI geográfico)
-- ---------------------------------------------------------------------------
create table if not exists public.neighborhoods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  normalized_name text not null,
  zip             text,
  city            text not null default 'Guaymas',
  state           text not null default 'Sonora',
  aliases         text[] not null default '{}',
  lat             numeric(9,6),
  lng             numeric(9,6),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_neighborhoods on public.neighborhoods (organization_id, normalized_name, public.normalize_text(city));
create index if not exists idx_neighborhoods_zip on public.neighborhoods (organization_id, zip);

-- Devuelve (o crea) la colonia a partir de texto libre. Busca por nombre normalizado o alias.
create or replace function public.resolve_neighborhood(p_org uuid, p_name text, p_zip text, p_city text, p_state text)
returns uuid language plpgsql set search_path = public as $$
declare v_norm text; v_city text; v_id uuid;
begin
  v_norm := public.normalize_text(p_name);
  if v_norm = '' then return null; end if;
  v_city := coalesce(nullif(trim(p_city), ''), 'Guaymas');
  select id into v_id from public.neighborhoods
   where organization_id = p_org and public.normalize_text(city) = public.normalize_text(v_city)
     and (normalized_name = v_norm or v_norm = any (aliases))
   limit 1;
  if v_id is null then
    insert into public.neighborhoods (organization_id, name, normalized_name, zip, city, state)
    values (p_org, initcap(trim(p_name)), v_norm, nullif(trim(p_zip), ''), v_city, coalesce(nullif(trim(p_state), ''), 'Sonora'))
    on conflict (organization_id, normalized_name, public.normalize_text(city)) do update set zip = coalesce(public.neighborhoods.zip, excluded.zip)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Clientes (datos mínimos; nada de información sensible)
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  code              text,
  first_name        text not null,
  last_name         text not null default '',
  phone             text,
  email             text,
  birthday          date,
  notes             text,
  source            text not null default 'POS' check (source in ('POS','ONLINE','IMPORT','OTHER')),
  status            text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  accepts_marketing boolean not null default false,
  -- Desnormalizados para CRM / RFM rápido (los mantiene create_sale / devoluciones)
  purchases_count   int not null default 0,
  total_spent       numeric(12,2) not null default 0,
  first_purchase_at timestamptz,
  last_purchase_at  timestamptz,
  default_neighborhood_id uuid references public.neighborhoods(id) on delete set null,
  search_text       text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        uuid
);
create index if not exists idx_customers_org on public.customers (organization_id, status, deleted_at);
create index if not exists idx_customers_phone on public.customers (organization_id, phone);
create index if not exists idx_customers_search on public.customers using gin (search_text extensions.gin_trgm_ops);
create index if not exists idx_customers_last_purchase on public.customers (organization_id, last_purchase_at desc);

create or replace function public.customers_before_write()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if new.phone is not null then new.phone := regexp_replace(new.phone, '[^0-9+]', '', 'g'); end if;
  if new.email is not null then new.email := lower(trim(new.email)); end if;
  new.search_text := public.normalize_text(concat_ws(' ', new.first_name, new.last_name, new.phone, new.email, new.code));
  return new;
end $$;
drop trigger if exists trg_customers_before_write on public.customers;
create trigger trg_customers_before_write before insert or update on public.customers for each row execute function public.customers_before_write();
create trigger trg_customers_updated before update on public.customers for each row execute function public.set_updated_at();

create table if not exists public.customer_addresses (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete cascade,
  label           text default 'Casa',
  street          text,
  ext_number      text,
  int_number      text,
  neighborhood_text text,
  neighborhood_id uuid references public.neighborhoods(id) on delete set null,
  zip             text,
  city            text default 'Guaymas',
  state           text default 'Sonora',
  references_text text,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_customer_addresses on public.customer_addresses (customer_id);
create unique index if not exists uq_customer_default_address on public.customer_addresses (customer_id) where is_default;
create trigger trg_customer_addresses_updated before update on public.customer_addresses for each row execute function public.set_updated_at();

-- Al guardar una dirección se resuelve la colonia y se refleja en el cliente
create or replace function public.customer_addresses_before_write()
returns trigger language plpgsql set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.customers where id = new.customer_id;
  if new.neighborhood_text is not null and trim(new.neighborhood_text) <> '' then
    new.neighborhood_id := public.resolve_neighborhood(v_org, new.neighborhood_text, new.zip, new.city, new.state);
  end if;
  return new;
end $$;
drop trigger if exists trg_customer_addresses_before_write on public.customer_addresses;
create trigger trg_customer_addresses_before_write before insert or update on public.customer_addresses for each row execute function public.customer_addresses_before_write();

create or replace function public.customer_addresses_after_write()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.customers c set default_neighborhood_id = (
    select neighborhood_id from public.customer_addresses a where a.customer_id = c.id order by a.is_default desc, a.updated_at desc limit 1)
  where c.id = coalesce(new.customer_id, old.customer_id);
  return null;
end $$;
drop trigger if exists trg_customer_addresses_after_write on public.customer_addresses;
create trigger trg_customer_addresses_after_write after insert or update or delete on public.customer_addresses for each row execute function public.customer_addresses_after_write();

-- ---------------------------------------------------------------------------
-- Métodos de pago (extensibles)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_methods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  is_cash         boolean not null default false,
  fee_pct         numeric(5,2) not null default 0,
  requires_reference boolean not null default false,
  is_active       boolean not null default true,
  display_order   int not null default 0,
  unique (organization_id, code)
);

-- ---------------------------------------------------------------------------
-- Cajas y turnos
-- ---------------------------------------------------------------------------
create table if not exists public.cash_registers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete cascade,
  code            text not null,
  name            text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.cash_shifts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  branch_id        uuid not null references public.branches(id),
  cash_register_id uuid not null references public.cash_registers(id),
  status           text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  opened_by        uuid not null,
  opened_at        timestamptz not null default now(),
  opening_amount   numeric(12,2) not null default 0,
  closed_by        uuid,
  closed_at        timestamptz,
  expected_cash    numeric(12,2),
  counted_cash     numeric(12,2),
  difference       numeric(12,2),
  totals_by_method jsonb,
  sales_count      int,
  sales_total      numeric(12,2),
  notes            text,
  close_notes      text
);
create unique index if not exists uq_cash_shift_open on public.cash_shifts (cash_register_id) where status = 'OPEN';
create index if not exists idx_cash_shifts_org on public.cash_shifts (organization_id, opened_at desc);

create table if not exists public.cash_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cash_shift_id   uuid not null references public.cash_shifts(id) on delete cascade,
  movement_type   text not null check (movement_type in ('OPENING','SALE','REFUND','DEPOSIT','WITHDRAWAL','EXPENSE','ADJUSTMENT')),
  amount          numeric(12,2) not null,           -- con signo
  payment_method_code text,
  affects_cash    boolean not null default true,    -- false = tarjeta/transferencia (no está en el cajón)
  reference_type  text,
  reference_id    text,
  description     text,
  user_id         uuid,
  created_at      timestamptz not null default now()
);
create index if not exists idx_cash_movements_shift on public.cash_movements (cash_shift_id, created_at);
create trigger trg_cash_movements_immutable before update or delete on public.cash_movements for each row execute function public.raise_immutable();

create or replace function public.open_cash_shift(p_org uuid, p_branch uuid, p_register uuid, p_user uuid, p_opening numeric, p_notes text default null)
returns public.cash_shifts language plpgsql set search_path = public as $$
declare s public.cash_shifts;
begin
  if p_opening < 0 then raise exception 'MONTO_INVALIDO'; end if;
  if exists (select 1 from public.cash_shifts where cash_register_id = p_register and status = 'OPEN') then
    raise exception 'CAJA_ABIERTA: esta caja ya tiene un turno abierto';
  end if;
  insert into public.cash_shifts (organization_id, branch_id, cash_register_id, opened_by, opening_amount, notes)
  values (p_org, p_branch, p_register, p_user, p_opening, p_notes) returning * into s;
  insert into public.cash_movements (organization_id, cash_shift_id, movement_type, amount, payment_method_code, affects_cash, description, user_id)
  values (p_org, s.id, 'OPENING', p_opening, 'CASH', true, 'Fondo inicial', p_user);
  perform public.audit_log(p_org, p_user, 'cash.open', 'CASH_SHIFT', s.id::text, null, to_jsonb(s));
  return s;
end $$;

create or replace function public.add_cash_movement(p_shift uuid, p_type text, p_amount numeric, p_description text, p_user uuid, p_reference_type text default null, p_reference_id text default null)
returns public.cash_movements language plpgsql set search_path = public as $$
declare s public.cash_shifts; m public.cash_movements; v_signed numeric;
begin
  select * into s from public.cash_shifts where id = p_shift for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if s.status <> 'OPEN' then raise exception 'TURNO_CERRADO'; end if;
  if p_type not in ('DEPOSIT','WITHDRAWAL','EXPENSE','ADJUSTMENT') then raise exception 'TIPO_INVALIDO'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'MONTO_INVALIDO'; end if;
  v_signed := case when p_type in ('WITHDRAWAL','EXPENSE') then -abs(p_amount) when p_type = 'DEPOSIT' then abs(p_amount) else p_amount end;
  insert into public.cash_movements (organization_id, cash_shift_id, movement_type, amount, payment_method_code, affects_cash, description, user_id, reference_type, reference_id)
  values (s.organization_id, p_shift, p_type, v_signed, 'CASH', true, p_description, p_user, p_reference_type, p_reference_id) returning * into m;
  perform public.audit_log(s.organization_id, p_user, 'cash.movement', 'CASH_SHIFT', s.id::text, null, to_jsonb(m));
  return m;
end $$;

create or replace function public.close_cash_shift(p_shift uuid, p_user uuid, p_counted numeric, p_notes text default null)
returns public.cash_shifts language plpgsql set search_path = public as $$
declare s public.cash_shifts; v_expected numeric; v_totals jsonb; v_threshold numeric; v_count int; v_sales numeric;
begin
  select * into s from public.cash_shifts where id = p_shift for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if s.status <> 'OPEN' then raise exception 'TURNO_CERRADO'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'MONTO_INVALIDO'; end if;
  select coalesce(sum(amount), 0) into v_expected from public.cash_movements where cash_shift_id = p_shift and affects_cash;
  select coalesce(jsonb_object_agg(code, t), '{}'::jsonb) into v_totals from (
    select coalesce(payment_method_code, 'OTHER') code, sum(amount) t from public.cash_movements
     where cash_shift_id = p_shift and movement_type in ('SALE','REFUND') group by 1) x;
  select count(*), coalesce(sum(total), 0) into v_count, v_sales from public.sales where cash_shift_id = p_shift and status <> 'CANCELLED';
  update public.cash_shifts set status = 'CLOSED', closed_by = p_user, closed_at = now(), expected_cash = v_expected, counted_cash = p_counted,
         difference = p_counted - v_expected, totals_by_method = v_totals, sales_count = v_count, sales_total = v_sales, close_notes = p_notes
   where id = p_shift returning * into s;
  select coalesce((value->>'cash_difference_threshold')::numeric, 50) into v_threshold from public.organization_settings where organization_id = s.organization_id and key = 'alerts';
  if abs(s.difference) > coalesce(v_threshold, 50) then
    perform public.upsert_notification(s.organization_id, 'CASH_DISCREPANCY', 'CRITICAL', 'Diferencia de caja al cerrar turno',
      format('Esperado $%s, contado $%s (diferencia $%s).', to_char(v_expected, 'FM999999990.00'), to_char(p_counted, 'FM999999990.00'), to_char(s.difference, 'FM999999990.00')),
      'CASH_SHIFT', s.id::text, 'cash:' || s.id::text, s.branch_id, jsonb_build_object('expected', v_expected, 'counted', p_counted, 'difference', s.difference));
  end if;
  perform public.audit_log(s.organization_id, p_user, 'cash.close', 'CASH_SHIFT', s.id::text, null, to_jsonb(s));
  return s;
end $$;

-- ---------------------------------------------------------------------------
-- Promociones
-- ---------------------------------------------------------------------------
create table if not exists public.promotions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  promo_type      text not null check (promo_type in ('PERCENT','FIXED','BUY_X_GET_Y','BUNDLE','FREE_PRODUCT','CATEGORY_PERCENT','QUANTITY_DISCOUNT')),
  value           numeric(10,2) not null default 0,   -- % o monto según tipo
  buy_qty         int,                                -- BUY_X_GET_Y: compra X
  get_qty         int,                                -- BUY_X_GET_Y: lleva Y gratis
  min_quantity    int,                                -- QUANTITY_DISCOUNT
  min_amount      numeric(12,2),
  max_uses        int,
  uses_count      int not null default 0,
  starts_at       timestamptz,
  ends_at         timestamptz,
  status          text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','EXPIRED')),
  free_product_id uuid references public.products(id),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_promotions_org on public.promotions (organization_id, status, starts_at, ends_at);
create trigger trg_promotions_updated before update on public.promotions for each row execute function public.set_updated_at();
create table if not exists public.promotion_products (promotion_id uuid references public.promotions(id) on delete cascade, product_id uuid references public.products(id) on delete cascade, primary key (promotion_id, product_id));
create table if not exists public.promotion_categories (promotion_id uuid references public.promotions(id) on delete cascade, category_id uuid references public.categories(id) on delete cascade, primary key (promotion_id, category_id));

-- ---------------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------------
create table if not exists public.sales (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  branch_id        uuid not null references public.branches(id),
  warehouse_id     uuid not null references public.warehouses(id),
  folio            text not null,
  channel          text not null default 'POS' check (channel in ('POS','ONLINE','WHATSAPP','MARKETPLACE','OTHER')),
  status           text not null default 'COMPLETED' check (status in ('COMPLETED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  customer_id      uuid references public.customers(id) on delete set null,
  seller_id        uuid references public.users(id),
  cash_shift_id    uuid references public.cash_shifts(id),
  neighborhood_id  uuid references public.neighborhoods(id),
  subtotal         numeric(12,2) not null,   -- neto sin IVA, ya con descuentos
  discount_amount  numeric(12,2) not null default 0,  -- descuento total (líneas + general)
  discount_pct     numeric(5,2),
  discount_reason  text,
  tax_amount       numeric(12,2) not null default 0,
  total            numeric(12,2) not null,
  total_cost       numeric(12,2) not null default 0,
  items_count      int not null default 0,
  paid_amount      numeric(12,2) not null default 0,
  change_amount    numeric(12,2) not null default 0,
  refunded_amount  numeric(12,2) not null default 0,
  notes            text,
  sold_at          timestamptz not null default now(),
  cancelled_at     timestamptz,
  cancelled_by     uuid,
  cancel_reason    text,
  source_order_id  uuid references public.orders(id),
  client_ref       text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists uq_sales_folio on public.sales (organization_id, folio);
create unique index if not exists uq_sales_client_ref on public.sales (organization_id, client_ref) where client_ref is not null;
create unique index if not exists uq_sales_source_order on public.sales (source_order_id) where source_order_id is not null;
create index if not exists idx_sales_org_sold on public.sales (organization_id, sold_at desc);
create index if not exists idx_sales_branch_sold on public.sales (branch_id, sold_at desc);
create index if not exists idx_sales_customer on public.sales (customer_id, sold_at desc);
create index if not exists idx_sales_seller on public.sales (seller_id, sold_at desc);
create index if not exists idx_sales_status on public.sales (organization_id, status);
create index if not exists idx_sales_shift on public.sales (cash_shift_id);
create trigger trg_sales_updated before update on public.sales for each row execute function public.set_updated_at();

create table if not exists public.sale_items (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales(id) on delete cascade,
  organization_id   uuid not null,
  branch_id         uuid not null,
  product_id        uuid references public.products(id) on delete set null,
  variant_id        uuid references public.product_variants(id) on delete set null,
  category_id       uuid,
  brand_id          uuid,
  product_name      text not null,
  variant_name      text,
  sku               text,
  quantity          int not null check (quantity > 0),
  unit_price        numeric(10,2) not null,
  unit_cost         numeric(10,2) not null default 0,
  discount_amount   numeric(12,2) not null default 0,
  promotion_id      uuid references public.promotions(id) on delete set null,
  tax_rate          numeric(6,4) not null default 0,
  tax_amount        numeric(12,2) not null default 0,
  line_total        numeric(12,2) not null,   -- bruto con IVA menos descuento
  net_amount        numeric(12,2) not null,   -- line_total sin IVA
  returned_quantity int not null default 0,
  -- desnormalizados para BI
  sold_at           timestamptz not null,
  customer_id       uuid,
  neighborhood_id   uuid,
  seller_id         uuid,
  channel           text not null default 'POS',
  status            text not null default 'COMPLETED'
);
create index if not exists idx_sale_items_sale on public.sale_items (sale_id);
create index if not exists idx_sale_items_org_sold on public.sale_items (organization_id, sold_at desc);
create index if not exists idx_sale_items_product_sold on public.sale_items (product_id, sold_at desc);
create index if not exists idx_sale_items_category on public.sale_items (organization_id, category_id, sold_at desc);
create index if not exists idx_sale_items_customer on public.sale_items (customer_id);
create index if not exists idx_sale_items_neighborhood on public.sale_items (organization_id, neighborhood_id);

create table if not exists public.sale_payments (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid not null references public.sales(id) on delete cascade,
  payment_method_id   uuid references public.payment_methods(id),
  method_code         text not null,
  amount              numeric(12,2) not null,
  reference           text,
  created_at          timestamptz not null default now()
);
create index if not exists idx_sale_payments_sale on public.sale_payments (sale_id);

create table if not exists public.sale_returns (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  folio             text not null,
  sale_id           uuid not null references public.sales(id),
  branch_id         uuid not null,
  cash_shift_id     uuid references public.cash_shifts(id),
  reason            text not null,
  notes             text,
  refund_amount     numeric(12,2) not null,
  refund_method_code text not null,
  user_id           uuid,
  created_at        timestamptz not null default now()
);
create unique index if not exists uq_returns_folio on public.sale_returns (organization_id, folio);
create index if not exists idx_returns_sale on public.sale_returns (sale_id);
create index if not exists idx_returns_org on public.sale_returns (organization_id, created_at desc);

create table if not exists public.sale_return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references public.sale_returns(id) on delete cascade,
  sale_item_id  uuid not null references public.sale_items(id),
  product_id    uuid,
  variant_id    uuid,
  quantity      int not null check (quantity > 0),
  unit_refund   numeric(10,2) not null,
  line_total    numeric(12,2) not null,
  restock       boolean not null default true,
  condition     text default 'GOOD' check (condition in ('GOOD','DAMAGED','OPENED'))
);
create index if not exists idx_return_items on public.sale_return_items (return_id);

-- ---------------------------------------------------------------------------
-- Helper: venta completa en JSON (header + items + pagos + cliente)
-- ---------------------------------------------------------------------------
create or replace function public.sale_json(p_sale uuid)
returns jsonb language sql stable set search_path = public as $$
  select to_jsonb(s)
      || jsonb_build_object(
           'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.product_name) from public.sale_items i where i.sale_id = s.id), '[]'::jsonb),
           'payments', coalesce((select jsonb_agg(to_jsonb(p)) from public.sale_payments p where p.sale_id = s.id), '[]'::jsonb),
           'returns', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('items', (select jsonb_agg(to_jsonb(ri)) from public.sale_return_items ri where ri.return_id = r.id))) from public.sale_returns r where r.sale_id = s.id), '[]'::jsonb),
           'customer', (select jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'phone', c.phone, 'email', c.email) from public.customers c where c.id = s.customer_id),
           'seller_name', (select u.first_name || ' ' || u.last_name from public.users u where u.id = s.seller_id),
           'branch_name', (select b.name from public.branches b where b.id = s.branch_id),
           'neighborhood_name', (select n.name from public.neighborhoods n where n.id = s.neighborhood_id)
         )
  from public.sales s where s.id = p_sale;
$$;

-- ---------------------------------------------------------------------------
-- CREATE SALE — una sola transacción
-- payload: {organization_id, branch_id, warehouse_id?, seller_id, user_id, customer_id?, cash_shift_id?, channel?,
--           client_ref?, sold_at?, notes?, discount_pct?, discount_amount?, discount_reason?, max_discount_pct? (null = sin límite),
--           allow_price_override?, items:[{product_id, variant_id?, quantity, unit_price?, discount_amount?, promotion_id?}],
--           payments:[{method_code, amount, reference?}]}
-- ---------------------------------------------------------------------------
create or replace function public.create_sale(p jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_org uuid := (p->>'organization_id')::uuid;
  v_branch uuid := (p->>'branch_id')::uuid;
  v_wh uuid := nullif(p->>'warehouse_id','')::uuid;
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_seller uuid := coalesce(nullif(p->>'seller_id','')::uuid, nullif(p->>'user_id','')::uuid);
  v_customer uuid := nullif(p->>'customer_id','')::uuid;
  v_shift uuid := nullif(p->>'cash_shift_id','')::uuid;
  v_channel text := coalesce(nullif(p->>'channel',''), 'POS');
  v_client_ref text := nullif(p->>'client_ref','');
  v_sold_at timestamptz := coalesce((p->>'sold_at')::timestamptz, now());
  v_max_disc numeric := (p->>'max_discount_pct')::numeric;
  v_allow_override boolean := coalesce((p->>'allow_price_override')::boolean, false);
  v_existing uuid; v_sale public.sales; e jsonb; prod record; v_var_id uuid; v_var_name text; v_var_sku text; v_var_price numeric; v_var_cost numeric;
  v_qty int; v_price numeric; v_cost numeric; v_rate numeric; v_default_rate numeric; v_line_disc numeric;
  v_gross numeric := 0; v_line_disc_total numeric := 0; v_header_disc numeric := 0; v_total numeric; v_tax numeric := 0; v_net numeric := 0; v_total_cost numeric := 0; v_items int := 0;
  v_folio text; v_prefix text; v_paid numeric := 0; v_cash_paid numeric := 0; v_change numeric := 0; v_require_shift boolean; v_shift_row public.cash_shifts;
  v_neighborhood uuid; v_item_rows jsonb := '[]'::jsonb; v_line_total numeric; v_share numeric; v_item_id uuid; v_remaining_disc numeric; v_idx int := 0; v_n int;
  v_pm record; v_amount numeric; v_prices_incl boolean;
begin
  if v_org is null or v_branch is null then raise exception 'DATOS_INCOMPLETOS: organización y sucursal son obligatorias'; end if;
  if v_client_ref is not null then
    select id into v_existing from public.sales where organization_id = v_org and client_ref = v_client_ref;
    if v_existing is not null then return public.sale_json(v_existing); end if;
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'SIN_PARTIDAS: agrega al menos un producto'; end if;

  if v_wh is null then
    select id into v_wh from public.warehouses where branch_id = v_branch and is_active order by is_default desc limit 1;
    if v_wh is null then raise exception 'NO_WAREHOUSE: la sucursal no tiene almacén'; end if;
  end if;

  select coalesce((value->>'require_shift_for_cash')::boolean, true), coalesce(value->>'folio_prefix', 'SON') into v_require_shift, v_prefix
    from public.organization_settings where organization_id = v_org and key = 'sales';
  v_require_shift := coalesce(v_require_shift, true); v_prefix := coalesce(v_prefix, 'SON');
  select coalesce((value->>'prices_include_tax')::boolean, true) into v_prices_incl from public.organization_settings where organization_id = v_org and key = 'tax';
  v_prices_incl := coalesce(v_prices_incl, true);
  select coalesce(rate, 0) into v_default_rate from public.tax_rates where organization_id = v_org and is_default;
  v_default_rate := coalesce(v_default_rate, 0);

  -- Validación de turno
  if v_shift is not null then
    select * into v_shift_row from public.cash_shifts where id = v_shift for update;
    if v_shift_row.id is null or v_shift_row.status <> 'OPEN' then raise exception 'TURNO_CERRADO: abre un turno de caja para cobrar'; end if;
    if v_shift_row.branch_id <> v_branch then raise exception 'TURNO_INVALIDO: el turno pertenece a otra sucursal'; end if;
  end if;

  -- Cliente / colonia
  if v_customer is not null then
    select default_neighborhood_id into v_neighborhood from public.customers where id = v_customer and organization_id = v_org and deleted_at is null;
    if not found then raise exception 'CLIENTE_INVALIDO'; end if;
  end if;

  -- Primera pasada: validar y calcular bruto
  for e in select * from jsonb_array_elements(p->'items') loop
    v_qty := (e->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
    select p2.id, p2.name, p2.sku, p2.price, p2.cost_price, p2.category_id, p2.brand_id, p2.is_active, p2.deleted_at, p2.has_variants, t.rate as tax_rate
      into prod from public.products p2 left join public.tax_rates t on t.id = p2.tax_rate_id
     where p2.id = (e->>'product_id')::uuid and p2.organization_id = v_org;
    if prod.id is null or prod.deleted_at is not null then raise exception 'PRODUCTO_INVALIDO: %', e->>'product_id'; end if;
    if not prod.is_active then raise exception 'PRODUCTO_INACTIVO: %', prod.name; end if;
    v_var_id := null; v_var_price := null;
    if nullif(e->>'variant_id','') is not null then
      select id, price into v_var_id, v_var_price from public.product_variants where id = (e->>'variant_id')::uuid and product_id = prod.id and deleted_at is null;
      if v_var_id is null then raise exception 'VARIANTE_INVALIDA'; end if;
    elsif prod.has_variants then
      raise exception 'VARIANTE_REQUERIDA: % tiene variantes', prod.name;
    end if;
    v_price := coalesce(v_var_price, prod.price);
    if v_allow_override and (e->>'unit_price') is not null then v_price := (e->>'unit_price')::numeric; end if;
    if v_price < 0 then raise exception 'PRECIO_INVALIDO'; end if;
    v_line_disc := coalesce((e->>'discount_amount')::numeric, 0);
    if v_line_disc < 0 or v_line_disc > v_price * v_qty then raise exception 'DESCUENTO_INVALIDO'; end if;
    v_gross := v_gross + v_price * v_qty;
    v_line_disc_total := v_line_disc_total + v_line_disc;
    v_items := v_items + v_qty;
  end loop;

  -- Descuento general
  if (p->>'discount_pct') is not null and (p->>'discount_pct')::numeric > 0 then
    v_header_disc := round((v_gross - v_line_disc_total) * (p->>'discount_pct')::numeric / 100, 2);
  elsif (p->>'discount_amount') is not null then
    v_header_disc := (p->>'discount_amount')::numeric;
  end if;
  if v_header_disc < 0 or v_header_disc > v_gross - v_line_disc_total then raise exception 'DESCUENTO_INVALIDO'; end if;
  if v_max_disc is not null and v_gross > 0 and (v_line_disc_total + v_header_disc) / v_gross * 100 > v_max_disc + 0.01 then
    raise exception 'DESCUENTO_EXCEDE_LIMITE: tu rol permite hasta % %%', v_max_disc;
  end if;
  v_total := round(v_gross - v_line_disc_total - v_header_disc, 2);

  -- Pagos
  if jsonb_typeof(p->'payments') <> 'array' or jsonb_array_length(p->'payments') = 0 then raise exception 'SIN_PAGO: indica el método de pago'; end if;
  for e in select * from jsonb_array_elements(p->'payments') loop
    v_amount := (e->>'amount')::numeric;
    if v_amount is null or v_amount <= 0 then raise exception 'PAGO_INVALIDO'; end if;
    select * into v_pm from public.payment_methods where organization_id = v_org and code = e->>'method_code' and is_active;
    if v_pm.id is null then raise exception 'METODO_PAGO_INVALIDO: %', e->>'method_code'; end if;
    if v_pm.requires_reference and nullif(e->>'reference','') is null then raise exception 'REFERENCIA_REQUERIDA: % requiere referencia', v_pm.name; end if;
    v_paid := v_paid + v_amount;
    if v_pm.is_cash then v_cash_paid := v_cash_paid + v_amount; end if;
  end loop;
  if v_paid + 0.001 < v_total then raise exception 'PAGO_INSUFICIENTE: faltan $%', to_char(v_total - v_paid, 'FM999999990.00'); end if;
  v_change := round(v_paid - v_total, 2);
  if v_change > 0 and v_change > v_cash_paid + 0.001 then raise exception 'PAGO_EXCEDE: solo el efectivo puede generar cambio'; end if;
  if v_cash_paid > 0 and v_require_shift and v_shift is null and v_channel = 'POS' then raise exception 'TURNO_REQUERIDO: abre un turno de caja para cobrar en efectivo'; end if;

  -- Folio e inserción
  v_folio := public.next_folio(v_org, 'SALE', v_prefix);
  insert into public.sales (organization_id, branch_id, warehouse_id, folio, channel, customer_id, seller_id, cash_shift_id, neighborhood_id,
      subtotal, discount_amount, discount_pct, discount_reason, tax_amount, total, total_cost, items_count, paid_amount, change_amount, notes, sold_at, client_ref, created_by)
  values (v_org, v_branch, v_wh, v_folio, v_channel, v_customer, v_seller, v_shift, v_neighborhood,
      0, v_line_disc_total + v_header_disc, (p->>'discount_pct')::numeric, nullif(p->>'discount_reason',''), 0, v_total, 0, v_items, v_paid, v_change, nullif(p->>'notes',''), v_sold_at, v_client_ref, v_user)
  returning * into v_sale;

  -- Segunda pasada: partidas (reparte el descuento general proporcionalmente), inventario
  v_remaining_disc := v_header_disc; v_n := jsonb_array_length(p->'items');
  for e in select * from jsonb_array_elements(p->'items') loop
    v_idx := v_idx + 1;
    v_qty := (e->>'quantity')::int;
    select p2.id, p2.name, p2.sku, p2.price, p2.cost_price, p2.category_id, p2.brand_id, p2.has_variants, t.rate as tax_rate
      into prod from public.products p2 left join public.tax_rates t on t.id = p2.tax_rate_id where p2.id = (e->>'product_id')::uuid;
    v_var_id := null; v_var_name := null; v_var_sku := null; v_var_price := null; v_var_cost := null;
    if nullif(e->>'variant_id','') is not null then
      select id, name, sku, price, cost_price into v_var_id, v_var_name, v_var_sku, v_var_price, v_var_cost from public.product_variants where id = (e->>'variant_id')::uuid;
    end if;
    v_price := coalesce(v_var_price, prod.price);
    if v_allow_override and (e->>'unit_price') is not null then v_price := (e->>'unit_price')::numeric; end if;
    v_cost := coalesce(v_var_cost, prod.cost_price, 0);
    v_rate := coalesce(prod.tax_rate, v_default_rate);
    v_line_disc := coalesce((e->>'discount_amount')::numeric, 0);
    -- reparto proporcional del descuento general (la última partida absorbe el redondeo)
    if v_header_disc > 0 then
      if v_idx = v_n then v_share := v_remaining_disc;
      else v_share := round(v_header_disc * (v_price * v_qty - v_line_disc) / nullif(v_gross - v_line_disc_total, 0), 2); v_remaining_disc := v_remaining_disc - v_share; end if;
    else v_share := 0; end if;
    v_line_total := round(v_price * v_qty - v_line_disc - v_share, 2);
    if v_prices_incl then v_net := round(v_line_total / (1 + v_rate), 2); else v_net := v_line_total; v_line_total := round(v_net * (1 + v_rate), 2); end if;

    insert into public.sale_items (sale_id, organization_id, branch_id, product_id, variant_id, category_id, brand_id, product_name, variant_name, sku,
        quantity, unit_price, unit_cost, discount_amount, promotion_id, tax_rate, tax_amount, line_total, net_amount,
        sold_at, customer_id, neighborhood_id, seller_id, channel, status)
    values (v_sale.id, v_org, v_branch, prod.id, v_var_id, prod.category_id, prod.brand_id, prod.name, v_var_name, coalesce(v_var_sku, prod.sku),
        v_qty, v_price, v_cost, v_line_disc + v_share, nullif(e->>'promotion_id','')::uuid, v_rate, v_line_total - v_net, v_line_total, v_net,
        v_sold_at, v_customer, v_neighborhood, v_seller, v_channel, 'COMPLETED')
    returning id into v_item_id;
    v_tax := v_tax + (v_line_total - v_net); v_total_cost := v_total_cost + v_cost * v_qty;

    perform public.post_inventory_movement(v_org, v_wh, prod.id, v_var_id, 'SALE', -v_qty, 'Venta ' || v_folio, 'SALE', v_sale.id::text, v_user, v_cost);
  end loop;

  -- Pagos + caja
  for e in select * from jsonb_array_elements(p->'payments') loop
    select * into v_pm from public.payment_methods where organization_id = v_org and code = e->>'method_code';
    v_amount := (e->>'amount')::numeric;
    if v_pm.is_cash and v_change > 0 then v_amount := v_amount - v_change; v_change := 0; end if; -- el cambio sale del efectivo
    if v_amount <= 0 then continue; end if;
    insert into public.sale_payments (sale_id, payment_method_id, method_code, amount, reference) values (v_sale.id, v_pm.id, v_pm.code, v_amount, nullif(e->>'reference',''));
    if v_shift is not null then
      insert into public.cash_movements (organization_id, cash_shift_id, movement_type, amount, payment_method_code, affects_cash, reference_type, reference_id, description, user_id)
      values (v_org, v_shift, 'SALE', v_amount, v_pm.code, v_pm.is_cash, 'SALE', v_sale.id::text, 'Venta ' || v_folio, v_user);
    end if;
  end loop;

  update public.sales set subtotal = round(v_total - v_tax, 2), tax_amount = v_tax, total_cost = v_total_cost where id = v_sale.id;

  -- Cliente: estadísticas
  if v_customer is not null then
    update public.customers set purchases_count = purchases_count + 1, total_spent = total_spent + v_total,
           first_purchase_at = coalesce(first_purchase_at, v_sold_at), last_purchase_at = greatest(coalesce(last_purchase_at, v_sold_at), v_sold_at)
     where id = v_customer;
  end if;

  -- Promociones usadas
  update public.promotions pr set uses_count = uses_count + 1 where pr.id in (select distinct promotion_id from public.sale_items where sale_id = v_sale.id and promotion_id is not null);

  perform public.audit_log(v_org, v_user, 'sales.create', 'SALE', v_sale.id::text, null, jsonb_build_object('folio', v_folio, 'total', v_total, 'items', v_items, 'channel', v_channel));
  if v_line_disc_total + v_header_disc > 0 then
    perform public.audit_log(v_org, v_user, 'sales.discount', 'SALE', v_sale.id::text, null,
      jsonb_build_object('folio', v_folio, 'discount', v_line_disc_total + v_header_disc, 'pct', round((v_line_disc_total + v_header_disc) / nullif(v_gross, 0) * 100, 2), 'reason', p->>'discount_reason'));
  end if;
  return public.sale_json(v_sale.id);
end $$;

-- ---------------------------------------------------------------------------
-- CANCEL SALE — regresa inventario completo, registra reembolso en caja si se indica
-- ---------------------------------------------------------------------------
create or replace function public.cancel_sale(p_sale uuid, p_user uuid, p_reason text, p_cash_shift uuid default null)
returns jsonb language plpgsql set search_path = public as $$
declare s public.sales; it record; v_days int; v_shift public.cash_shifts; pay record;
begin
  select * into s from public.sales where id = p_sale for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if s.status = 'CANCELLED' then raise exception 'ESTADO_INVALIDO: la venta ya está cancelada'; end if;
  if s.status in ('REFUNDED','PARTIALLY_REFUNDED') then raise exception 'ESTADO_INVALIDO: esta venta ya tiene devoluciones; no puede cancelarse'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  select coalesce((value->>'allow_cancel_days')::int, 7) into v_days from public.organization_settings where organization_id = s.organization_id and key = 'sales';
  if s.sold_at < now() - make_interval(days => coalesce(v_days, 7)) then raise exception 'FUERA_DE_PLAZO: solo se cancelan ventas de los últimos % días; usa una devolución', coalesce(v_days, 7); end if;

  for it in select * from public.sale_items where sale_id = p_sale and product_id is not null loop
    if it.quantity - it.returned_quantity > 0 then
      perform public.post_inventory_movement(s.organization_id, s.warehouse_id, it.product_id, it.variant_id, 'SALE_RETURN', it.quantity - it.returned_quantity,
        'Cancelación de venta ' || s.folio, 'SALE', s.id::text, p_user, it.unit_cost);
    end if;
  end loop;

  if p_cash_shift is not null then
    select * into v_shift from public.cash_shifts where id = p_cash_shift for update;
    if v_shift.id is null or v_shift.status <> 'OPEN' then raise exception 'TURNO_CERRADO'; end if;
    for pay in select sp.*, pm.is_cash from public.sale_payments sp join public.payment_methods pm on pm.id = sp.payment_method_id where sp.sale_id = p_sale loop
      insert into public.cash_movements (organization_id, cash_shift_id, movement_type, amount, payment_method_code, affects_cash, reference_type, reference_id, description, user_id)
      values (s.organization_id, p_cash_shift, 'REFUND', -pay.amount, pay.method_code, pay.is_cash, 'SALE', s.id::text, 'Cancelación ' || s.folio, p_user);
    end loop;
  end if;

  update public.sales set status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_user, cancel_reason = p_reason, refunded_amount = total where id = p_sale;
  update public.sale_items set status = 'CANCELLED' where sale_id = p_sale;
  if s.customer_id is not null then
    update public.customers set purchases_count = greatest(purchases_count - 1, 0), total_spent = greatest(total_spent - s.total, 0) where id = s.customer_id;
  end if;
  perform public.audit_log(s.organization_id, p_user, 'sales.cancel', 'SALE', s.id::text, to_jsonb(s), null, jsonb_build_object('reason', p_reason, 'folio', s.folio));
  return public.sale_json(p_sale);
end $$;

-- ---------------------------------------------------------------------------
-- SALE RETURN — parcial o total
-- payload: {sale_id, user_id, cash_shift_id?, reason, notes?, refund_method_code, items:[{sale_item_id, quantity, restock?, condition?}]}
-- ---------------------------------------------------------------------------
create or replace function public.create_sale_return(p jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare s public.sales; r public.sale_returns; e jsonb; it public.sale_items; v_qty int; v_unit numeric; v_total numeric := 0; v_user uuid := nullif(p->>'user_id','')::uuid;
        v_shift uuid := nullif(p->>'cash_shift_id','')::uuid; v_method text := p->>'refund_method_code'; v_pm record; v_all boolean; v_restock boolean; v_shift_row public.cash_shifts;
begin
  select * into s from public.sales where id = (p->>'sale_id')::uuid for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if s.status = 'CANCELLED' then raise exception 'ESTADO_INVALIDO: la venta está cancelada'; end if;
  if s.status = 'REFUNDED' then raise exception 'ESTADO_INVALIDO: la venta ya fue devuelta por completo'; end if;
  if coalesce(trim(p->>'reason'), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'SIN_PARTIDAS'; end if;
  select * into v_pm from public.payment_methods where organization_id = s.organization_id and code = v_method and is_active;
  if v_pm.id is null then raise exception 'METODO_PAGO_INVALIDO'; end if;
  if v_shift is not null then
    select * into v_shift_row from public.cash_shifts where id = v_shift for update;
    if v_shift_row.id is null or v_shift_row.status <> 'OPEN' then raise exception 'TURNO_CERRADO'; end if;
  elsif v_pm.is_cash then
    raise exception 'TURNO_REQUERIDO: un reembolso en efectivo necesita un turno abierto';
  end if;

  insert into public.sale_returns (organization_id, folio, sale_id, branch_id, cash_shift_id, reason, notes, refund_amount, refund_method_code, user_id)
  values (s.organization_id, public.next_folio(s.organization_id, 'RETURN', 'DEV'), s.id, s.branch_id, v_shift, p->>'reason', nullif(p->>'notes',''), 0, v_method, v_user) returning * into r;

  for e in select * from jsonb_array_elements(p->'items') loop
    select * into it from public.sale_items where id = (e->>'sale_item_id')::uuid and sale_id = s.id for update;
    if it.id is null then raise exception 'PARTIDA_INVALIDA'; end if;
    v_qty := (e->>'quantity')::int;
    if v_qty is null or v_qty <= 0 or v_qty > it.quantity - it.returned_quantity then raise exception 'CANTIDAD_INVALIDA: % solo tiene % por devolver', it.product_name, it.quantity - it.returned_quantity; end if;
    v_unit := round(it.line_total / it.quantity, 2);
    v_restock := coalesce((e->>'restock')::boolean, true);
    insert into public.sale_return_items (return_id, sale_item_id, product_id, variant_id, quantity, unit_refund, line_total, restock, condition)
    values (r.id, it.id, it.product_id, it.variant_id, v_qty, v_unit, round(v_unit * v_qty, 2), v_restock, coalesce(nullif(e->>'condition',''), 'GOOD'));
    update public.sale_items set returned_quantity = returned_quantity + v_qty where id = it.id;
    v_total := v_total + round(v_unit * v_qty, 2);
    if it.product_id is not null then
      if v_restock then
        perform public.post_inventory_movement(s.organization_id, s.warehouse_id, it.product_id, it.variant_id, 'SALE_RETURN', v_qty, 'Devolución ' || r.folio, 'RETURN', r.id::text, v_user, it.unit_cost);
      else
        -- Entra y sale como merma para dejar rastro del producto dañado
        perform public.post_inventory_movement(s.organization_id, s.warehouse_id, it.product_id, it.variant_id, 'SALE_RETURN', v_qty, 'Devolución ' || r.folio, 'RETURN', r.id::text, v_user, it.unit_cost);
        perform public.post_inventory_movement(s.organization_id, s.warehouse_id, it.product_id, it.variant_id, 'DAMAGE', -v_qty, 'Producto no apto para venta (' || r.folio || ')', 'RETURN', r.id::text, v_user, it.unit_cost);
      end if;
    end if;
  end loop;

  update public.sale_returns set refund_amount = v_total where id = r.id;
  if v_shift is not null then
    insert into public.cash_movements (organization_id, cash_shift_id, movement_type, amount, payment_method_code, affects_cash, reference_type, reference_id, description, user_id)
    values (s.organization_id, v_shift, 'REFUND', -v_total, v_method, v_pm.is_cash, 'RETURN', r.id::text, 'Devolución ' || r.folio || ' de ' || s.folio, v_user);
  end if;
  select bool_and(returned_quantity >= quantity) into v_all from public.sale_items where sale_id = s.id;
  update public.sales set status = case when v_all then 'REFUNDED' else 'PARTIALLY_REFUNDED' end, refunded_amount = refunded_amount + v_total where id = s.id;
  update public.sale_items set status = case when returned_quantity >= quantity then 'REFUNDED' when returned_quantity > 0 then 'PARTIALLY_REFUNDED' else status end where sale_id = s.id;
  if s.customer_id is not null then update public.customers set total_spent = greatest(total_spent - v_total, 0) where id = s.customer_id; end if;
  perform public.audit_log(s.organization_id, v_user, 'sales.refund', 'SALE', s.id::text, null, to_jsonb(r), jsonb_build_object('items', p->'items'));
  return public.sale_json(s.id);
end $$;

-- Seed: métodos de pago y caja para la organización real
do $$
declare v_org uuid; v_branch uuid;
begin
  v_org := public.default_organization_id();
  select id into v_branch from public.branches where organization_id = v_org and is_default;
  insert into public.payment_methods (organization_id, code, name, is_cash, display_order, requires_reference) values
    (v_org, 'CASH', 'Efectivo', true, 1, false),
    (v_org, 'CARD', 'Tarjeta', false, 2, false),
    (v_org, 'TRANSFER', 'Transferencia', false, 3, false),
    (v_org, 'MERCADO_PAGO', 'Mercado Pago', false, 4, false),
    (v_org, 'OTHER', 'Otro', false, 9, false)
  on conflict (organization_id, code) do nothing;
  insert into public.cash_registers (organization_id, branch_id, code, name) values (v_org, v_branch, 'GYM-CAJA1', 'Caja 1')
  on conflict (organization_id, code) do nothing;
end $$;

do $$
declare t text;
begin
  foreach t in array array['neighborhoods','customers','customer_addresses','payment_methods','cash_registers','cash_shifts','cash_movements',
                           'promotions','promotion_products','promotion_categories','sales','sale_items','sale_payments','sale_returns','sale_return_items']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;
revoke all on function public.create_sale(jsonb) from public, anon, authenticated;
revoke all on function public.cancel_sale(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.create_sale_return(jsonb) from public, anon, authenticated;
revoke all on function public.sale_json(uuid) from public, anon, authenticated;
revoke all on function public.open_cash_shift(uuid,uuid,uuid,uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.add_cash_movement(uuid,text,numeric,text,uuid,text,text) from public, anon, authenticated;
revoke all on function public.close_cash_shift(uuid,uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.resolve_neighborhood(uuid,text,text,text,text) from public, anon, authenticated;
