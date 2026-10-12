-- ============================================================================
-- SONROJA ERP — 008 Business Intelligence
-- Agregados server-side. Convención: p_from inclusivo, p_to exclusivo (timestamptz),
-- p_branch null = todas, p_tz zona horaria para cortes por día/hora.
-- Ingreso = total - reembolsos de ventas no canceladas. Costo = unit_cost * unidades netas.
-- ============================================================================

-- Período anterior de la misma duración
create or replace function public.bi_prev_range(p_from timestamptz, p_to timestamptz, out prev_from timestamptz, out prev_to timestamptz)
language sql immutable as $$ select p_from - (p_to - p_from), p_from $$;

-- ---------------------------------------------------------------------------
-- KPIs del período + período anterior
-- ---------------------------------------------------------------------------
create or replace function public.bi_kpis(p_org uuid, p_from timestamptz, p_to timestamptz, p_branch uuid default null)
returns jsonb language sql stable set search_path = public as $$
  with s as (
    select * from public.sales where organization_id = p_org and status <> 'CANCELLED' and sold_at >= p_from and sold_at < p_to and (p_branch is null or branch_id = p_branch)
  ), items as (
    select i.* from public.sale_items i join s on s.id = i.sale_id
  ), cust as (
    select count(*) filter (where c.first_purchase_at >= p_from and c.first_purchase_at < p_to) as new_customers,
           count(distinct s.customer_id) filter (where c.first_purchase_at < p_from) as returning_customers
      from s left join public.customers c on c.id = s.customer_id
  )
  select jsonb_build_object(
    'revenue', coalesce((select sum(total - refunded_amount) from s), 0),
    'gross_revenue', coalesce((select sum(total) from s), 0),
    'refunds', coalesce((select sum(refunded_amount) from s), 0),
    'orders', (select count(*) from s),
    'avg_ticket', coalesce((select avg(total - refunded_amount) from s), 0),
    'units', coalesce((select sum(quantity - returned_quantity) from items), 0),
    'cogs', coalesce((select sum(unit_cost * (quantity - returned_quantity)) from items), 0),
    'net_revenue', coalesce((select sum(net_amount * (quantity - returned_quantity) / quantity) from items), 0),
    'gross_profit', coalesce((select sum(net_amount * (quantity - returned_quantity) / quantity) - sum(unit_cost * (quantity - returned_quantity)) from items), 0),
    'discounts', coalesce((select sum(discount_amount) from s), 0),
    'new_customers', (select new_customers from cust),
    'returning_customers', (select returning_customers from cust),
    'customers', (select count(distinct customer_id) from s where customer_id is not null),
    'cancelled', (select count(*) from public.sales where organization_id = p_org and status = 'CANCELLED' and sold_at >= p_from and sold_at < p_to and (p_branch is null or branch_id = p_branch)),
    'returns', (select count(*) from public.sale_returns where organization_id = p_org and created_at >= p_from and created_at < p_to and (p_branch is null or branch_id = p_branch)),
    'expenses', coalesce((select sum(amount) from public.expenses where organization_id = p_org and deleted_at is null and expense_date >= p_from::date and expense_date < p_to::date and (p_branch is null or branch_id = p_branch)), 0)
  );
$$;

create or replace function public.bi_overview(p_org uuid, p_from timestamptz, p_to timestamptz, p_branch uuid default null)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'current', public.bi_kpis(p_org, p_from, p_to, p_branch),
    'previous', public.bi_kpis(p_org, (public.bi_prev_range(p_from, p_to)).prev_from, (public.bi_prev_range(p_from, p_to)).prev_to, p_branch),
    'inventory', (select jsonb_build_object(
        'out_of_stock', count(*) filter (where stock <= 0),
        'critical', count(*) filter (where stock > 0 and stock <= ceil(coalesce(low_stock_threshold, 3) * 0.5)),
        'low', count(*) filter (where stock > ceil(coalesce(low_stock_threshold, 3) * 0.5) and stock <= coalesce(low_stock_threshold, 3)),
        'healthy', count(*) filter (where stock > coalesce(low_stock_threshold, 3)),
        'stock_value', coalesce(sum(stock * cost_price), 0),
        'stock_units', coalesce(sum(stock), 0),
        'active_products', count(*))
      from public.products where organization_id = p_org and is_active and deleted_at is null),
    'alerts', (select jsonb_build_object('unread', count(*) filter (where status = 'UNREAD'), 'critical', count(*) filter (where severity = 'CRITICAL' and status <> 'RESOLVED'))
      from public.notifications where organization_id = p_org and status <> 'RESOLVED')
  );
$$;

