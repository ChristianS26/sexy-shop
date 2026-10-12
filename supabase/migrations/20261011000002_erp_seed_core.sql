-- ============================================================================
-- SONROJA ERP — 002 Seed core
-- Permisos, roles de sistema, organización real, sucursal Guaymas, almacén,
-- IVA 16 %, settings y alta del administrador existente como SUPER_ADMIN.
-- Idempotente.
-- ============================================================================

insert into public.permissions (code, module, description) values
  ('products.read',        'catalog',    'Ver productos'),
  ('products.create',      'catalog',    'Crear productos'),
  ('products.update',      'catalog',    'Editar productos'),
  ('products.delete',      'catalog',    'Eliminar / desactivar productos'),
  ('products.cost.read',   'catalog',    'Ver costo, margen y utilidad'),
  ('products.import',      'catalog',    'Importar productos masivamente'),
  ('categories.manage',    'catalog',    'Administrar categorías'),
  ('brands.manage',        'catalog',    'Administrar marcas'),
  ('inventory.read',       'inventory',  'Ver existencias y movimientos'),
  ('inventory.adjust',     'inventory',  'Ajustar inventario'),
  ('inventory.transfer',   'inventory',  'Transferir entre almacenes'),
  ('inventory.count',      'inventory',  'Realizar conteos físicos'),
  ('suppliers.manage',     'purchasing', 'Administrar proveedores'),
  ('purchases.read',       'purchasing', 'Ver órdenes de compra'),
  ('purchases.create',     'purchasing', 'Crear órdenes de compra'),
  ('purchases.update',     'purchasing', 'Editar órdenes de compra'),
  ('purchases.receive',    'purchasing', 'Recibir mercancía'),
  ('purchases.cancel',     'purchasing', 'Cancelar órdenes de compra'),
  ('sales.read',           'sales',      'Ver todas las ventas'),
  ('sales.read.own',       'sales',      'Ver únicamente ventas propias'),
  ('sales.create',         'sales',      'Crear ventas (POS)'),
  ('sales.update',         'sales',      'Editar notas / cliente de una venta'),
  ('sales.cancel',         'sales',      'Cancelar ventas'),
  ('sales.refund',         'sales',      'Registrar devoluciones'),
  ('sales.discount',       'sales',      'Aplicar descuentos'),
  ('promotions.manage',    'sales',      'Administrar promociones'),
  ('customers.read',       'customers',  'Ver clientes'),
  ('customers.create',     'customers',  'Crear clientes'),
  ('customers.update',     'customers',  'Editar clientes'),
  ('customers.delete',     'customers',  'Eliminar clientes'),
  ('customers.export',     'customers',  'Exportar datos de clientes'),
  ('cash.read',            'cash',       'Ver cajas y turnos'),
  ('cash.open',            'cash',       'Abrir turno de caja'),
  ('cash.close',           'cash',       'Cerrar turno de caja'),
  ('cash.movements',       'cash',       'Registrar entradas/salidas de efectivo'),
  ('expenses.manage',      'cash',       'Registrar y editar gastos'),
  ('analytics.read',       'bi',         'Ver analytics y dashboards'),
  ('analytics.financial',  'bi',         'Ver rentabilidad y finanzas'),
  ('reports.read',         'reports',    'Ver reportes'),
  ('reports.export',       'reports',    'Exportar reportes'),
  ('users.read',           'admin',      'Ver usuarios'),
  ('users.create',         'admin',      'Crear usuarios'),
  ('users.update',         'admin',      'Editar usuarios'),
  ('users.delete',         'admin',      'Eliminar usuarios'),
  ('roles.manage',         'admin',      'Administrar roles y permisos'),
  ('branches.manage',      'admin',      'Administrar sucursales y almacenes'),
  ('settings.manage',      'admin',      'Configuración de empresa, tickets, impuestos'),
  ('settings.system',      'admin',      'Configuración crítica del sistema'),
  ('audit.read',           'admin',      'Ver auditoría'),
  ('alerts.read',          'admin',      'Ver alertas'),
  ('alerts.resolve',       'admin',      'Resolver alertas')
on conflict (code) do update set module = excluded.module, description = excluded.description;

-- Roles de sistema (organization_id null)
insert into public.roles (code, name, description, is_system, max_discount_pct) values
  ('SUPER_ADMIN', 'Super administrador', 'Acceso total, incluida configuración crítica', true, null),
  ('ADMIN',       'Administrador',       'Todo excepto configuración crítica del sistema', true, null),
  ('MANAGER',     'Gerente',             'Analytics, inventario, compras, caja y vendedores', true, 20),
  ('SALES',       'Vendedor',            'POS, clientes y sus propias ventas', true, 5),
  ('WAREHOUSE',   'Almacén',             'Inventario, recepciones y transferencias', true, 0),
  ('ACCOUNTING',  'Contabilidad',        'Finanzas, gastos, caja y reportes', true, 0),
  ('ANALYST',     'Analista',            'Solo lectura de analytics y reportes', true, 0)
on conflict do nothing;

