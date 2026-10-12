-- ============================================================================
-- SONROJA ERP — 009 Datos demo
-- Organización "Sonroja Demo" completamente aislada (is_demo = true).
--   select public.seed_demo_data();   -> genera todo (idempotente)
--   select public.purge_demo_data();  -> elimina todo rastro
-- Usuarios demo (password: Sonroja2026!):
--   demo.admin@sonroja.demo (ADMIN), demo.gerente@sonroja.demo (MANAGER),
--   demo.ana@sonroja.demo / demo.lucia@sonroja.demo (SALES), demo.almacen@sonroja.demo (WAREHOUSE)
-- ============================================================================

create or replace function public.seed_demo_user(p_org uuid, p_email text, p_first text, p_last text, p_username text, p_role text, p_branch uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_role uuid;
begin
  select id into v_id from auth.users where email = p_email;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user, is_anonymous)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email, crypt('Sonroja2026!', gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', p_first || ' ' || p_last, 'demo', true), now(), now(), '', '', '', '', false, false);
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
  end if;
  insert into public.users (id, organization_id, first_name, last_name, email, username, default_branch_id)
  values (v_id, p_org, p_first, p_last, p_email, p_username, p_branch) on conflict (id) do nothing;
  select id into v_role from public.roles where code = p_role and organization_id is null;
  insert into public.user_roles (user_id, role_id) values (v_id, v_role) on conflict do nothing;
  insert into public.user_branches (user_id, branch_id) values (v_id, p_branch) on conflict do nothing;
  return v_id;
end $$;

create or replace function public.seed_demo_data()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org uuid; v_gym uuid; v_sc uuid; v_wh_gym uuid; v_wh_sc uuid; v_reg_gym uuid; v_reg_sc uuid;
  u_admin uuid; u_mgr uuid; u_ana uuid; u_lucia uuid; u_alm uuid;
  cat_ids uuid[]; sub record; brand_ids uuid[]; sup_ids uuid[];
  i int; j int; k int; n int;
  v_cat uuid; v_parent uuid; v_pid uuid; v_price numeric; v_cost numeric; v_name text; v_tier int;
  prod_ids uuid[]; prod_weights numeric[]; prod_prices numeric[]; prod_has_var boolean[]; prod_var_ids uuid[][];
  cust_ids uuid[]; loyal_ids uuid[];
  neigh text[] := array['Centro','San Vicente','Las Villas','Las Playitas','Loma Linda','Miramar','Colinas','Fátima','Lomas de Cortés','Petrolera','Independencia','Guadalupe','Delicias','Golondrinas','Vista Hermosa','Yucatán','Las Palmas','Burócrata','Rastro','Punta Arena','Villa del Mar','Cantera','La Cascada','Adolfo de la Huerta','Los Pinos'];
  neigh_w numeric[] := array[14,11,9,8,7,6,6,5,5,4,4,4,3,3,3,3,2,2,2,2,2,2,1,1,1];
  neigh_zip text[] := array['85400','85410','85420','85440','85430','85450','85410','85420','85440','85450','85430','85410','85420','85440','85430','85450','85410','85420','85440','85506','85506','85430','85450','85420','85410'];
  first_names text[] := array['María','Ana','Lucía','Sofía','Valeria','Camila','Fernanda','Daniela','Gabriela','Paola','Andrea','Mariana','Alejandra','Karla','Jimena','Regina','Natalia','Renata','Ximena','Isabella','Carlos','José','Luis','Juan','Miguel','Jorge','Diego','Fernando','Ricardo','Eduardo','Alberto','Francisco','Javier','Raúl','Sergio','Héctor','Adrián','Rodrigo','Emilio','Iván'];
  last_names text[] := array['García','Hernández','López','Martínez','González','Rodríguez','Pérez','Sánchez','Ramírez','Torres','Flores','Rivera','Gómez','Díaz','Cruz','Morales','Reyes','Jiménez','Ruiz','Álvarez','Castillo','Romero','Mendoza','Ortiz','Vázquez','Castro','Núñez','Valenzuela','Félix','Bórquez','Ruelas','Encinas','Moreno','Quintero','Salazar','Ibarra','Acosta','Córdova','Esquer','Verdugo'];
  v_cust uuid; v_day date; v_ts timestamptz; v_dow int; v_hour int; v_branch uuid; v_wh uuid; v_reg uuid; v_seller uuid; v_shift public.cash_shifts;
  v_items jsonb; v_payments jsonb; v_total numeric; v_pm text; v_disc numeric; v_sale jsonb; v_channel text; v_qty int; v_pidx int; v_item_total numeric;
  v_day_sales int; v_start date := (current_date - 364); v_weight numeric; v_counted numeric; v_r numeric; v_ret jsonb; v_po public.purchase_orders; v_po_items jsonb;
  v_sales int := 0; v_returns int := 0; v_cancels int := 0; v_shifts int := 0; v_pos int := 0;
  v_expected numeric; v_last_shift_day date := null; cancel_ids uuid[] := '{}'; v_tz text := 'America/Hermosillo'; v_wsum numeric := 0;
  cat_names text[]; cat_children text[][];
begin
  if exists (select 1 from public.organizations where slug = 'sonroja-demo') then
    return jsonb_build_object('status', 'already_seeded');
  end if;
  perform setseed(0.42);

  -- ── Organización, sucursales, almacenes, cajas ────────────────────────────
  insert into public.organizations (slug, name, legal_name, tagline, is_demo) values ('sonroja-demo', 'Sonroja Demo', 'Sonroja Demo S.A. de C.V.', 'Sensual. Confiada. Libre.', true) returning id into v_org;
  insert into public.branches (organization_id, code, name, city, state, street, neighborhood, zip, phone, is_default) values (v_org, 'DEMO-GYM', 'Guaymas Centro', 'Guaymas', 'Sonora', 'Av. Serdán 120', 'Centro', '85400', '622 222 7950', true) returning id into v_gym;
  insert into public.branches (organization_id, code, name, city, state, street, neighborhood, zip, phone) values (v_org, 'DEMO-SC', 'San Carlos', 'Guaymas', 'Sonora', 'Blvd. Manlio Fabio Beltrones 45', 'San Carlos', '85506', '622 226 1100') returning id into v_sc;
  insert into public.warehouses (organization_id, branch_id, code, name, is_default, is_default_online) values (v_org, v_gym, 'DEMO-GYM-ALM', 'Almacén Guaymas', true, true) returning id into v_wh_gym;
  insert into public.warehouses (organization_id, branch_id, code, name, is_default) values (v_org, v_sc, 'DEMO-SC-ALM', 'Almacén San Carlos', true) returning id into v_wh_sc;
  insert into public.cash_registers (organization_id, branch_id, code, name) values (v_org, v_gym, 'DEMO-GYM-C1', 'Caja 1 Guaymas') returning id into v_reg_gym;
  insert into public.cash_registers (organization_id, branch_id, code, name) values (v_org, v_sc, 'DEMO-SC-C1', 'Caja 1 San Carlos') returning id into v_reg_sc;
  insert into public.tax_rates (organization_id, code, name, rate, is_default) values (v_org, 'IVA16', 'IVA 16 %', 0.16, true), (v_org, 'IVA0', 'IVA 0 %', 0, false);
  insert into public.payment_methods (organization_id, code, name, is_cash, display_order) values
    (v_org, 'CASH', 'Efectivo', true, 1), (v_org, 'CARD', 'Tarjeta', false, 2), (v_org, 'TRANSFER', 'Transferencia', false, 3), (v_org, 'MERCADO_PAGO', 'Mercado Pago', false, 4), (v_org, 'OTHER', 'Otro', false, 9);
  insert into public.organization_settings (organization_id, key, value)
    select v_org, key, value from public.organization_settings where organization_id = public.default_organization_id();
  update public.organization_settings set value = value || '{"allow_cancel_days": 100000}'::jsonb where organization_id = v_org and key = 'sales';
  insert into public.expense_categories (organization_id, code, name, display_order)
    select v_org, code, name, display_order from public.expense_categories where organization_id = public.default_organization_id();

  -- ── Usuarios demo ──────────────────────────────────────────────────────────
  u_admin := public.seed_demo_user(v_org, 'demo.admin@sonroja.demo', 'Valentina', 'Rojas', 'valentina', 'ADMIN', v_gym);
  u_mgr   := public.seed_demo_user(v_org, 'demo.gerente@sonroja.demo', 'Carolina', 'Esquer', 'carolina', 'MANAGER', v_gym);
  u_ana   := public.seed_demo_user(v_org, 'demo.ana@sonroja.demo', 'Ana', 'Valenzuela', 'ana', 'SALES', v_gym);
  u_lucia := public.seed_demo_user(v_org, 'demo.lucia@sonroja.demo', 'Lucía', 'Córdova', 'lucia', 'SALES', v_sc);
  u_alm   := public.seed_demo_user(v_org, 'demo.almacen@sonroja.demo', 'Marco', 'Ibarra', 'marco', 'WAREHOUSE', v_gym);
  insert into public.user_branches (user_id, branch_id) values (u_admin, v_sc), (u_mgr, v_sc), (u_ana, v_sc) on conflict do nothing;

  -- ── Categorías (jerarquía) ────────────────────────────────────────────────
  cat_names := array['Vibradores','Lubricantes','Lencería','Estimulación','Accesorios','Bienestar íntimo','Juegos','Masaje','Cuidado personal','Kits'];
  cat_children := array[
    array['Clásicos','Rabbit','Bullet'], array['Base agua','Saborizados','Efecto calor'], array['Bodys','Conjuntos','Disfraces'], array['Succionadores','Anillos','Puntos G'],
    array['Esposas','Antifaces','Plumas'], array['Cuidado íntimo','Limpieza de juguetes','Preservativos'], array['Parejas','Cartas y dados','BDSM suave'],
    array['Aceites','Velas','Geles'], array['Depilación','Hidratación','Perfumes'], array['Kit pareja','Kit principiante','Kit premium']];
  cat_ids := '{}';
  for i in 1..array_length(cat_names, 1) loop
    insert into public.categories (organization_id, name, slug, icon, display_order, description)
    values (v_org, cat_names[i], 'demo-' || lower(regexp_replace(public.normalize_text(cat_names[i]), '\s+', '-', 'g')), '', i, 'Categoría demo') returning id into v_parent;
    for j in 1..3 loop
      insert into public.categories (organization_id, parent_id, name, slug, icon, display_order)
      values (v_org, v_parent, cat_children[i][j], 'demo-' || lower(regexp_replace(public.normalize_text(cat_names[i] || '-' || cat_children[i][j]), '\s+', '-', 'g')), '', j) returning id into v_cat;
      cat_ids := cat_ids || v_cat;
    end loop;
  end loop;

  -- ── Marcas y proveedores ──────────────────────────────────────────────────
  brand_ids := '{}';
  for v_name in select unnest(array['Satisfyer','Lelo','Durex','Sensuelle','Secret Play','Fun Factory','Shunga','Sonroja Selección']) loop
    insert into public.brands (organization_id, name, slug, website) values (v_org, v_name, 'demo-' || lower(regexp_replace(public.normalize_text(v_name), '\s+', '-', 'g')), 'https://' || lower(regexp_replace(public.normalize_text(v_name), '\s+', '', 'g')) || '.com') returning id into v_pid;
    brand_ids := brand_ids || v_pid;
  end loop;
  sup_ids := '{}';
  for v_name in select unnest(array['Distribuidora Erótica del Pacífico','Importadora Sensual MX','Lubrimex','Lencería Fina Sonora','Wellness Intimate Supply','Mayoreo Adulto Norte']) loop
    insert into public.suppliers (organization_id, code, name, rfc, contact_name, phone, email, city, state, payment_terms, lead_time_days)
    values (v_org, 'PRV-' || lpad((array_length(sup_ids, 1) + 1)::text, 3, '0'), v_name, 'XAXX010101000', first_names[1 + floor(random() * 40)::int] || ' ' || last_names[1 + floor(random() * 40)::int],
            '66' || lpad(floor(random() * 100000000)::text, 8, '0'), 'ventas@' || lower(regexp_replace(public.normalize_text(v_name), '\s+', '', 'g')) || '.mx', 'Hermosillo', 'Sonora', '30 días', 5 + floor(random() * 10)::int) returning id into v_pid;
    sup_ids := sup_ids || v_pid;
  end loop;

  -- ── 100 productos ─────────────────────────────────────────────────────────
  prod_ids := '{}'; prod_weights := '{}'; prod_prices := '{}'; prod_has_var := '{}';
  for i in 1..100 loop
    v_cat := cat_ids[1 + ((i - 1) % array_length(cat_ids, 1))];
    select c.name as child, p.name as parent into sub from public.categories c join public.categories p on p.id = c.parent_id where c.id = v_cat;
    v_tier := 1 + floor(random() * 3)::int;
    v_price := case sub.parent
      when 'Vibradores' then 450 + v_tier * 350 + floor(random() * 200) when 'Lubricantes' then 120 + v_tier * 60 when 'Lencería' then 280 + v_tier * 150
      when 'Estimulación' then 390 + v_tier * 300 when 'Accesorios' then 150 + v_tier * 90 when 'Bienestar íntimo' then 90 + v_tier * 70
      when 'Juegos' then 160 + v_tier * 100 when 'Masaje' then 180 + v_tier * 90 when 'Cuidado personal' then 140 + v_tier * 80 else 650 + v_tier * 350 end;
    v_price := round(v_price / 10) * 10 - 1;
    v_cost := round((v_price * (0.35 + random() * 0.25))::numeric, 2);
    v_name := (array['Luna','Aurora','Seda','Velvet','Rouge','Blush','Éclat','Noir','Nude','Amour','Dulce','Íntimo','Deseo','Suspiro','Caricia','Terciopelo','Pétalo','Fuego','Brisa','Secreto'])[1 + floor(random() * 20)::int]
              || ' ' || (array['Classic','Pro','Mini','Deluxe','Duo','Soft','Plus','Edition','Touch','Air'])[1 + floor(random() * 10)::int];
    v_name := case sub.parent when 'Vibradores' then 'Vibrador ' when 'Lubricantes' then 'Lubricante ' when 'Lencería' then 'Lencería ' when 'Estimulación' then 'Estimulador '
                when 'Accesorios' then 'Accesorio ' when 'Bienestar íntimo' then 'Cuidado ' when 'Juegos' then 'Juego ' when 'Masaje' then 'Aceite de masaje ' when 'Cuidado personal' then 'Crema ' else 'Kit ' end || v_name || ' ' || sub.child;
    insert into public.products (organization_id, name, short_name, slug, description, price, old_price, cost_price, category_id, brand_id, supplier_id, stock, sku, barcode, low_stock_threshold, max_stock, unit, is_active, status, weight)
    values (v_org, v_name || ' ' || i, left(v_name, 30), 'demo-' || lower(regexp_replace(public.normalize_text(v_name), '\s+', '-', 'g')) || '-' || i, 'Producto demo de la categoría ' || sub.parent || ' / ' || sub.child || '.',
            v_price, case when random() < 0.25 then v_price + 100 else null end, v_cost, v_cat, brand_ids[1 + floor(random() * 8)::int], sup_ids[1 + ((i - 1) % 6)], 0,
            'DEMO-' || lpad(i::text, 5, '0'), '750' || lpad((1000000000 + i * 7919)::text, 10, '0'), 3 + floor(random() * 4)::int, 40 + floor(random() * 40)::int, 'PZA', true, 'ACTIVE', round((0.1 + random() * 0.8)::numeric, 2))
    returning id into v_pid;
    prod_ids := prod_ids || v_pid; prod_prices := prod_prices || v_price;
    prod_weights := prod_weights || round((1.0 / (i ^ 0.55))::numeric, 4);   -- popularidad tipo Zipf
    v_wsum := v_wsum + round((1.0 / (i ^ 0.55))::numeric, 4);
    -- variantes para algunos
    if sub.parent in ('Vibradores','Estimulación') and random() < 0.5 then
      insert into public.product_variants (product_id, sku, name, attributes, display_order) values
        (v_pid, 'DEMO-' || lpad(i::text, 5, '0') || '-RS', 'Rosa', '{"color":"Rosa"}', 1), (v_pid, 'DEMO-' || lpad(i::text, 5, '0') || '-RJ', 'Rojo', '{"color":"Rojo"}', 2), (v_pid, 'DEMO-' || lpad(i::text, 5, '0') || '-NG', 'Negro', '{"color":"Negro"}', 3);
      prod_has_var := prod_has_var || true;
    elsif sub.parent = 'Lubricantes' and random() < 0.5 then
      insert into public.product_variants (product_id, sku, name, attributes, price, display_order) values
        (v_pid, 'DEMO-' || lpad(i::text, 5, '0') || '-100', '100 ml', '{"presentacion":"100 ml"}', null, 1), (v_pid, 'DEMO-' || lpad(i::text, 5, '0') || '-250', '250 ml', '{"presentacion":"250 ml"}', v_price + 90, 2);
      prod_has_var := prod_has_var || true;
    else
      prod_has_var := prod_has_var || false;
    end if;
  end loop;

  -- ── Compras: 2 rondas por proveedor, recibidas (crea el inventario) ────────
  for k in 1..2 loop
    for j in 1..6 loop
      v_po_items := '[]'::jsonb;
      for i in 1..100 loop
        if sup_ids[1 + ((i - 1) % 6)] = sup_ids[j] then
          if prod_has_var[i] then
            for v_pid in select id from public.product_variants where product_id = prod_ids[i] loop
              v_po_items := v_po_items || jsonb_build_object('product_id', prod_ids[i], 'variant_id', v_pid, 'quantity', 10 + floor(random() * 15)::int, 'unit_cost', (select cost_price from public.products where id = prod_ids[i]));
            end loop;
          else
            v_po_items := v_po_items || jsonb_build_object('product_id', prod_ids[i], 'quantity', 20 + floor(random() * 30)::int, 'unit_cost', (select cost_price from public.products where id = prod_ids[i]));
          end if;
        end if;
      end loop;
      v_po := public.create_purchase_order(v_org, sup_ids[j], v_wh_gym, v_start + (k - 1) * 180 + 10, 'Reabastecimiento demo ' || k, v_po_items, u_mgr);
      perform public.set_purchase_order_status(v_po.id, 'SENT', u_mgr);
      perform public.receive_purchase_order(v_po.id, u_alm, null, 'FAC-' || lpad((k * 1000 + j)::text, 5, '0'), 'Recepción completa');
      update public.purchase_orders set created_at = v_start + (k - 1) * 180, sent_at = v_start + (k - 1) * 180 + 1, completed_at = v_start + (k - 1) * 180 + 6 where id = v_po.id;
      update public.purchase_receipts set received_at = v_start + (k - 1) * 180 + 6 where purchase_order_id = v_po.id;
    end loop;
  end loop;
  -- transferencia a San Carlos
  insert into public.inventory_transfers (organization_id, reference, from_warehouse_id, to_warehouse_id, status, notes, created_by)
  values (v_org, public.next_folio(v_org, 'TRF', 'TRF'), v_wh_gym, v_wh_sc, 'DRAFT', 'Surtido inicial San Carlos', u_alm) returning id into v_pid;
  for i in 1..100 loop
    if not prod_has_var[i] and i % 2 = 0 then
      insert into public.inventory_transfer_items (transfer_id, product_id, quantity) values (v_pid, prod_ids[i], 8);
    end if;
  end loop;
  perform public.send_transfer(v_pid, u_alm); perform public.receive_transfer(v_pid, u_lucia);
  update public.inventory_transfers set created_at = v_start + 7, sent_at = v_start + 7, received_at = v_start + 8 where id = v_pid;

  -- ── 500 clientes ──────────────────────────────────────────────────────────
  cust_ids := '{}';
  for i in 1..500 loop
    insert into public.customers (organization_id, first_name, last_name, phone, email, source, accepts_marketing, created_at)
    values (v_org, first_names[1 + floor(random() * 40)::int], last_names[1 + floor(random() * 40)::int] || ' ' || last_names[1 + floor(random() * 40)::int],
            '622' || lpad((1000000 + i * 3571 % 9000000)::text, 7, '0'), case when random() < 0.5 then 'cliente' || i || '@correo.demo' else null end,
            case when random() < 0.8 then 'POS' else 'ONLINE' end, random() < 0.4, v_start + floor(random() * 360)::int) returning id into v_cust;
    cust_ids := cust_ids || v_cust;
    if random() < 0.7 then
      -- colonia ponderada
      v_r := random() * 110; k := 1; v_weight := neigh_w[1];
      while v_r > v_weight and k < 25 loop k := k + 1; v_weight := v_weight + neigh_w[k]; end loop;
      insert into public.customer_addresses (customer_id, street, ext_number, neighborhood_text, zip, city, state, is_default)
      values (v_cust, (array['Calle','Av.','Blvd.','Priv.'])[1 + floor(random() * 4)::int] || ' ' || (array['Serdán','Yáñez','Abasolo','Alfonso Iberri','Tetabiakte','García López','Rodríguez','Calzada Agustín','Miguel Alemán','Ortiz Garza'])[1 + floor(random() * 10)::int],
              (1 + floor(random() * 300))::text, neigh[k], neigh_zip[k], case when neigh[k] in ('Punta Arena','Villa del Mar') then 'San Carlos' else 'Guaymas' end, 'Sonora', true);
    end if;
  end loop;
  loyal_ids := cust_ids[1:60];

  -- ── Ventas: 365 días, con turnos de caja por día y sucursal ───────────────
  for v_day in select generate_series(v_start, current_date, interval '1 day')::date loop
    v_dow := extract(dow from v_day)::int;
    -- ventas por día: base 2.4, fines de semana más, tendencia creciente, ruido
    v_day_sales := greatest(0, round((2.0 + case v_dow when 5 then 1.8 when 6 then 2.2 when 0 then 0.6 when 1 then -0.4 else 0 end) * (1 + (v_day - v_start) / 365.0 * 0.35) * (0.6 + random() * 0.8) + (case when extract(month from v_day) in (2, 12) then 1.2 else 0 end))::int);
    if v_day_sales = 0 then continue; end if;
    -- turnos
    v_shift := null;
    for v_branch, v_wh, v_reg, v_seller in select * from (values (v_gym, v_wh_gym, v_reg_gym, u_ana), (v_sc, v_wh_sc, v_reg_sc, u_lucia)) t(b, w, r, s) loop
      if v_branch = v_sc and (v_day < v_start + 10 or random() < 0.2) then continue; end if;  -- San Carlos abre después y descansa algunos días
      v_shift := public.open_cash_shift(v_org, v_branch, v_reg, v_seller, 500, null);
      update public.cash_shifts set opened_at = (v_day + time '09:55') at time zone v_tz where id = v_shift.id;
      v_shifts := v_shifts + 1;
      n := case when v_branch = v_gym then ceil(v_day_sales * 0.72) else floor(v_day_sales * 0.28) end;
      for i in 1..n loop
        -- hora ponderada: picos 12-14 y 18-20
        v_r := random();
        v_hour := case when v_r < 0.08 then 10 when v_r < 0.18 then 11 when v_r < 0.33 then 12 when v_r < 0.46 then 13 when v_r < 0.54 then 14 when v_r < 0.60 then 15
                       when v_r < 0.67 then 16 when v_r < 0.76 then 17 when v_r < 0.88 then 18 when v_r < 0.96 then 19 else 20 end;
        v_ts := (v_day + make_time(v_hour, floor(random() * 60)::int, floor(random() * 60)::int)) at time zone v_tz;
        -- partidas
        v_items := '[]'::jsonb; v_total := 0;
        for j in 1..(1 + floor(random() * random() * 4)::int) loop
          -- producto ponderado (Zipf)
          v_r := random() * v_wsum; k := 1; v_weight := prod_weights[1];
          while v_r > v_weight and k < 100 loop k := k + 1; v_weight := v_weight + prod_weights[k]; end loop;
          -- productos "de temporada": algunos crecen en los últimos 2 meses
          if v_day > current_date - 60 and k % 7 = 3 and random() < 0.5 then k := k; elsif v_day <= current_date - 60 and k % 7 = 3 and random() < 0.5 then k := 1 + floor(random() * 100)::int; end if;
          v_qty := case when random() < 0.82 then 1 when random() < 0.8 then 2 else 3 end;
          if prod_has_var[k] then
            select id into v_pid from public.product_variants where product_id = prod_ids[k] order by random() limit 1;
            v_items := v_items || jsonb_build_object('product_id', prod_ids[k], 'variant_id', v_pid, 'quantity', v_qty);
            v_item_total := coalesce((select price from public.product_variants where id = v_pid), prod_prices[k]) * v_qty;
          else
            v_items := v_items || jsonb_build_object('product_id', prod_ids[k], 'quantity', v_qty);
            v_item_total := prod_prices[k] * v_qty;
          end if;
          v_total := v_total + v_item_total;
        end loop;
        -- descuento
        v_disc := case when random() < 0.12 then (array[5, 10, 15])[1 + floor(random() * 3)::int] else 0 end;
        v_total := round(v_total * (1 - v_disc / 100.0), 2);
        -- cliente (65 %), sesgo a clientes leales
        v_cust := case when random() < 0.65 then (case when random() < 0.35 then loyal_ids[1 + floor(random() * 60)::int] else cust_ids[1 + floor(random() * 500)::int] end) else null end;
        -- pago
        v_r := random();
        v_pm := case when v_r < 0.55 then 'CASH' when v_r < 0.85 then 'CARD' when v_r < 0.95 then 'TRANSFER' else 'MERCADO_PAGO' end;
        v_payments := case when v_pm = 'CASH' then jsonb_build_array(jsonb_build_object('method_code', 'CASH', 'amount', ceil(v_total / 50) * 50)) else jsonb_build_array(jsonb_build_object('method_code', v_pm, 'amount', v_total)) end;
        begin
          v_sale := public.create_sale(jsonb_build_object('organization_id', v_org, 'branch_id', v_branch, 'warehouse_id', v_wh, 'user_id', v_seller, 'seller_id', v_seller,
            'customer_id', v_cust, 'cash_shift_id', v_shift.id, 'channel', 'POS', 'sold_at', v_ts, 'items', v_items, 'payments', v_payments,
            'discount_pct', nullif(v_disc, 0), 'discount_reason', case when v_disc > 0 then (array['Cliente frecuente','Promoción del día','Producto con empaque dañado'])[1 + floor(random() * 3)::int] end, 'max_discount_pct', 20));
          v_sales := v_sales + 1; v_pos := v_pos + 1;
          update public.sales set created_at = v_ts where id = (v_sale->>'id')::uuid;
          -- devoluciones (3 %) el mismo día
          if random() < 0.03 then
            v_ret := public.create_sale_return(jsonb_build_object('sale_id', v_sale->>'id', 'user_id', v_seller, 'cash_shift_id', v_shift.id, 'reason', (array['No le gustó','Producto defectuoso','Talla incorrecta'])[1 + floor(random() * 3)::int],
              'refund_method_code', 'CASH', 'items', jsonb_build_array(jsonb_build_object('sale_item_id', v_sale->'items'->0->>'id', 'quantity', 1, 'restock', random() < 0.7))));
            update public.sale_returns set created_at = v_ts + interval '2 hours' where sale_id = (v_sale->>'id')::uuid;
            v_returns := v_returns + 1;
          elsif random() < 0.02 then
            cancel_ids := cancel_ids || (v_sale->>'id')::uuid;
            perform public.cancel_sale((v_sale->>'id')::uuid, v_seller, 'Error de captura', v_shift.id);
            update public.sales set cancelled_at = v_ts + interval '10 minutes' where id = (v_sale->>'id')::uuid;
            v_cancels := v_cancels + 1;
          end if;
        exception when others then
          raise notice 'venta demo omitida: %', sqlerrm;
        end;
      end loop;
      -- cierre con pequeña diferencia a veces
      select coalesce(sum(amount), 0) into v_expected from public.cash_movements where cash_shift_id = v_shift.id and affects_cash;
      v_counted := case when random() < 0.06 then v_expected - (array[20, 50, 100, 150])[1 + floor(random() * 4)::int] when random() < 0.3 then v_expected + (array[-10, -5, 5, 10])[1 + floor(random() * 4)::int] else v_expected end;
      perform public.close_cash_shift(v_shift.id, v_seller, greatest(v_counted, 0), null);
      update public.cash_shifts set closed_at = (v_day + time '20:35') at time zone v_tz where id = v_shift.id;
    end loop;
    -- ventas en línea (sin turno), 12 % extra
    if random() < 0.12 * v_day_sales / 2.5 then
      v_r := random() * v_wsum; k := 1; v_weight := prod_weights[1];
      while v_r > v_weight and k < 100 loop k := k + 1; v_weight := v_weight + prod_weights[k]; end loop;
      if prod_has_var[k] then
        select id into v_pid from public.product_variants where product_id = prod_ids[k] order by random() limit 1;
        v_items := jsonb_build_array(jsonb_build_object('product_id', prod_ids[k], 'variant_id', v_pid, 'quantity', 1));
        v_total := coalesce((select price from public.product_variants where id = v_pid), prod_prices[k]);
      else
        v_items := jsonb_build_array(jsonb_build_object('product_id', prod_ids[k], 'quantity', 1)); v_total := prod_prices[k];
      end if;
      v_ts := (v_day + make_time(21 + floor(random() * 2)::int, floor(random() * 60)::int, 0)) at time zone v_tz;
      v_cust := cust_ids[1 + floor(random() * 500)::int];
      begin
        v_sale := public.create_sale(jsonb_build_object('organization_id', v_org, 'branch_id', v_gym, 'warehouse_id', v_wh_gym, 'user_id', u_admin, 'seller_id', null, 'customer_id', v_cust, 'channel', 'ONLINE', 'sold_at', v_ts,
          'items', v_items, 'payments', jsonb_build_array(jsonb_build_object('method_code', case when random() < 0.7 then 'MERCADO_PAGO' else 'TRANSFER' end, 'amount', v_total)), 'notes', 'Pedido web'));
        update public.sales set created_at = v_ts where id = (v_sale->>'id')::uuid;
        v_sales := v_sales + 1;
      exception when others then raise notice 'venta online demo omitida: %', sqlerrm; end;
    end if;
  end loop;

  -- ── Gastos mensuales ──────────────────────────────────────────────────────
  for i in 0..11 loop
    v_day := date_trunc('month', v_start + i * 30)::date;
    for sub in select id, code from public.expense_categories where organization_id = v_org loop
      v_total := case sub.code when 'RENT' then 9500 when 'UTILITIES' then 1600 + floor(random() * 900) when 'MARKETING' then 1200 + floor(random() * 2500) when 'TRANSPORT' then 400 + floor(random() * 500)
                   when 'SUPPLIES' then 300 + floor(random() * 600) when 'PACKAGING' then 500 + floor(random() * 400) when 'PAYROLL' then 14000 else 0 end;
      if v_total > 0 then
        perform public.create_expense(v_org, v_gym, sub.id, case sub.code when 'RENT' then 'Renta local Serdán' when 'UTILITIES' then 'CFE + agua + internet' when 'MARKETING' then 'Pauta redes sociales' when 'TRANSPORT' then 'Envíos y gasolina'
          when 'SUPPLIES' then 'Papelería y limpieza' when 'PACKAGING' then 'Bolsas y cajas discretas' else 'Nómina quincenal' end, v_total, v_day + 3, 'TRANSFER', u_admin);
      end if;
    end loop;
  end loop;
  update public.expenses set created_at = expense_date where organization_id = v_org;

  -- ── Fechas de movimientos (los triggers inmutables se desactivan solo aquí) ─
  alter table public.inventory_movements disable trigger trg_inventory_movements_immutable;
  alter table public.cash_movements disable trigger trg_cash_movements_immutable;
  update public.inventory_movements m set created_at = s.sold_at from public.sales s where m.organization_id = v_org and m.reference_type = 'SALE' and m.reference_id = s.id::text;
  update public.inventory_movements m set created_at = r.created_at from public.sale_returns r where m.organization_id = v_org and m.reference_type = 'RETURN' and m.reference_id = r.id::text;
  update public.inventory_movements m set created_at = r.received_at from public.purchase_receipts r where m.organization_id = v_org and m.reference_type = 'PURCHASE_RECEIPT' and m.reference_id = r.id::text;
  update public.inventory_movements m set created_at = t.sent_at + case when m.movement_type = 'TRANSFER_IN' then interval '1 day' else interval '0' end from public.inventory_transfers t where m.organization_id = v_org and m.reference_type = 'TRANSFER' and m.reference_id = t.id::text;
  update public.cash_movements m set created_at = s.sold_at from public.sales s where m.organization_id = v_org and m.reference_type = 'SALE' and m.reference_id = s.id::text;
  update public.cash_movements m set created_at = sh.opened_at from public.cash_shifts sh where m.organization_id = v_org and m.movement_type = 'OPENING' and m.cash_shift_id = sh.id;
  alter table public.inventory_movements enable trigger trg_inventory_movements_immutable;
  alter table public.cash_movements enable trigger trg_cash_movements_immutable;
  update public.sale_items si set sold_at = s.sold_at from public.sales s where si.sale_id = s.id and si.organization_id = v_org;
  update public.organization_settings set value = value || '{"allow_cancel_days": 7}'::jsonb where organization_id = v_org and key = 'sales';
  update public.customers c set created_at = least(c.created_at, c.first_purchase_at) where c.organization_id = v_org and c.first_purchase_at is not null;
  perform public.run_anomaly_checks(v_org);

  return jsonb_build_object('status', 'ok', 'organization_id', v_org, 'sales', v_sales, 'pos_sales', v_pos, 'returns', v_returns, 'cancellations', v_cancels, 'shifts', v_shifts,
                            'products', 100, 'customers', 500, 'movements', (select count(*) from public.inventory_movements where organization_id = v_org));
end $$;

create or replace function public.purge_demo_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_n int;
begin
  select id into v_org from public.organizations where slug = 'sonroja-demo';
  if v_org is null then return jsonb_build_object('status', 'nothing_to_purge'); end if;
  alter table public.inventory_movements disable trigger trg_inventory_movements_immutable;
  alter table public.cash_movements disable trigger trg_cash_movements_immutable;
  delete from public.sale_return_items where return_id in (select id from public.sale_returns where organization_id = v_org);
  delete from public.sale_items where organization_id = v_org;
  delete from public.organizations where id = v_org;   -- cascada al resto
  alter table public.inventory_movements enable trigger trg_inventory_movements_immutable;
  alter table public.cash_movements enable trigger trg_cash_movements_immutable;
  delete from auth.users where email like '%@sonroja.demo';
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', 'purged', 'demo_users_removed', v_n);
end $$;

revoke all on function public.seed_demo_data() from public, anon, authenticated;
revoke all on function public.purge_demo_data() from public, anon, authenticated;
revoke all on function public.seed_demo_user(uuid,text,text,text,text,text,uuid) from public, anon, authenticated;

select public.seed_demo_data();