-- ---------------------------------------------------------------------------
-- Serie temporal (hour | day | week | month)
-- ---------------------------------------------------------------------------
create or replace function public.bi_timeseries(p_org uuid, p_from timestamptz, p_to timestamptz, p_granularity text default 'day', p_branch uuid default null, p_tz text default 'America/Hermosillo')
returns jsonb language sql stable set search_path = public as $$
  with buckets as (
    select date_trunc(p_granularity, s.sold_at at time zone p_tz) as bucket, s.total - s.refunded_amount as revenue, s.total_cost as cost, s.id, s.items_count, s.customer_id
      from public.sales s where s.organization_id = p_org and s.status <> 'CANCELLED' and s.sold_at >= p_from and s.sold_at < p_to and (p_branch is null or s.branch_id = p_branch)
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS'), 'revenue', revenue, 'orders', orders, 'units', units, 'avg_ticket', avg_ticket, 'cost', cost, 'customers', customers) order by bucket), '[]'::jsonb)
  from (select bucket, sum(revenue) revenue, count(id) orders, sum(items_count) units, round(avg(revenue), 2) avg_ticket, sum(cost) cost, count(distinct customer_id) customers from buckets group by bucket) t;
$$;

-- ---------------------------------------------------------------------------
-- Por categoría (con crecimiento vs período anterior y participación)
-- ---------------------------------------------------------------------------
create or replace function public.bi_by_category(p_org uuid, p_from timestamptz, p_to timestamptz, p_branch uuid default null)
returns jsonb language sql stable set search_path = public as $$
  with cur as (
    select coalesce(i.category_id, '00000000-0000-0000-0000-000000000000'::uuid) cid, sum(i.line_total * (i.quantity - i.returned_quantity) / i.quantity) revenue,
           sum(i.quantity - i.returned_quantity) units, sum((i.net_amount - i.unit_cost * i.quantity) * (i.quantity - i.returned_quantity) / i.quantity) margin, count(distinct i.sale_id) orders
      from public.sale_items i where i.organization_id = p_org and i.status <> 'CANCELLED' and i.sold_at >= p_from and i.sold_at < p_to and (p_branch is null or i.branch_id = p_branch) group by 1
  ), prev as (
    select coalesce(i.category_id, '00000000-0000-0000-0000-000000000000'::uuid) cid, sum(i.line_total * (i.quantity - i.returned_quantity) / i.quantity) revenue
      from public.sale_items i, public.bi_prev_range(p_from, p_to) r
     where i.organization_id = p_org and i.status <> 'CANCELLED' and i.sold_at >= r.prev_from and i.sold_at < r.prev_to and (p_branch is null or i.branch_id = p_branch) group by 1
  ), tot as (select coalesce(sum(revenue), 0) t from cur)
  select coalesce(jsonb_agg(jsonb_build_object('category_id', cur.cid, 'name', coalesce(c.name, 'Sin categoría'), 'icon', c.icon, 'revenue', round(cur.revenue, 2), 'units', cur.units, 'orders', cur.orders,
           'margin', round(cur.margin, 2), 'margin_pct', case when cur.revenue > 0 then round(cur.margin / cur.revenue * 100, 1) else 0 end,
           'share_pct', case when tot.t > 0 then round(cur.revenue / tot.t * 100, 1) else 0 end,
           'prev_revenue', round(coalesce(prev.revenue, 0), 2),
           'growth_pct', case when coalesce(prev.revenue, 0) > 0 then round((cur.revenue - prev.revenue) / prev.revenue * 100, 1) else null end) order by cur.revenue desc), '[]'::jsonb)
  from cur cross join tot left join prev on prev.cid = cur.cid left join public.categories c on c.id = cur.cid;
$$;

-- ---------------------------------------------------------------------------
-- Top productos (métrica: revenue | units | margin | growth | decline | rotation)
-- ---------------------------------------------------------------------------
create or replace function public.bi_top_products(p_org uuid, p_from timestamptz, p_to timestamptz, p_metric text default 'revenue', p_limit int default 10, p_branch uuid default null, p_category uuid default null)
returns jsonb language sql stable set search_path = public as $$
  with cur as (
    select i.product_id, max(i.product_name) name, max(i.sku) sku, max(i.category_id::text)::uuid category_id,
           sum(i.line_total * (i.quantity - i.returned_quantity) / i.quantity) revenue, sum(i.quantity - i.returned_quantity) units,
           sum((i.net_amount - i.unit_cost * i.quantity) * (i.quantity - i.returned_quantity) / i.quantity) margin, count(distinct i.sale_id) orders
      from public.sale_items i where i.organization_id = p_org and i.product_id is not null and i.status <> 'CANCELLED' and i.sold_at >= p_from and i.sold_at < p_to
       and (p_branch is null or i.branch_id = p_branch) and (p_category is null or i.category_id = p_category) group by i.product_id
  ), prev as (
    select i.product_id, sum(i.line_total * (i.quantity - i.returned_quantity) / i.quantity) revenue, sum(i.quantity - i.returned_quantity) units
      from public.sale_items i, public.bi_prev_range(p_from, p_to) r
     where i.organization_id = p_org and i.product_id is not null and i.status <> 'CANCELLED' and i.sold_at >= r.prev_from and i.sold_at < r.prev_to and (p_branch is null or i.branch_id = p_branch) group by i.product_id
  ), joined as (
    select cur.*, coalesce(prev.revenue, 0) prev_revenue, coalesce(prev.units, 0) prev_units,
           case when coalesce(prev.revenue, 0) > 0 then (cur.revenue - prev.revenue) / prev.revenue * 100 else null end growth_pct,
           p.stock, p.cost_price, p.price, c.name category_name,
           case when p.stock > 0 and cur.units > 0 then round(p.stock / (cur.units / greatest(extract(epoch from (p_to - p_from)) / 86400, 1)), 0) else null end days_of_stock
      from cur left join prev on prev.product_id = cur.product_id left join public.products p on p.id = cur.product_id left join public.categories c on c.id = cur.category_id
  )
  select coalesce(jsonb_agg(to_jsonb(j) - 'cost_price' order by
      case p_metric when 'revenue' then j.revenue when 'units' then j.units when 'margin' then j.margin when 'growth' then coalesce(j.growth_pct, -1e9) when 'decline' then -coalesce(j.growth_pct, 1e9) when 'rotation' then j.units else j.revenue end desc), '[]'::jsonb)
  from (select * from joined order by case p_metric when 'revenue' then revenue when 'units' then units when 'margin' then margin when 'growth' then coalesce(growth_pct, -1e9) when 'decline' then -coalesce(growth_pct, 1e9) when 'rotation' then units else revenue end desc limit p_limit) j;
$$;

-- ---------------------------------------------------------------------------
-- Heatmap día de la semana × hora (0 = domingo)
-- ---------------------------------------------------------------------------
create or replace function public.bi_heatmap(p_org uuid, p_from timestamptz, p_to timestamptz, p_branch uuid default null, p_tz text default 'America/Hermosillo')
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'sales', n, 'revenue', revenue, 'avg_ticket', avg_ticket) order by dow, hr), '[]'::jsonb)
  from (select extract(dow from s.sold_at at time zone p_tz)::int dow, extract(hour from s.sold_at at time zone p_tz)::int as hr, count(*) n, round(sum(s.total - s.refunded_amount), 2) revenue, round(avg(s.total - s.refunded_amount), 2) avg_ticket
          from public.sales s where s.organization_id = p_org and s.status <> 'CANCELLED' and s.sold_at >= p_from and s.sold_at < p_to and (p_branch is null or s.branch_id = p_branch) group by 1, 2) t;
$$;

