-- "Revisar ahora" decía "3 alertas nuevas o actualizadas" cada vez aunque no hubiera nada nuevo:
-- run_anomaly_checks contaba cada condición detectada, incluidas las alertas que ya estaban abiertas.
-- Ahora devuelve cuántas alertas se crearon en esta ejecución (created_at = now() de la transacción).
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
  -- Solo alertas creadas en esta revisión (las que ya estaban abiertas se actualizan sin contarse de nuevo).
  return (select count(*)::int from public.notifications where (p_org is null or organization_id = p_org) and created_at = now());
end $$;

revoke all on function public.run_anomaly_checks(uuid) from public, anon, authenticated;
