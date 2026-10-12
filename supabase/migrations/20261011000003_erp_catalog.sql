-- ============================================================================
-- SONROJA ERP — 003 Catálogo
-- Evoluciona categories/products (aditivo) y crea brands, suppliers,
-- product_variants. Backfill a la organización por defecto.
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

create or replace function public.default_organization_id()
returns uuid language sql stable set search_path = public as $$
  select id from public.organizations where is_default limit 1;
$$;

-- Trigger genérico: si una fila llega sin organization_id, usa la organización por defecto
create or replace function public.fill_default_org()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.organization_id is null then
    new.organization_id := public.default_organization_id();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Categorías (jerárquicas)
-- ---------------------------------------------------------------------------
alter table public.categories
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists parent_id       uuid references public.categories(id) on delete set null,
  add column if not exists description     text,
  add column if not exists is_active       boolean not null default true,
  add column if not exists updated_at      timestamptz not null default now(),
  add column if not exists deleted_at      timestamptz,
  add column if not exists deleted_by      uuid;
alter table public.categories alter column icon set default '';
update public.categories set organization_id = public.default_organization_id() where organization_id is null;
alter table public.categories alter column organization_id set not null;
create index if not exists idx_categories_org_parent on public.categories (organization_id, parent_id);
drop trigger if exists trg_categories_fill_org on public.categories;
create trigger trg_categories_fill_org before insert on public.categories for each row execute function public.fill_default_org();
drop trigger if exists trg_categories_updated on public.categories;
create trigger trg_categories_updated before update on public.categories for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Marcas
-- ---------------------------------------------------------------------------
create table if not exists public.brands (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  slug            text not null,
  logo_url        text,
  description     text,
  website         text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid
);
create unique index if not exists uq_brands_slug on public.brands (organization_id, slug) where deleted_at is null;
create trigger trg_brands_updated before update on public.brands for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------------
create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text,
  name            text not null,
  rfc             text,
  contact_name    text,
  phone           text,
  email           text,
  website         text,
  street          text,
  neighborhood    text,
  zip             text,
  city            text,
  state           text,
  country         text default 'MX',
  payment_terms   text,
  lead_time_days  int,
  status          text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid
);
create index if not exists idx_suppliers_org on public.suppliers (organization_id, status);
create trigger trg_suppliers_updated before update on public.suppliers for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Productos (evolución aditiva)
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists sku             text,
  add column if not exists barcode         text,
  add column if not exists short_name      text,
  add column if not exists brand_id        uuid references public.brands(id) on delete set null,
  add column if not exists supplier_id     uuid references public.suppliers(id) on delete set null,
  add column if not exists tax_rate_id     uuid references public.tax_rates(id) on delete set null,
  add column if not exists unit            text not null default 'PZA',
  add column if not exists max_stock       int,
  add column if not exists status          text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','DISCONTINUED','DRAFT')),
  add column if not exists has_variants    boolean not null default false,
  add column if not exists search_text     text,
  add column if not exists created_by      uuid,
  add column if not exists updated_by      uuid,
  add column if not exists deleted_at      timestamptz,
  add column if not exists deleted_by      uuid;

update public.products set organization_id = public.default_organization_id() where organization_id is null;
alter table public.products alter column organization_id set not null;

-- SKU para productos existentes sin SKU
with numbered as (
  select id, row_number() over (order by created_at, name) n from public.products where sku is null
)
update public.products p set sku = 'SNR-' || lpad(n.n::text, 5, '0') from numbered n where n.id = p.id;

update public.products set status = case when is_active then 'ACTIVE' else 'INACTIVE' end where status = 'ACTIVE' and not is_active;

create unique index if not exists uq_products_sku on public.products (organization_id, upper(sku)) where sku is not null and deleted_at is null;
create unique index if not exists uq_products_barcode on public.products (organization_id, barcode) where barcode is not null and deleted_at is null;
create index if not exists idx_products_org_status on public.products (organization_id, status, deleted_at);
create index if not exists idx_products_brand on public.products (brand_id);
create index if not exists idx_products_supplier on public.products (supplier_id);
create index if not exists idx_products_search on public.products using gin (search_text extensions.gin_trgm_ops);

create or replace function public.products_before_write()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if new.organization_id is null then new.organization_id := public.default_organization_id(); end if;
  if new.sku is not null then new.sku := upper(trim(new.sku)); end if;
  if new.barcode is not null and trim(new.barcode) = '' then new.barcode := null; end if;
  -- is_active (storefront) y status (ERP) se mantienen coherentes
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.is_active := (new.status = 'ACTIVE');
  elsif tg_op = 'UPDATE' and new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'ACTIVE' else 'INACTIVE' end;
  elsif tg_op = 'INSERT' then
    if new.status = 'ACTIVE' and not new.is_active then new.status := 'INACTIVE'; end if;
    if new.status <> 'ACTIVE' then new.is_active := false; end if;
  end if;
  new.search_text := public.normalize_text(concat_ws(' ', new.name, new.short_name, new.sku, new.barcode));
  return new;
end $$;
drop trigger if exists trg_products_before_write on public.products;
create trigger trg_products_before_write before insert or update on public.products for each row execute function public.products_before_write();

update public.products set search_text = public.normalize_text(concat_ws(' ', name, short_name, sku, barcode)) where search_text is null;

-- Política pública del storefront: solo la organización por defecto y sin borrados
drop policy if exists "Public read active products" on public.products;
create policy "Public read active products" on public.products for select
  using (is_active = true and deleted_at is null and organization_id = public.default_organization_id());
drop policy if exists "Public read categories" on public.categories;
create policy "Public read categories" on public.categories for select
  using (deleted_at is null and organization_id = public.default_organization_id());

-- ---------------------------------------------------------------------------
-- Variantes (color, talla, presentación, aroma, modelo…)
-- ---------------------------------------------------------------------------
create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  sku         text,
  barcode     text,
  name        text not null,                 -- "Rosa", "250 ml"
  attributes  jsonb not null default '{}',   -- {"color":"Rosa"} / {"presentacion":"250 ml"}
  price       numeric(10,2),                 -- null = hereda del producto
  cost_price  numeric(10,2),
  image_url   text,
  is_active   boolean not null default true,
  display_order int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists idx_variants_product on public.product_variants (product_id);
create unique index if not exists uq_variants_sku on public.product_variants (upper(sku)) where sku is not null and deleted_at is null;
create unique index if not exists uq_variants_barcode on public.product_variants (barcode) where barcode is not null and deleted_at is null;
create trigger trg_variants_updated before update on public.product_variants for each row execute function public.set_updated_at();

create or replace function public.variants_after_write()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.products p set has_variants = exists (select 1 from public.product_variants v where v.product_id = p.id and v.deleted_at is null)
   where p.id = coalesce(new.product_id, old.product_id);
  return null;
end $$;
drop trigger if exists trg_variants_after_write on public.product_variants;
create trigger trg_variants_after_write after insert or update or delete on public.product_variants for each row execute function public.variants_after_write();

alter table public.brands enable row level security;
alter table public.suppliers enable row level security;
alter table public.product_variants enable row level security;