-- ---------------------------------------------------------------------------
-- Por colonia
-- ---------------------------------------------------------------------------
create or replace function public.bi_by_neighborhood(p_org uuid, p_from timestamptz, p_to timestamptz, p_branch uuid default null, p_limit int default 50)
returns jsonb language sql stable set search_path = public as $$
  with cur as (
    select s.neighborhood_id, count(*) sales, sum(s.total - s.refunded_amount) revenue, count(distinct s.customer_id) customers, avg(s.total - s.refunded_amount) avg_ticket, sum(s.items_count) units
      from public.sales s where s.organization_id = p_org and s.status <> 'CANCELLED' and s.sold_at >= p_from and s.sold_at < p_to and (p_branch is null or s.branch_id = p_branch) and s.neighborhood_id is not null group by 1
  ), prev as (
    select s.neighborhood_id, sum(s.total - s.refunded_amount) revenue from public.sales s, public.bi_prev_range(p_from, p_to) r
     where s.organization_id = p_org and s.status <> 'CANCELLED' and s.sold_at >= r.prev_from and s.sold_at < r.prev_to and (p_branch is null or s.branch_id = p_branch) and s.neighborhood_id is not null group by 1
  ), tot as (select coalesce(sum(revenue), 0) t, coalesce(sum(sales), 0) n from cur)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('neighborhood_id', cur.neighborhood_id, 'name', n.name, 'zip', n.zip, 'city', n.city, 'lat', n.lat, 'lng', n.lng,
              'sales', cur.sales, 'revenue', round(cur.revenue, 2), 'customers', cur.customers, 'avg_ticket', round(cur.avg_ticket, 2), 'units', cur.units,
              'frequency', case when cur.customers > 0 then round(cur.sales::numeric / cur.customers, 2) else 0 end,
              'share_pct', case when tot.t > 0 then round(cur.revenue / tot.t * 100, 1) else 0 end,
              'prev_revenue', round(coalesce(prev.revenue, 0), 2),
              'growth_pct', case when coalesce(prev.revenue, 0) > 0 then round((cur.revenue - prev.revenue) / prev.revenue * 100, 1) else null end) order by cur.revenue desc)
            from (select * from cur order by revenue desc limit p_limit) cur cross join tot left join prev on prev.neighborhood_id = cur.neighborhood_id join public.neighborhoods n on n.id = cur.neighborhood_id), '[]'::jsonb),
    'unassigned', (select jsonb_build_object('sales', count(*), 'revenue', coalesce(sum(s.total - s.refunded_amount), 0)) from public.sales s
                    where s.organization_id = p_org and s.status <> 'CANCELLED' and s.sold_at >= p_from and s.sold_at < p_to and (p_branch is null or s.branch_id = p_branch) and s.neighborhood_id is null),
    'total_revenue', (select t from tot), 'total_sales', (select n from tot));
$$;

-- Productos más comprados en una colonia
create or replace function public.bi_neighborhood_products(p_org uuid, p_neighborhood uuid, p_from timestamptz, p_to timestamptz, p_limit int default 10)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'units', units, 'revenue', revenue) order by revenue desc), '[]'::jsonb)
  from (select i.product_id, max(i.product_name) name, sum(i.quantity - i.returned_quantity) units, round(sum(i.line_total * (i.quantity - i.returned_quantity) / i.quantity), 2) revenue
          from public.sale_items i where i.organization_id = p_org and i.neighborhood_id = p_neighborhood and i.status <> 'CANCELLED' and i.sold_at >= p_from and i.sold_at < p_to and i.product_id is not null
         group by i.product_id order by revenue desc limit p_limit) t;
$$;

-- ---------------------------------------------------------------------------
-- RFM por cliente (quintiles sobre toda la base; recency en días)
-- ---------------------------------------------------------------------------
create or replace function public.bi_rfm(p_org uuid, p_limit int default 500, p_segment text default null)
returns jsonb language sql stable set search_path = public as $$
  with base as (
    select c.id, c.first_name, c.last_name, c.phone, c.purchases_count f, c.total_spent m, c.last_purchase_at, c.first_purchase_at,
           extract(day from now() - c.last_purchase_at)::int recency_days, c.default_neighborhood_id
      from public.customers c where c.organization_id = p_org and c.deleted_at is null and c.purchases_count > 0
  ), scored as (
    select *, 6 - ntile(5) over (order by recency_days) r_score, ntile(5) over (order by f) f_score, ntile(5) over (order by m) m_score from base
  ), seg as (
    select *, case
      when r_score >= 4 and f_score >= 4 and m_score >= 4 then 'CHAMPIONS'
      when r_score >= 3 and f_score >= 3 then 'LOYAL'
      when r_score >= 4 and f <= 1 then 'NEW'
      when r_score >= 3 and f_score <= 2 then 'POTENTIAL'
      when r_score = 2 and f_score >= 3 then 'AT_RISK'
      when r_score <= 2 and f_score >= 4 then 'CANT_LOSE'
      when r_score <= 1 then 'LOST'
      else 'HIBERNATING' end segment
    from scored
  )
  select jsonb_build_object(
    'segments', (select coalesce(jsonb_object_agg(segment, jsonb_build_object('customers', n, 'revenue', rev, 'avg_ticket', avg_t)), '{}'::jsonb) from (select segment, count(*) n, round(sum(m), 2) rev, round(avg(m / nullif(f, 0)), 2) avg_t from seg group by segment) x),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('customer_id', id, 'first_name', first_name, 'last_name', last_name, 'phone', phone, 'recency_days', recency_days, 'frequency', f, 'monetary', m,
                    'r', r_score, 'f', f_score, 'm', m_score, 'segment', segment, 'last_purchase_at', last_purchase_at, 'avg_ticket', round(m / nullif(f, 0), 2)) order by m desc), '[]'::jsonb)
                  from (select * from seg where p_segment is null or segment = p_segment order by m desc limit p_limit) y));
$$;

-- ---------------------------------------------------------------------------
-- Cohortes mensuales de retención
-- ---------------------------------------------------------------------------
create or replace function public.bi_cohorts(p_org uuid, p_months int default 12, p_tz text default 'America/Hermosillo')
returns jsonb language sql stable set search_path = public as $$
  with firsts as (
    select c.id customer_id, date_trunc('month', c.first_purchase_at at time zone p_tz)::date cohort from public.customers c
     where c.organization_id = p_org and c.first_purchase_at is not null and c.first_purchase_at >= date_trunc('month', now() at time zone p_tz) - make_interval(months => p_months)
  ), activity as (
    select f.cohort, (extract(year from age(date_trunc('month', s.sold_at at time zone p_tz), f.cohort)) * 12 + extract(month from age(date_trunc('month', s.sold_at at time zone p_tz), f.cohort)))::int month_index,
           count(distinct s.customer_id) active, sum(s.total - s.refunded_amount) revenue
      from firsts f join public.sales s on s.customer_id = f.customer_id and s.status <> 'CANCELLED' group by 1, 2
  ), sizes as (select cohort, count(*) size from firsts group by cohort)
  select coalesce(jsonb_agg(jsonb_build_object('cohort', to_char(sz.cohort, 'YYYY-MM'), 'size', sz.size,
           'months', (select coalesce(jsonb_agg(jsonb_build_object('m', a.month_index, 'active', a.active, 'retention_pct', round(a.active::numeric / sz.size * 100, 1), 'revenue', round(a.revenue, 2)) order by a.month_index), '[]'::jsonb) from activity a where a.cohort = sz.cohort)) order by sz.cohort), '[]'::jsonb)
  from sizes sz;