-- Permisos por rol
with r as (select id, code from public.roles where is_system),
grants as (
  select 'SUPER_ADMIN' role_code, code perm from public.permissions
  union all select 'ADMIN', code from public.permissions where code <> 'settings.system'
  union all select 'MANAGER', unnest(array[
    'products.read','products.create','products.update','products.delete','products.cost.read','products.import','categories.manage','brands.manage',
    'inventory.read','inventory.adjust','inventory.transfer','inventory.count',
    'suppliers.manage','purchases.read','purchases.create','purchases.update','purchases.receive','purchases.cancel',
    'sales.read','sales.create','sales.update','sales.cancel','sales.refund','sales.discount','promotions.manage',
    'customers.read','customers.create','customers.update','customers.delete','customers.export',
    'cash.read','cash.open','cash.close','cash.movements','expenses.manage',
    'analytics.read','analytics.financial','reports.read','reports.export',
    'users.read','alerts.read','alerts.resolve','audit.read'])
  union all select 'SALES', unnest(array[
    'products.read','sales.create','sales.read.own','sales.discount','customers.read','customers.create','customers.update',
    'cash.open','cash.close','cash.movements','alerts.read'])
  union all select 'WAREHOUSE', unnest(array[
    'products.read','products.update','inventory.read','inventory.adjust','inventory.transfer','inventory.count',
    'purchases.read','purchases.receive','suppliers.manage','alerts.read','alerts.resolve'])
  union all select 'ACCOUNTING', unnest(array[
    'products.read','products.cost.read','sales.read','customers.read','cash.read','cash.movements','expenses.manage',
    'purchases.read','analytics.read','analytics.financial','reports.read','reports.export','audit.read','alerts.read'])
  union all select 'ANALYST', unnest(array[
    'products.read','products.cost.read','sales.read','customers.read','inventory.read','purchases.read',
    'analytics.read','analytics.financial','reports.read','reports.export'])
)
insert into public.role_permissions (role_id, permission_code)
select r.id, g.perm from grants g join r on r.code = g.role_code
on conflict do nothing;

-- Organización real
insert into public.organizations (slug, name, legal_name, tagline, is_default)
values ('sonroja', 'SONROJA', 'SONROJA', 'Sensual. Confiada. Libre.', true)
on conflict (slug) do nothing;

do $$
declare v_org uuid; v_branch uuid; v_wh uuid; v_admin uuid := 'c8d2b6a6-6476-4c59-9182-28a3f28bb904'; v_role uuid;
begin
  select id into v_org from public.organizations where slug = 'sonroja';

  insert into public.branches (organization_id, code, name, city, state, is_default)
  values (v_org, 'GYM', 'Guaymas Centro', 'Guaymas', 'Sonora', true)
  on conflict (organization_id, code) do nothing;
  select id into v_branch from public.branches where organization_id = v_org and code = 'GYM';

  insert into public.warehouses (organization_id, branch_id, code, name, is_default, is_default_online)
  values (v_org, v_branch, 'GYM-ALM', 'Almacén Guaymas', true, true)
  on conflict (organization_id, code) do nothing;
  select id into v_wh from public.warehouses where organization_id = v_org and code = 'GYM-ALM';

  insert into public.tax_rates (organization_id, code, name, rate, is_default)
  values (v_org, 'IVA16', 'IVA 16 %', 0.16, true)
  on conflict (organization_id, code) do nothing;
  insert into public.tax_rates (organization_id, code, name, rate, is_default)
  values (v_org, 'IVA0', 'IVA 0 %', 0, false)
  on conflict (organization_id, code) do nothing;

  insert into public.organization_settings (organization_id, key, value) values
    (v_org, 'company',   jsonb_build_object('name','SONROJA','tagline','Sensual. Confiada. Libre.','phone','','email','','website','sexyshoptoys.com.mx')),
    (v_org, 'locale',    jsonb_build_object('currency','MXN','timezone','America/Hermosillo','country','MX','locale','es-MX')),
    (v_org, 'tax',       jsonb_build_object('prices_include_tax', true, 'default_rate_code', 'IVA16')),
    (v_org, 'ticket',    jsonb_build_object('header','SONROJA','tagline','Sensual. Confiada. Libre.','footer','Gracias por tu compra. Envío y empaque discretos.','show_customer', false, 'width_mm', 80)),
    (v_org, 'inventory', jsonb_build_object('cost_method','LAST','default_min_stock',3,'critical_ratio',0.5,'dead_stock_days',90,'allow_negative', false)),
    (v_org, 'alerts',    jsonb_build_object('cash_difference_threshold', 50, 'cancellations_per_day', 3, 'discounts_pct_per_day', 15, 'returns_per_week', 5, 'business_hours', jsonb_build_object('open', 10, 'close', 21))),
    (v_org, 'security',  jsonb_build_object('session_hours', 12, 'discreet_mode_default', false)),
    (v_org, 'sales',     jsonb_build_object('folio_prefix','SON','allow_cancel_days', 7, 'require_shift_for_cash', true))
  on conflict (organization_id, key) do nothing;

  -- Alta del administrador existente (auth.users) como SUPER_ADMIN
  if exists (select 1 from auth.users where id = v_admin) then
    insert into public.users (id, organization_id, first_name, last_name, email, username, default_branch_id)
    values (v_admin, v_org, 'Christian', '', 'christianug26@gmail.com', 'christian', v_branch)
    on conflict (id) do nothing;
    select id into v_role from public.roles where code = 'SUPER_ADMIN' and organization_id is null;
    insert into public.user_roles (user_id, role_id) values (v_admin, v_role) on conflict do nothing;
    insert into public.user_branches (user_id, branch_id) values (v_admin, v_branch) on conflict do nothing;
  end if;
end $$;
