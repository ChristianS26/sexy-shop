-- ============================================================================
-- SONROJA ERP — 001 Core
-- Organizaciones, sucursales, almacenes, usuarios, RBAC, auditoría,
-- notificaciones, folios, impuestos, archivos y settings por organización.
-- Aditiva: no altera columnas que use el storefront.
-- ============================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.normalize_text(p text)
returns text language sql immutable parallel safe set search_path = public, extensions as $$
  select lower(trim(regexp_replace(extensions.unaccent(coalesce(p, '')), '\s+', ' ', 'g')));
$$;

create or replace function public.raise_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'IMMUTABLE_ROW: % no admite % ', tg_table_name, tg_op using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------
-- Organizaciones / sucursales / almacenes
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  legal_name    text,
  rfc           text,
  tagline       text,
  currency      text not null default 'MXN',
  country       text not null default 'MX',
  timezone      text not null default 'America/Hermosillo',
  logo_url      text,
  is_default    boolean not null default false,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_organizations_default on public.organizations (is_default) where is_default;
create trigger trg_organizations_updated before update on public.organizations for each row execute function public.set_updated_at();

create table if not exists public.branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  phone           text,
  email           text,
  street          text,
  ext_number      text,
  neighborhood    text,
  zip             text,
  city            text,
  state           text,
  is_default      boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);
create unique index if not exists uq_branches_default on public.branches (organization_id) where is_default;
create trigger trg_branches_updated before update on public.branches for each row execute function public.set_updated_at();

create table if not exists public.warehouses (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  branch_id         uuid not null references public.branches(id) on delete cascade,
  code              text not null,
  name              text not null,
  is_default        boolean not null default false,
  is_default_online boolean not null default false,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, code)
);
create unique index if not exists uq_warehouses_default_branch on public.warehouses (branch_id) where is_default;
create unique index if not exists uq_warehouses_default_online on public.warehouses (organization_id) where is_default_online;
create trigger trg_warehouses_updated before update on public.warehouses for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RBAC
-- ---------------------------------------------------------------------------
create table if not exists public.permissions (
  code        text primary key,
  module      text not null,
  description text not null
);

create table if not exists public.roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete cascade, -- null = rol de sistema
  code             text not null,
  name             text not null,
  description      text,
  is_system        boolean not null default false,
  max_discount_pct numeric(5,2),  -- null = sin límite
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists uq_roles_code on public.roles (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
create trigger trg_roles_updated before update on public.roles for each row execute function public.set_updated_at();

create table if not exists public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table if not exists public.users (
  id                uuid primary key references auth.users(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  first_name        text not null,
  last_name         text not null default '',
  email             text not null,
  phone             text,
  username          text not null,
  status            text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','SUSPENDED')),
  default_branch_id uuid references public.branches(id),
  avatar_url        text,
  last_login_at     timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        uuid
);
create unique index if not exists uq_users_username on public.users (organization_id, lower(username)) where deleted_at is null;
create unique index if not exists uq_users_email on public.users (organization_id, lower(email)) where deleted_at is null;
create index if not exists idx_users_org on public.users (organization_id, status);
create trigger trg_users_updated before update on public.users for each row execute function public.set_updated_at();

create table if not exists public.user_roles (
  user_id uuid not null references public.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (user_id, role_id)
);

create table if not exists public.user_branches (
  user_id   uuid not null references public.users(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  primary key (user_id, branch_id)
);

-- Permisos efectivos de un usuario (unión de sus roles)
create or replace function public.user_permissions(p_user uuid)
returns table (permission_code text)
language sql stable set search_path = public as $$
  select distinct rp.permission_code
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
   where ur.user_id = p_user;
$$;

-- Perfil completo para el backend (una sola llamada al autenticar)
create or replace function public.auth_context(p_user uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'user', to_jsonb(u) - 'deleted_at' - 'deleted_by',
    'organization', to_jsonb(o),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name, 'max_discount_pct', r.max_discount_pct))
                        from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = u.id), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(permission_code) from public.user_permissions(u.id)), '[]'::jsonb),
    'branches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name))
                           from public.user_branches ub join public.branches b on b.id = ub.branch_id where ub.user_id = u.id and b.is_active), '[]'::jsonb),
    'max_discount_pct', (select case when bool_or(r.max_discount_pct is null) then null else max(r.max_discount_pct) end
                           from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = u.id)
  )
  from public.users u
  join public.organizations o on o.id = u.organization_id
  where u.id = p_user and u.deleted_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Auditoría (insert-only)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid,
  user_id         uuid,
  user_name       text,
  action          text not null,
  entity_type     text,
  entity_id       text,
  ip              text,
  metadata        jsonb,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_audit_org_created on public.audit_logs (organization_id, created_at desc);
create index if not exists idx_audit_entity on public.audit_logs (entity_type, entity_id);
create index if not exists idx_audit_user on public.audit_logs (user_id, created_at desc);
create trigger trg_audit_immutable before update or delete on public.audit_logs for each row execute function public.raise_immutable();