$$;

-- ---------------------------------------------------------------------------
-- Clientes: resumen + segunda/tercera compra
-- ---------------------------------------------------------------------------
create or replace function public.bi_customers(p_org uuid, p_from timestamptz, p_to timestamptz, p_branch uuid default null)
returns jsonb language sql stable set search_path = public as $$
  with base as (select * from public.customers c where c.organization_id = p_org and c.deleted_at is null)
  select jsonb_build_object(
    'total', (select count(*) from base),
    'with_purchases', (select count(*) from base where purchases_count > 0),
    'new_in_period', (select count(*) from base where first_purchase_at >= p_from and first_purchase_at < p_to),
    'returning_in_period', (select count(distinct s.customer_id) from public.sales s join base b on b.id = s.customer_id where s.status <> 'CANCELLED' and s.sold_at >= p_from and s.sold_at < p_to and b.first_purchase_at < p_from and (p_branch is null or s.branch_id = p_branch)),
    'inactive_90d', (select count(*) from base where purchases_count > 0 and last_purchase_at < now() - interval '90 days'),
    'repeat_rate_pct', (select case when count(*) > 0 then round(count(*) filter (where purchases_count >= 2)::numeric / count(*) * 100, 1) else 0 end from base where purchases_count > 0),
    'third_purchase_pct', (select case when count(*) > 0 then round(count(*) filter (where purchases_count >= 3)::numeric / count(*) * 100, 1) else 0 end from base where purchases_count > 0),
    'avg_frequency', (select round(avg(purchases_count), 2) from base where purchases_count > 0),
    'avg_ltv', (select round(avg(total_spent), 2) from base where purchases_count > 0),
    'avg_ticket', (select round(avg(total_spent / nullif(purchases_count, 0)), 2) from base where purchases_count > 0),
    'avg_days_between', (select round(avg(extract(epoch from (last_purchase_at - first_purchase_at)) / 86400 / nullif(purchases_count - 1, 0)), 1) from base where purchases_count >= 2),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('customer_id', id, 'first_name', first_name, 'last_name', last_name, 'purchases', purchases_count, 'total_spent', total_spent, 'last_purchase_at', last_purchase_at) order by total_spent desc), '[]'::jsonb)
              from (select * from base order by total_spent desc limit 10) t),
    'by_source', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, count(*) n from base group by source) x)
  );
$$;

-- Customer 360
create or replace function public.bi_customer_360(p_customer uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'customer', to_jsonb(c),
    'addresses', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('neighborhood_name', n.name)) from public.customer_addresses a left join public.neighborhoods n on n.id = a.neighborhood_id where a.customer_id = c.id), '[]'::jsonb),
    'stats', (select jsonb_build_object('purchases', count(*), 'revenue', coalesce(sum(total - refunded_amount), 0), 'avg_ticket', round(coalesce(avg(total - refunded_amount), 0), 2), 'last_purchase_at', max(sold_at), 'first_purchase_at', min(sold_at),
               'avg_days_between', round(coalesce(extract(epoch from (max(sold_at) - min(sold_at))) / 86400 / nullif(count(*) - 1, 0), 0), 1), 'returns', (select count(*) from public.sale_returns r join public.sales s2 on s2.id = r.sale_id where s2.customer_id = c.id))
              from public.sales s where s.customer_id = c.id and s.status <> 'CANCELLED'),
    'favorite_products', coalesce((select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'units', units, 'revenue', revenue) order by units desc) from (
        select i.product_id, max(i.product_name) name, sum(i.quantity) units, sum(i.line_total) revenue from public.sale_items i where i.customer_id = c.id and i.status <> 'CANCELLED' and i.product_id is not null group by i.product_id order by units desc limit 5) x), '[]'::jsonb),
    'favorite_categories', coalesce((select jsonb_agg(jsonb_build_object('category_id', category_id, 'name', name, 'units', units, 'revenue', revenue) order by revenue desc) from (
        select i.category_id, max(cat.name) name, sum(i.quantity) units, sum(i.line_total) revenue from public.sale_items i left join public.categories cat on cat.id = i.category_id where i.customer_id = c.id and i.status <> 'CANCELLED' group by i.category_id order by revenue desc limit 5) x), '[]'::jsonb),
    'recent_sales', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'folio', s.folio, 'sold_at', s.sold_at, 'total', s.total, 'status', s.status, 'items_count', s.items_count, 'channel', s.channel) order by s.sold_at desc) from (select * from public.sales where customer_id = c.id order by sold_at desc limit 20) s), '[]'::jsonb),
    'rfm', (select jsonb_build_object('recency_days', extract(day from now() - c.last_purchase_at)::int, 'frequency', c.purchases_count, 'monetary', c.total_spent))
  ) from public.customers c where c.id = p_customer;
$$;

