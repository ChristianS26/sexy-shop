-- ═══════════════════════════════════════════════════════════════════════════
-- Mensaje claro de existencia insuficiente: qué producto, cuánto hay y dónde.
-- Antes solo decía "STOCK_INSUFICIENTE" y la persona no sabía qué corregir.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.post_inventory_movement(
  p_org uuid, p_warehouse uuid, p_product uuid, p_variant uuid,
  p_type text, p_quantity int, p_reason text, p_reference_type text, p_reference_id text,
  p_user uuid, p_unit_cost numeric default null
) returns public.inventory_movements
language plpgsql set search_path = public as $$
declare v_level public.inventory_levels; v_before int; v_after int; v_mov public.inventory_movements; v_allow_negative boolean;
        v_name text; v_wh text;
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
    select p.name || coalesce(' · ' || v.name, '') into v_name
      from public.products p left join public.product_variants v on v.id = p_variant where p.id = p_product;
    select name into v_wh from public.warehouses where id = p_warehouse;
    raise exception 'STOCK_INSUFICIENTE: “%” solo tiene % en %; se pidieron %', v_name, greatest(v_before, 0), coalesce(v_wh, 'el almacén'), -p_quantity
      using detail = jsonb_build_object('product_id', p_product, 'variant_id', p_variant, 'available', v_before, 'requested', -p_quantity)::text;
  end if;

  update public.inventory_levels set quantity = v_after, updated_at = now() where id = v_level.id;

  insert into public.inventory_movements (organization_id, reference, warehouse_id, product_id, variant_id, movement_type,
    quantity, quantity_before, quantity_after, unit_cost, reason, reference_type, reference_id, user_id)
  values (p_org, public.next_folio(p_org, 'INV', 'INV'), p_warehouse, p_product, p_variant, p_type,
    p_quantity, v_before, v_after, p_unit_cost, p_reason, p_reference_type, p_reference_id, p_user)
  returning * into v_mov;
  return v_mov;
end $$;