create or replace function public.audit_log(
  p_org uuid, p_user uuid, p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_metadata jsonb default null, p_ip text default null
) returns bigint language plpgsql set search_path = public as $$
declare v_id bigint; v_name text;
begin
  select first_name || ' ' || last_name into v_name from public.users where id = p_user;
  insert into public.audit_logs (organization_id, user_id, user_name, action, entity_type, entity_id, ip, metadata, before, after)
  values (p_org, p_user, v_name, p_action, p_entity_type, p_entity_id, p_ip, p_metadata, p_before, p_after)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Notificaciones / alertas
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete cascade,
  user_id         uuid references public.users(id) on delete cascade, -- null = para toda la organización
  type            text not null,
  severity        text not null default 'INFO' check (severity in ('INFO','SUCCESS','WARNING','CRITICAL')),
  title           text not null,
  description     text,
  entity_type     text,
  entity_id       text,
  status          text not null default 'UNREAD' check (status in ('UNREAD','READ','RESOLVED')),
  dedupe_key      text,
  metadata        jsonb,
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  resolved_at     timestamptz,
  resolved_by     uuid
);
create index if not exists idx_notifications_org_status on public.notifications (organization_id, status, created_at desc);
create unique index if not exists uq_notifications_dedupe on public.notifications (organization_id, dedupe_key) where dedupe_key is not null and status <> 'RESOLVED';

-- Crea una alerta si no existe una abierta con la misma clave; actualiza texto si ya existe.
create or replace function public.upsert_notification(
  p_org uuid, p_type text, p_severity text, p_title text, p_description text,
  p_entity_type text, p_entity_id text, p_dedupe_key text, p_branch uuid default null, p_metadata jsonb default null
) returns uuid language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  insert into public.notifications (organization_id, branch_id, type, severity, title, description, entity_type, entity_id, dedupe_key, metadata)
  values (p_org, p_branch, p_type, p_severity, p_title, p_description, p_entity_type, p_entity_id, p_dedupe_key, p_metadata)
  on conflict (organization_id, dedupe_key) where dedupe_key is not null and status <> 'RESOLVED'
  do update set severity = excluded.severity, title = excluded.title, description = excluded.description, metadata = excluded.metadata
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.resolve_notifications_by_key(p_org uuid, p_dedupe_key text)
returns void language sql set search_path = public as $$
  update public.notifications set status = 'RESOLVED', resolved_at = now()
   where organization_id = p_org and dedupe_key = p_dedupe_key and status <> 'RESOLVED';
$$;

-- ---------------------------------------------------------------------------
-- Folios (nunca se reutilizan)
-- ---------------------------------------------------------------------------
create table if not exists public.document_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  doc_type        text not null,
  year            int  not null,
  last_number     int  not null default 0,
  primary key (organization_id, doc_type, year)
);

create or replace function public.next_folio(p_org uuid, p_doc_type text, p_prefix text)
returns text language plpgsql set search_path = public as $$
declare v_year int := extract(year from now())::int; v_n int;
begin
  insert into public.document_sequences (organization_id, doc_type, year, last_number)
  values (p_org, p_doc_type, v_year, 1)
  on conflict (organization_id, doc_type, year)
  do update set last_number = public.document_sequences.last_number + 1
  returning last_number into v_n;
  return format('%s-%s-%s', p_prefix, v_year, lpad(v_n::text, 6, '0'));
end $$;

-- ---------------------------------------------------------------------------
-- Impuestos, archivos, settings por organización
-- ---------------------------------------------------------------------------
create table if not exists public.tax_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  rate            numeric(6,4) not null check (rate >= 0 and rate < 1),
  is_default      boolean not null default false,
  is_active       boolean not null default true,
  unique (organization_id, code)
);
create unique index if not exists uq_tax_rates_default on public.tax_rates (organization_id) where is_default;

create table if not exists public.files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  bucket          text not null,
  path            text not null,
  url             text not null,
  mime_type       text,
  size_bytes      bigint,
  entity_type     text,
  entity_id       text,
  uploaded_by     uuid,
  created_at      timestamptz not null default now()
);
create index if not exists idx_files_entity on public.files (entity_type, entity_id);

create table if not exists public.organization_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             text not null,
  value           jsonb not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  primary key (organization_id, key)
);

-- ---------------------------------------------------------------------------
-- RLS: todo cerrado; el backend usa service_role.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['organizations','branches','warehouses','permissions','roles','role_permissions','users','user_roles','user_branches',
                           'audit_logs','notifications','document_sequences','tax_rates','files','organization_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Las funciones expuestas por PostgREST no deben poder llamarse sin service_role.
revoke all on function public.audit_log(uuid,uuid,text,text,text,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.upsert_notification(uuid,text,text,text,text,text,text,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.resolve_notifications_by_key(uuid,text) from public, anon, authenticated;
revoke all on function public.next_folio(uuid,text,text) from public, anon, authenticated;
revoke all on function public.auth_context(uuid) from public, anon, authenticated;
revoke all on function public.user_permissions(uuid) from public, anon, authenticated;
revoke all on function public.raise_immutable() from public, anon, authenticated;