-- ---------------------------------------------------------------------------
-- Inventario: ABC, rotación, dead stock
-- ---------------------------------------------------------------------------
create or replace function public.bi_inventory_abc(p_org uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable set search_path = public as $$
  with sold as (
    select i.product_id, sum(i.line_total * (i.quantity - i.returned_quantity) / i.quantity) revenue, sum(i.quantity - i.returned_quantity) units,
           sum((i.net_amount - i.unit_cost * i.quantity) * (i.quantity - i.returned_quantity) / i.quantity) margin
      from public.sale_items i where i.organization_id = p_org and i.product_id is not null and i.status <> 'CANCELLED' and i.sold_at >= p_from and i.sold_at < p_to group by 1
  ), all_p as (
    select p.id product_id, p.name, p.sku, p.stock, p.cost_price, c.name category_name, coalesce(s.revenue, 0) revenue, coalesce(s.units, 0) units, coalesce(s.margin, 0) margin
      from public.products p left join sold s on s.product_id = p.id left join public.categories c on c.id = p.category_id where p.organization_id = p_org and p.deleted_at is null
  ), ranked as (
    select *, sum(revenue) over () total, sum(revenue) over (order by revenue desc, product_id rows between unbounded preceding and current row) cum from all_p
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'sku', sku, 'category', category_name, 'revenue', round(revenue, 2), 'units', units, 'margin', round(margin, 2), 'stock', stock,
              'stock_value', round(stock * cost_price, 2), 'share_pct', case when total > 0 then round(revenue / total * 100, 2) else 0 end, 'cum_pct', case when total > 0 then round(cum / total * 100, 1) else 0 end,
              'rotation', case when stock > 0 then round(units::numeric / stock, 2) else null end,
              'class', case when total = 0 or revenue = 0 then 'C' when cum / total <= 0.8 then 'A' when cum / total <= 0.95 then 'B' else 'C' end) order by revenue desc) from ranked), '[]'::jsonb),
    'summary', (select jsonb_object_agg(cls, jsonb_build_object('products', n, 'revenue', rev, 'stock_value', sv)) from (
        select case when total = 0 or revenue = 0 then 'C' when cum / total <= 0.8 then 'A' when cum / total <= 0.95 then 'B' else 'C' end cls, count(*) n, round(sum(revenue), 2) rev, round(sum(stock * cost_price), 2) sv from ranked group by 1) x));
$$;

create or replace function public.bi_inventory_rotation(p_org uuid, p_days int default 90, p_dead_days int default 90)
returns jsonb language sql stable set search_path = public as $$
  with sold as (
    select i.product_id, sum(i.quantity - i.returned_quantity) units, sum(i.unit_cost * (i.quantity - i.returned_quantity)) cogs, max(i.sold_at) last_sold
      from public.sale_items i where i.organization_id = p_org and i.product_id is not null and i.status <> 'CANCELLED' and i.sold_at >= now() - make_interval(days => p_days) group by 1
  ), last_any as (select product_id, max(sold_at) last_sold from public.sale_items where organization_id = p_org and status <> 'CANCELLED' group by 1),
  rows_ as (
    select p.id product_id, p.name, p.sku, c.name category_name, p.stock, p.cost_price, p.stock * p.cost_price stock_value, coalesce(s.units, 0) units_sold,
           round(coalesce(s.units, 0)::numeric / p_days, 3) avg_daily_sales,
           case when coalesce(s.units, 0) > 0 then round(p.stock / (s.units::numeric / p_days), 0) else null end days_of_inventory,
           case when p.stock > 0 then round(coalesce(s.units, 0)::numeric / p.stock, 2) else null end turnover,
           la.last_sold, coalesce(p.low_stock_threshold, 3) min_stock, p.max_stock,
           (select max(created_at) from public.inventory_movements m where m.product_id = p.id and m.movement_type in ('PURCHASE','INITIAL_STOCK','TRANSFER_IN')) last_received,
           case
             when p.stock > 0 and (la.last_sold is null or la.last_sold < now() - make_interval(days => p_dead_days)) then 'DEAD'
             when p.stock > 0 and coalesce(s.units, 0)::numeric / p_days * 30 < 1 then 'SLOW'
             when coalesce(s.units, 0) > 0 and p.stock / nullif(s.units::numeric / p_days, 0) <= 7 then 'FAST'
             else 'NORMAL' end classification
      from public.products p left join sold s on s.product_id = p.id left join last_any la on la.product_id = p.id left join public.categories c on c.id = p.category_id
     where p.organization_id = p_org and p.deleted_at is null and p.is_active
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.units_sold desc) from rows_ r), '[]'::jsonb),
    'summary', jsonb_build_object(
      'dead_value', (select coalesce(sum(stock_value), 0) from rows_ where classification = 'DEAD'),
      'dead_count', (select count(*) from rows_ where classification = 'DEAD'),
      'slow_value', (select coalesce(sum(stock_value), 0) from rows_ where classification = 'SLOW'),
      'slow_count', (select count(*) from rows_ where classification = 'SLOW'),
      'fast_count', (select count(*) from rows_ where classification = 'FAST'),
      'total_value', (select coalesce(sum(stock_value), 0) from rows_),
      'avg_days_of_inventory', (select round(avg(days_of_inventory), 0) from rows_ where days_of_inventory is not null),
      'turnover', (select case when sum(stock_value) > 0 then round(sum(units_sold * cost_price) / sum(stock_value), 2) else 0 end from rows_),
      'period_days', p_days));
$$;

-- ---------------------------------------------------------------------------
-- Vendedores
-- ---------------------------------------------------------------------------
create or replace function public.bi_sellers(p_org uuid, p_from timestamptz, p_to timestamptz, p_branch uuid default null)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('seller_id', seller_id, 'name', name, 'sales', n, 'revenue', revenue, 'avg_ticket', avg_ticket, 'units', units, 'discounts', discounts,
           'discount_pct', case when revenue + discounts > 0 then round(discounts / (revenue + discounts) * 100, 1) else 0 end, 'cancelled', cancelled, 'margin', margin) order by revenue desc), '[]'::jsonb)
  from (select s.seller_id, coalesce(max(u.first_name || ' ' || u.last_name), 'Sin vendedor') name,
               count(*) filter (where s.status <> 'CANCELLED') n, round(coalesce(sum(s.total - s.refunded_amount) filter (where s.status <> 'CANCELLED'), 0), 2) revenue,
               round(coalesce(avg(s.total - s.refunded_amount) filter (where s.status <> 'CANCELLED'), 0), 2) avg_ticket, coalesce(sum(s.items_count) filter (where s.status <> 'CANCELLED'), 0) units,
               round(coalesce(sum(s.discount_amount) filter (where s.status <> 'CANCELLED'), 0), 2) discounts, count(*) filter (where s.status = 'CANCELLED') cancelled,
               round(coalesce(sum(s.subtotal - s.total_cost) filter (where s.status <> 'CANCELLED'), 0), 2) margin
          from public.sales s left join public.users u on u.id = s.seller_id
         where s.organization_id = p_org and s.sold_at >= p_from and s.sold_at < p_to and (p_branch is null or s.branch_id = p_branch) group by s.seller_id) t;
$$;

