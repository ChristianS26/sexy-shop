-- ═══════════════════════════════════════════════════════════════════════════
-- Alertas de stock por almacén (coherentes con Existencias)
-- El dashboard y el centro de alertas contaban por producto (stock total);
-- Existencias cuenta por producto × almacén. Un producto agotado en una
-- sucursal es accionable (transferir o comprar), así que todo cuenta igual.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.bi_overview(p_org uuid, p_from timestamptz, p_to timestamptz, p_branch uuid default null)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'current', public.bi_kpis(p_org, p_from, p_to, p_branch),
    'previous', public.bi_kpis(p_org, (public.bi_prev_range(p_from, p_to)).prev_from, (public.bi_prev_range(p_from, p_to)).prev_to, p_branch),
    'inventory', (select jsonb_build_object(
        'out_of_stock', count(*) filter (where stock_status = 'OUT'),
        'critical', count(*) filter (where stock_status = 'CRITICAL'),
        'low', count(*) filter (where stock_status = 'LOW'),
        'healthy', count(*) filter (where stock_status in ('HEALTHY', 'EXCESS')),
        'excess', count(*) filter (where stock_status = 'EXCESS'),
        'stock_value', coalesce(sum(stock_value), 0),
        'stock_units', coalesce(sum(quantity), 0),
        'rows', count(*),
        'active_products', (select count(*) from public.products where organization_id = p_org and is_active and deleted_at is null))
      from public.v_stock where organization_id = p_org and is_active and (p_branch is null or branch_id = p_branch)),
    'alerts', (select jsonb_build_object('unread', count(*) filter (where status = 'UNREAD'), 'critical', count(*) filter (where severity = 'CRITICAL' and status <> 'RESOLVED'))
      from public.notifications where organization_id = p_org and status <> 'RESOLVED')
  );
$$;
