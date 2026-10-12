-- ═══════════════════════════════════════════════════════════════════════════
-- Colonias: clave de comparación sin prefijos ni puntuación.
-- "col. centro", "Colonia Centro" y "Centro" son la misma colonia; antes se
-- creaba una nueva y el análisis geográfico quedaba partido.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.neighborhood_key(p text)
returns text language sql immutable parallel safe set search_path = public, extensions as $$
  select trim(regexp_replace(
           regexp_replace(
             regexp_replace(public.normalize_text(p), '[^a-z0-9 ]', ' ', 'g'),
             '\s+', ' ', 'g'),
           '^\s*(colonia|col|fraccionamiento|fracc|frac|residencial|barrio)\s+', ''));
$$;
revoke all on function public.neighborhood_key(text) from public, anon, authenticated;

-- Nombre para mostrar: sin el prefijo ("Col. Centro" → "Centro")
create or replace function public.neighborhood_display(p text)
returns text language sql immutable parallel safe as $$
  select initcap(trim(regexp_replace(trim(coalesce(p, '')), '^(colonia|col\.?|fraccionamiento|fracc\.?|frac\.?|residencial|barrio)\s+', '', 'i')));
$$;
revoke all on function public.neighborhood_display(text) from public, anon, authenticated;

create or replace function public.resolve_neighborhood(p_org uuid, p_name text, p_zip text, p_city text, p_state text)
returns uuid language plpgsql set search_path = public as $$
declare v_norm text; v_city text; v_id uuid;
begin
  v_norm := public.neighborhood_key(p_name);
  if v_norm = '' then return null; end if;
  v_city := coalesce(nullif(trim(p_city), ''), 'Guaymas');
  select id into v_id from public.neighborhoods
   where organization_id = p_org and public.normalize_text(city) = public.normalize_text(v_city)
     and (normalized_name = v_norm or v_norm = any (aliases) or public.neighborhood_key(name) = v_norm)
   limit 1;
  if v_id is null then
    insert into public.neighborhoods (organization_id, name, normalized_name, zip, city, state)
    values (p_org, public.neighborhood_display(p_name), v_norm, nullif(trim(p_zip), ''), v_city, coalesce(nullif(trim(p_state), ''), 'Sonora'))
    on conflict (organization_id, normalized_name, public.normalize_text(city)) do update set zip = coalesce(public.neighborhoods.zip, excluded.zip)
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.resolve_neighborhood(uuid,text,text,text,text) from public, anon, authenticated;

-- Fusionar colonias que ya quedaron duplicadas y recalcular la clave
do $$
declare g record; keep uuid; i int; dup public.neighborhoods;
begin
  for g in
    select organization_id, public.neighborhood_key(name) k, public.normalize_text(city) c, array_agg(id order by created_at, name) ids
      from public.neighborhoods group by 1, 2, 3 having count(*) > 1
  loop
    keep := g.ids[1];
    for i in 2 .. array_length(g.ids, 1) loop
      select * into dup from public.neighborhoods where id = g.ids[i];
      update public.customer_addresses set neighborhood_id = keep where neighborhood_id = dup.id;
      update public.customers set default_neighborhood_id = keep where default_neighborhood_id = dup.id;
      update public.sales set neighborhood_id = keep where neighborhood_id = dup.id;
      update public.sale_items set neighborhood_id = keep where neighborhood_id = dup.id;
      update public.neighborhoods
         set aliases = (select array_agg(distinct a) from unnest(coalesce(aliases, '{}') || array[dup.normalized_name] || coalesce(dup.aliases, '{}')) a)
       where id = keep;
      delete from public.neighborhoods where id = dup.id;
    end loop;
  end loop;
  update public.neighborhoods set normalized_name = public.neighborhood_key(name) where normalized_name is distinct from public.neighborhood_key(name);
end $$;