-- ---------------------------------------------------------------------------
-- Métodos de pago
-- ---------------------------------------------------------------------------
create or replace function public.bi_payment_methods(p_org uuid, p_from timestamptz, p_to timestamptz, p_branch uuid default null)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('method_code', method_code, 'name', name, 'amount', amount, 'sales', n, 'share_pct', share) order by amount desc), '[]'::jsonb)
  from (select p.method_code, max(pm.name) name, round(sum(p.amount), 2) amount, count(distinct p.sale_id) n, round(sum(p.amount) / nullif(sum(sum(p.amount)) over (), 0) * 100, 1) share
          from public.sale_payments p join public.sales s on s.id = p.sale_id left join public.payment_methods pm on pm.id = p.payment_method_id
         where s.organization_id = p_org and s.status <> 'CANCELLED' and s.sold_at >= p_from and s.sold_at < p_to and (p_branch is null or s.branch_id = p_branch) group by p.method_code) t;
$$;

-- ---------------------------------------------------------------------------
-- Finanzas: P&L del período y por mes
-- ---------------------------------------------------------------------------
create or replace function public.bi_financial(p_org uuid, p_from timestamptz, p_to timestamptz, p_branch uuid default null, p_tz text default 'America/Hermosillo')
returns jsonb language sql stable set search_path = public as $$
  with s as (select * from public.sales where organization_id = p_org and status <> 'CANCELLED' and sold_at >= p_from and sold_at < p_to and (p_branch is null or branch_id = p_branch)),
  ex as (select * from public.expenses where organization_id = p_org and deleted_at is null and expense_date >= p_from::date and expense_date < p_to::date and (p_branch is null or branch_id = p_branch)),
  months as (
    select m, coalesce((select sum(total - refunded_amount) from s where date_trunc('month', sold_at at time zone p_tz) = m), 0) revenue,
           coalesce((select sum(subtotal * (1 - refunded_amount / nullif(total, 0))) from s where date_trunc('month', sold_at at time zone p_tz) = m), 0) net_revenue,
           coalesce((select sum(total_cost * (1 - refunded_amount / nullif(total, 0))) from s where date_trunc('month', sold_at at time zone p_tz) = m), 0) cogs,
           coalesce((select sum(amount) from ex where date_trunc('month', expense_date::timestamp) = m), 0) expenses
      from generate_series(date_trunc('month', p_from at time zone p_tz), date_trunc('month', (p_to - interval '1 second') at time zone p_tz), interval '1 month') m
  )
  select jsonb_build_object(
    'revenue', coalesce((select sum(total - refunded_amount) from s), 0),
    'net_revenue', coalesce((select sum(subtotal * (1 - refunded_amount / nullif(total, 0))) from s), 0),
    'tax_collected', coalesce((select sum(tax_amount * (1 - refunded_amount / nullif(total, 0))) from s), 0),
    'cogs', coalesce((select sum(total_cost * (1 - refunded_amount / nullif(total, 0))) from s), 0),
    'gross_profit', coalesce((select sum((subtotal - total_cost) * (1 - refunded_amount / nullif(total, 0))) from s), 0),
    'gross_margin_pct', (select case when sum(subtotal) > 0 then round(sum(subtotal - total_cost) / sum(subtotal) * 100, 1) else 0 end from s),
    'expenses', coalesce((select sum(amount) from ex), 0),
    'operating_profit', coalesce((select sum((subtotal - total_cost) * (1 - refunded_amount / nullif(total, 0))) from s), 0) - coalesce((select sum(amount) from ex), 0),
    'expenses_by_category', coalesce((select jsonb_agg(jsonb_build_object('category', name, 'amount', amount) order by amount desc) from (select coalesce(max(c.name), e.category) name, round(sum(e.amount), 2) amount from ex e left join public.expense_categories c on c.id = e.expense_category_id group by e.expense_category_id, e.category) x), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'revenue', round(revenue, 2), 'net_revenue', round(net_revenue, 2), 'cogs', round(cogs, 2), 'gross_profit', round(net_revenue - cogs, 2), 'expenses', round(expenses, 2), 'operating_profit', round(net_revenue - cogs - expenses, 2)) order by m) from months), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Market basket: pares comprados juntos (support, confidence, lift)
-- ---------------------------------------------------------------------------
create or replace function public.bi_market_basket(p_org uuid, p_from timestamptz, p_to timestamptz, p_min_pairs int default 2, p_limit int default 30)
returns jsonb language sql stable set search_path = public as $$
  with baskets as (
    select distinct i.sale_id, i.product_id, i.product_name from public.sale_items i
     where i.organization_id = p_org and i.product_id is not null and i.status <> 'CANCELLED' and i.sold_at >= p_from and i.sold_at < p_to
  ), n as (select count(distinct sale_id) total from baskets),
  singles as (select product_id, count(*) cnt from baskets group by 1),
  pairs as (
    select a.product_id pa, max(a.product_name) na, b.product_id pb, max(b.product_name) nb, count(*) together
      from baskets a join baskets b on a.sale_id = b.sale_id and a.product_id < b.product_id group by a.product_id, b.product_id having count(*) >= p_min_pairs
  )
  select coalesce(jsonb_agg(jsonb_build_object('product_a', pa, 'name_a', na, 'product_b', pb, 'name_b', nb, 'together', p.together,
           'support_pct', round(p.together::numeric / n.total * 100, 2),
           'confidence_ab_pct', round(p.together::numeric / sa.cnt * 100, 1), 'confidence_ba_pct', round(p.together::numeric / sb.cnt * 100, 1),
           'lift', round((p.together::numeric / n.total) / ((sa.cnt::numeric / n.total) * (sb.cnt::numeric / n.total)), 2)) order by p.together desc, pa), '[]'::jsonb)
  from (select * from pairs order by together desc limit p_limit) p cross join n join singles sa on sa.product_id = p.pa join singles sb on sb.product_id = p.pb;
$$;

-- ---------------------------------------------------------------------------
-- Tendencias: últimas N semanas vs N anteriores
-- ---------------------------------------------------------------------------
create or replace function public.bi_trends(p_org uuid, p_weeks int default 4, p_branch uuid default null, p_tz text default 'America/Hermosillo')
returns jsonb language sql stable set search_path = public as $$
  with r as (select now() - make_interval(weeks => p_weeks) cur_from, now() cur_to, now() - make_interval(weeks => 2 * p_weeks) prev_from, now() - make_interval(weeks => p_weeks) prev_to),
  prod as (
    select i.product_id, max(i.product_name) name, max(i.category_id::text)::uuid category_id,
           sum(case when i.sold_at >= r.cur_from then i.line_total * (i.quantity - i.returned_quantity) / i.quantity else 0 end) cur,
           sum(case when i.sold_at < r.cur_from then i.line_total * (i.quantity - i.returned_quantity) / i.quantity else 0 end) prev,
           sum(case when i.sold_at >= r.cur_from then i.quantity - i.returned_quantity else 0 end) cur_units,
           sum(case when i.sold_at < r.cur_from then i.quantity - i.returned_quantity else 0 end) prev_units
      from public.sale_items i, r where i.organization_id = p_org and i.product_id is not null and i.status <> 'CANCELLED' and i.sold_at >= r.prev_from and (p_branch is null or i.branch_id = p_branch) group by i.product_id
  ), cat as (
    select i.category_id, max(c.name) name,
           sum(case when i.sold_at >= r.cur_from then i.line_total * (i.quantity - i.returned_quantity) / i.quantity else 0 end) cur,
           sum(case when i.sold_at < r.cur_from then i.line_total * (i.quantity - i.returned_quantity) / i.quantity else 0 end) prev
      from public.sale_items i left join public.categories c on c.id = i.category_id, r where i.organization_id = p_org and i.status <> 'CANCELLED' and i.sold_at >= r.prev_from and (p_branch is null or i.branch_id = p_branch) group by i.category_id
  ), neigh as (
    select s.neighborhood_id, max(n.name) name,
           sum(case when s.sold_at >= r.cur_from then s.total - s.refunded_amount else 0 end) cur,
           sum(case when s.sold_at < r.cur_from then s.total - s.refunded_amount else 0 end) prev
      from public.sales s join public.neighborhoods n on n.id = s.neighborhood_id, r where s.organization_id = p_org and s.status <> 'CANCELLED' and s.sold_at >= r.prev_from and (p_branch is null or s.branch_id = p_branch) group by s.neighborhood_id
  ), hours as (
    select extract(dow from s.sold_at at time zone p_tz)::int dow, extract(hour from s.sold_at at time zone p_tz)::int as hr, count(*) n, sum(s.total - s.refunded_amount) revenue
      from public.sales s, r where s.organization_id = p_org and s.status <> 'CANCELLED' and s.sold_at >= r.cur_from and (p_branch is null or s.branch_id = p_branch) group by 1, 2
  ), recurring as (
    select c.id, c.first_name, c.last_name, count(*) n, sum(s.total - s.refunded_amount) revenue from public.sales s join public.customers c on c.id = s.customer_id, r
     where s.organization_id = p_org and s.status <> 'CANCELLED' and s.sold_at >= r.cur_from and (p_branch is null or s.branch_id = p_branch) group by c.id having count(*) >= 2
  )
  select jsonb_build_object(
    'weeks', p_weeks,
    'overall', (select jsonb_build_object('cur', round(coalesce(sum(cur), 0), 2), 'prev', round(coalesce(sum(prev), 0), 2), 'growth_pct', case when sum(prev) > 0 then round((sum(cur) - sum(prev)) / sum(prev) * 100, 1) else null end) from cat),
    'products_rising', coalesce((select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'cur', round(cur, 2), 'prev', round(prev, 2), 'growth_pct', round((cur - prev) / prev * 100, 1), 'cur_units', cur_units, 'prev_units', prev_units) order by (cur - prev) / prev desc)
        from (select * from prod where prev > 0 and cur > prev order by (cur - prev) / prev desc limit 10) x), '[]'::jsonb),
    'products_falling', coalesce((select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'cur', round(cur, 2), 'prev', round(prev, 2), 'growth_pct', round((cur - prev) / prev * 100, 1), 'cur_units', cur_units, 'prev_units', prev_units) order by (cur - prev) / prev)
        from (select * from prod where prev > 0 and cur < prev order by (cur - prev) / prev limit 10) x), '[]'::jsonb),
    'products_new', coalesce((select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'cur', round(cur, 2), 'cur_units', cur_units) order by cur desc) from (select * from prod where prev = 0 and cur > 0 order by cur desc limit 5) x), '[]'::jsonb),
    'categories_rising', coalesce((select jsonb_agg(jsonb_build_object('category_id', category_id, 'name', coalesce(name, 'Sin categoría'), 'cur', round(cur, 2), 'prev', round(prev, 2), 'growth_pct', round((cur - prev) / prev * 100, 1)) order by (cur - prev) / prev desc) from (select * from cat where prev > 0 and cur > prev order by (cur - prev) / prev desc limit 5) x), '[]'::jsonb),
    'categories_falling', coalesce((select jsonb_agg(jsonb_build_object('category_id', category_id, 'name', coalesce(name, 'Sin categoría'), 'cur', round(cur, 2), 'prev', round(prev, 2), 'growth_pct', round((cur - prev) / prev * 100, 1)) order by (cur - prev) / prev) from (select * from cat where prev > 0 and cur < prev order by (cur - prev) / prev limit 5) x), '[]'::jsonb),
    'neighborhoods_rising', coalesce((select jsonb_agg(jsonb_build_object('neighborhood_id', neighborhood_id, 'name', name, 'cur', round(cur, 2), 'prev', round(prev, 2), 'growth_pct', case when prev > 0 then round((cur - prev) / prev * 100, 1) else null end) order by cur - prev desc) from (select * from neigh where cur > prev order by cur - prev desc limit 5) x), '[]'::jsonb),
    'strong_hours', coalesce((select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'sales', n, 'revenue', round(revenue, 2)) order by revenue desc) from (select * from hours order by revenue desc limit 5) x), '[]'::jsonb),
    'recurring_customers', coalesce((select jsonb_agg(jsonb_build_object('customer_id', id, 'first_name', first_name, 'last_name', last_name, 'purchases', n, 'revenue', round(revenue, 2)) order by n desc, revenue desc) from (select * from recurring order by n desc, revenue desc limit 10) x), '[]'::jsonb),
    'baskets', public.bi_market_basket(p_org, (select cur_from from r), (select cur_to from r), 2, 10)
  );
$$;

-- Serie semanal de un producto (para sparkline / quick view)
create or replace function public.bi_product_history(p_product uuid, p_weeks int default 12, p_tz text default 'America/Hermosillo')
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('week', to_char(w, 'YYYY-MM-DD'), 'units', coalesce(u, 0), 'revenue', coalesce(r, 0)) order by w) from (
        select w, (select sum(i.quantity - i.returned_quantity) from public.sale_items i where i.product_id = p_product and i.status <> 'CANCELLED' and date_trunc('week', i.sold_at at time zone p_tz) = w) u,
                  (select round(sum(i.line_total * (i.quantity - i.returned_quantity) / i.quantity), 2) from public.sale_items i where i.product_id = p_product and i.status <> 'CANCELLED' and date_trunc('week', i.sold_at at time zone p_tz) = w) r
          from generate_series(date_trunc('week', now() at time zone p_tz) - make_interval(weeks => p_weeks - 1), date_trunc('week', now() at time zone p_tz), interval '1 week') w) t), '[]'::jsonb),
    'last_30d', (select jsonb_build_object('units', coalesce(sum(i.quantity - i.returned_quantity), 0), 'revenue', coalesce(round(sum(i.line_total * (i.quantity - i.returned_quantity) / i.quantity), 2), 0), 'margin', coalesce(round(sum((i.net_amount - i.unit_cost * i.quantity) * (i.quantity - i.returned_quantity) / i.quantity), 2), 0)) from public.sale_items i where i.product_id = p_product and i.status <> 'CANCELLED' and i.sold_at >= now() - interval '30 days'),
    'prev_30d', (select jsonb_build_object('units', coalesce(sum(i.quantity - i.returned_quantity), 0), 'revenue', coalesce(round(sum(i.line_total * (i.quantity - i.returned_quantity) / i.quantity), 2), 0)) from public.sale_items i where i.product_id = p_product and i.status <> 'CANCELLED' and i.sold_at >= now() - interval '60 days' and i.sold_at < now() - interval '30 days'),
    'last_sale_at', (select max(sold_at) from public.sale_items where product_id = p_product and status <> 'CANCELLED'),
    'last_purchase', (select jsonb_build_object('at', m.created_at, 'quantity', m.quantity, 'unit_cost', m.unit_cost) from public.inventory_movements m where m.product_id = p_product and m.movement_type = 'PURCHASE' order by m.created_at desc limit 1),
    'stock_by_warehouse', coalesce((select jsonb_agg(jsonb_build_object('warehouse_id', l.warehouse_id, 'warehouse', w.name, 'quantity', l.quantity, 'variant_id', l.variant_id, 'variant', v.name)) from public.inventory_levels l join public.warehouses w on w.id = l.warehouse_id left join public.product_variants v on v.id = l.variant_id where l.product_id = p_product), '[]'::jsonb),
    'days_of_stock', (select case when sum(i.quantity - i.returned_quantity) > 0 then round((select stock from public.products where id = p_product) / (sum(i.quantity - i.returned_quantity)::numeric / 30), 0) else null end from public.sale_items i where i.product_id = p_product and i.status <> 'CANCELLED' and i.sold_at >= now() - interval '30 days')
  );
$$;

-- Búsqueda global
create or replace function public.global_search(p_org uuid, p_q text, p_limit int default 8)
returns jsonb language sql stable set search_path = public, extensions as $$
  with q as (select public.normalize_text(p_q) nq, p_q raw)
  select jsonb_build_object(
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku, 'barcode', p.barcode, 'price', p.price, 'stock', p.stock, 'status', p.status, 'image_url', (select image_url from public.product_images pi where pi.product_id = p.id order by is_primary desc, display_order limit 1)) order by similarity(p.search_text, q.nq) desc, p.name)
        from (select * from public.products p, q where p.organization_id = p_org and p.deleted_at is null and (p.search_text like '%' || q.nq || '%' or p.barcode = q.raw or upper(p.sku) = upper(q.raw)) order by (p.barcode = q.raw or upper(p.sku) = upper(q.raw)) desc, p.name limit p_limit) p, q), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'phone', c.phone, 'email', c.email, 'purchases', c.purchases_count) order by c.last_purchase_at desc nulls last)
        from (select * from public.customers c, q where c.organization_id = p_org and c.deleted_at is null and c.search_text like '%' || q.nq || '%' limit p_limit) c), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'folio', s.folio, 'total', s.total, 'status', s.status, 'sold_at', s.sold_at, 'channel', s.channel) order by s.sold_at desc)
        from (select * from public.sales s, q where s.organization_id = p_org and upper(s.folio) like '%' || upper(q.raw) || '%' order by s.sold_at desc limit p_limit) s), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', su.id, 'name', su.name, 'phone', su.phone, 'contact_name', su.contact_name))
        from (select * from public.suppliers su, q where su.organization_id = p_org and su.deleted_at is null and public.normalize_text(su.name || ' ' || coalesce(su.contact_name, '')) like '%' || q.nq || '%' limit p_limit) su), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'folio', po.folio, 'status', po.status, 'total', po.total))
        from (select * from public.purchase_orders po, q where po.organization_id = p_org and upper(po.folio) like '%' || upper(q.raw) || '%' limit p_limit) po), '[]'::jsonb)
  );
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'bi_kpis(uuid,timestamptz,timestamptz,uuid)', 'bi_overview(uuid,timestamptz,timestamptz,uuid)', 'bi_timeseries(uuid,timestamptz,timestamptz,text,uuid,text)',
    'bi_by_category(uuid,timestamptz,timestamptz,uuid)', 'bi_top_products(uuid,timestamptz,timestamptz,text,int,uuid,uuid)', 'bi_heatmap(uuid,timestamptz,timestamptz,uuid,text)',
    'bi_by_neighborhood(uuid,timestamptz,timestamptz,uuid,int)', 'bi_neighborhood_products(uuid,uuid,timestamptz,timestamptz,int)', 'bi_rfm(uuid,int,text)', 'bi_cohorts(uuid,int,text)',
    'bi_customers(uuid,timestamptz,timestamptz,uuid)', 'bi_customer_360(uuid)', 'bi_inventory_abc(uuid,timestamptz,timestamptz)', 'bi_inventory_rotation(uuid,int,int)',
    'bi_sellers(uuid,timestamptz,timestamptz,uuid)', 'bi_payment_methods(uuid,timestamptz,timestamptz,uuid)', 'bi_financial(uuid,timestamptz,timestamptz,uuid,text)',
    'bi_market_basket(uuid,timestamptz,timestamptz,int,int)', 'bi_trends(uuid,int,uuid,text)', 'bi_product_history(uuid,int,text)', 'global_search(uuid,text,int)']
  loop execute format('revoke all on function public.%s from public, anon, authenticated', f); end loop;
end $$;
