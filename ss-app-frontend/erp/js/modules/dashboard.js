// ═══════════════════════════════════════════════════════════════════════════
// Dashboard — "Centro de control Sonroja": qué está pasando hoy
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { store, rangeParams } from '../core/store.js';
import { h, icon, fmt, replace, badge } from '../core/dom.js';
import { kpi, chart, heatmap, dateFilter, skeletonCards, emptyState, stockBadge } from '../ui/widgets.js';
import { toast } from '../ui/overlay.js';
import { openProductQuickView } from './products.js';

export const route = '/dashboard';
export const title = 'Dashboard';
export const crumb = 'Centro de control';

export async function render(root) {
  const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Hermosillo' })).getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const body = h('div.stack', { style: { gap: '20px' } });
  const head = h('div.page-head', h('div', h('h1.page-head__title', `${greet}, ${me.user?.first_name || ''}`), h('p.page-head__sub', 'Así va SONROJA. Elige el periodo para comparar contra el anterior.')), dateFilter(load));
  root.append(head, body);

  async function load() {
    replace(body, skeletonCards(5), h('div.skeleton.skeleton--card', { style: { height: '300px' } }));
    if (!me.can('analytics.read')) { replace(body, await operatorView()); return; }
    let d;
    try { d = await api.get('/analytics/overview', rangeParams()); } catch (e) { replace(body, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar el dashboard', text: friendlyError(e) })); return; }
    const cur = d.overview.current, prev = d.overview.previous, inv = d.overview.inventory;
    const series = d.timeseries || [];
    const kpis = h('div.grid.grid--kpi',
      kpi({ label: `Ventas · ${d.range.label}`, value: cur.revenue, prev: prev.revenue, hero: true, tone: 'accent', foot: `${fmt.int(cur.orders)} tickets · anterior ${fmt.money(prev.revenue)}`, spark: series.map(s => s.revenue) }),
      kpi({ label: 'Ticket promedio', value: cur.avg_ticket, prev: prev.avg_ticket, icon: 'receipt' }),
      kpi({ label: 'Productos vendidos', value: cur.units, prev: prev.units, format: fmt.int, icon: 'box' }),
      me.can('products.cost.read') ? kpi({ label: 'Margen bruto', value: cur.gross_profit, prev: prev.gross_profit, icon: 'trend', foot: cur.net_revenue ? `${Math.round(cur.gross_profit / cur.net_revenue * 100)} % sobre ingreso neto` : null }) : kpi({ label: 'Ventas completadas', value: cur.orders, prev: prev.orders, format: fmt.int, icon: 'checkCircle' }),
      kpi({ label: 'Clientes nuevos', value: cur.new_customers, prev: prev.new_customers, format: fmt.int, icon: 'users', foot: `${fmt.int(cur.returning_customers)} recurrentes` }),
      kpi({ label: 'Alertas de stock', value: (inv.out_of_stock || 0) + (inv.critical || 0), format: fmt.int, icon: 'alertTriangle', foot: `${inv.out_of_stock} agotados · ${inv.critical} críticos · ${inv.low} bajos`, tone: (inv.out_of_stock || 0) > 0 ? '' : '' }),
    );
    const revenueCard = h('div.card', h('div.card__head', h('div', h('div.card__title', 'Ingresos en el tiempo'), h('div.card__sub', `${d.range.label} · comparado con el periodo anterior`))), h('div.card__body', h('div', { id: 'c-revenue' })));
    const catCard = h('div.card', h('div.card__head', h('div', h('div.card__title', 'Ventas por categoría'), h('div.card__sub', 'Participación del periodo'))), h('div.card__body', h('div', { id: 'c-cat' })));
    const topCard = h('div.card', h('div.card__head', h('div', h('div.card__title', 'Top productos'), h('div.card__sub', 'Por ingresos')), h('a.btn.btn--ghost.btn--sm', { href: '#/analytics/products' }, 'Ver todo', icon('arrowRight'))),
      h('div.card__body', (d.top_products || []).length ? h('div.rank', (d.top_products || []).slice(0, 8).map((p, i) => h('div.rank__item', { style: { cursor: 'pointer' }, onclick: () => openProductQuickView(p.product_id) }, h('div.rank__n', String(i + 1)), h('div', { style: { minWidth: 0 } }, h('div.rank__name', p.name), h('div.rank__meta', `${fmt.int(p.units)} uds · ${p.growth_pct != null ? fmt.pct(p.growth_pct) + ' vs anterior' : 'sin comparativo'}`)), h('div.rank__val', fmt.money(p.revenue))))) : emptyState({ icon: 'tag', title: 'Sin ventas en el periodo' })));
    const heatCard = h('div.card', h('div.card__head', h('div', h('div.card__title', 'Ventas por hora'), h('div.card__sub', 'Día de la semana × hora · intensidad por ingresos')), h('a.btn.btn--ghost.btn--sm', { href: '#/analytics/time' }, 'Detalle', icon('arrowRight'))), h('div.card__body', h('div', { id: 'c-heat' })));
    const geoRows = d.neighborhoods?.rows || [];
    const geoCard = h('div.card', h('div.card__head', h('div', h('div.card__title', 'Ventas por colonia'), h('div.card__sub', 'De dónde vienen las compras')), h('a.btn.btn--ghost.btn--sm', { href: '#/analytics/geography' }, 'Mapa', icon('arrowRight'))),
      h('div.card__body', geoRows.length ? h('div.stack', geoRows.slice(0, 6).map(n => h('div', h('div.row.row--between.text-sm', h('span.strong', n.name), h('span', `${fmt.money(n.revenue)} · ${n.share_pct} %`)), h('div.bar.mt-2', h('i', { style: { width: `${Math.min(100, n.share_pct / (geoRows[0].share_pct || 1) * 100)}%` } }))))) : emptyState({ icon: 'map', title: 'Sin colonias registradas', text: 'Captura la dirección de tus clientes para ver de dónde compran.' })));
    const alertsCard = h('div.card', h('div.card__head', h('div', h('div.card__title', 'Inventario'), h('div.card__sub', 'Estado de existencias')), h('a.btn.btn--ghost.btn--sm', { href: '#/inventory-alerts' }, 'Alertas', icon('arrowRight'))),
      h('div.card__body', h('div.stack', [['OUT', 'Agotados', inv.out_of_stock], ['CRITICAL', 'Críticos', inv.critical], ['LOW', 'Bajos', inv.low], ['HEALTHY', 'Saludables', inv.healthy]].map(([s, l, n]) => h('div.row.row--between.text-sm', h('span.row.gap-2', h(`span.dot.dot--${s}`), l), h('b', fmt.int(n)))),
        h('div.divider'), h('div.row.row--between.text-sm', h('span.text-2', 'Productos activos'), h('b', fmt.int(inv.active_products))), me.can('products.cost.read') ? h('div.row.row--between.text-sm', h('span.text-2', 'Valor del inventario'), h('b', fmt.money(inv.stock_value))) : null, h('div.row.row--between.text-sm', h('span.text-2', 'Alertas abiertas'), h('b', fmt.int(d.overview.alerts?.unread))))));
    const custSum = d.customers || {};
    const retentionCard = h('div.card', h('div.card__head', h('div', h('div.card__title', 'Clientes'), h('div.card__sub', 'Retención y recompra')), h('a.btn.btn--ghost.btn--sm', { href: '#/analytics/customers' }, 'RFM', icon('arrowRight'))),
      h('div.card__body', h('div.grid.grid--2', { style: { gap: '12px' } }, mini('Nuevos en el periodo', fmt.int(custSum.new_in_period)), mini('Recurrentes', fmt.int(custSum.returning_in_period)), mini('Tasa de recompra', fmt.pctPlain(custSum.repeat_rate_pct)), mini('Inactivos +90 días', fmt.int(custSum.inactive_90d)))));
    const recent = h('div.card', h('div.card__head', h('div', h('div.card__title', 'Ventas recientes')), h('a.btn.btn--ghost.btn--sm', { href: '#/sales' }, 'Historial', icon('arrowRight'))),
      h('div.card__body.card__body--flush', (d.recent_sales || []).length ? h('div.table-wrap', h('table.table.table--compact', h('tbody', d.recent_sales.map(s => h('tr.clickable', { onclick: () => location.hash = `#/sales/${s.id}` },
        h('td', h('div.cell-main', s.folio), h('div.cell-sub', fmt.relative(s.sold_at))), h('td', { 'data-private': '' }, s.customers ? fmt.name(s.customers) : h('span.text-3', 'Público')), h('td', badge('channel', s.channel)), h('td', badge('sale', s.status)), h('td.num.strong', fmt.money(s.total))))))) : h('div.card__body', emptyState({ icon: 'receipt', title: 'Aún no hay ventas', action: me.can('sales.create') ? { label: 'Nueva venta', onClick: () => location.hash = '#/pos' } : null }))));
    const pm = d.payment_methods || [];
    const pmCard = h('div.card', h('div.card__head', h('div', h('div.card__title', 'Métodos de pago'))), h('div.card__body', h('div', { id: 'c-pm' })));

    replace(body, kpis, h('div.grid.grid--main-aside', revenueCard, catCard), h('div.grid.grid--3', topCard, heatCard, geoCard), h('div.grid.grid--3', alertsCard, retentionCard, pmCard), recent);
    chart(body.querySelector('#c-revenue'), { type: series.length > 31 ? 'line' : 'bar', labels: series.map(s => labelFor(s.bucket, d.range)), datasets: [{ label: 'Ingresos', data: series.map(s => s.revenue) }], money: true, legend: false });
    const cats = d.categories || [];
    chart(body.querySelector('#c-cat'), { type: 'doughnut', labels: cats.slice(0, 7).map(c => c.name), datasets: [{ data: cats.slice(0, 7).map(c => c.revenue) }], money: true, donutCenter: { value: cats.length ? `${cats[0].share_pct} %` : '—', label: cats[0]?.name || '' } });
    heatmap(body.querySelector('#c-heat'), d.heatmap || []);
    chart(body.querySelector('#c-pm'), { type: 'bar', horizontal: true, labels: pm.map(p => p.name || p.method_code), datasets: [{ label: 'Monto', data: pm.map(p => p.amount) }], money: true, legend: false, size: 'sm' });
  }
  function mini(label, value) { return h('div.card--soft', { style: { padding: '12px 14px', borderRadius: '12px' } }, h('div.text-xs.text-3', label), h('div.serif', { style: { fontSize: '1.3rem', fontWeight: '600' } }, value)); }
  function labelFor(bucket, range) {
    const d = new Date(bucket);
    if (range.days <= 2) return `${String(d.getHours()).padStart(2, '0')}:00`;
    if (range.days <= 92) return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    if (range.days <= 400) return `Sem ${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`;
    return d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
  }
  /** Vista para roles sin analytics (vendedor/almacén): accesos y su día */
  async function operatorView() {
    const cards = [];
    if (me.can('sales.create')) cards.push(h('a.card.kpi', { href: '#/pos' }, h('div.kpi__label', icon('cart'), 'Punto de venta'), h('div.kpi__value.kpi__value--sm', 'Vender'), h('div.kpi__foot', 'Cobra rápido con el escáner o el buscador')));
    if (me.can('cash.open')) cards.push(h('a.card.kpi', { href: '#/cash' }, h('div.kpi__label', icon('cash'), 'Caja'), h('div.kpi__value.kpi__value--sm', 'Turno'), h('div.kpi__foot', 'Abre o cierra tu turno de caja')));
    if (me.can('inventory.read')) cards.push(h('a.card.kpi', { href: '#/stock' }, h('div.kpi__label', icon('layers'), 'Existencias'), h('div.kpi__value.kpi__value--sm', 'Inventario'), h('div.kpi__foot', 'Consulta stock por almacén')));
    if (me.can('purchases.receive')) cards.push(h('a.card.kpi', { href: '#/purchases' }, h('div.kpi__label', icon('truck'), 'Compras'), h('div.kpi__value.kpi__value--sm', 'Recibir'), h('div.kpi__foot', 'Recepción de mercancía')));
    if (me.can('customers.read')) cards.push(h('a.card.kpi', { href: '#/customers' }, h('div.kpi__label', icon('users'), 'Clientes'), h('div.kpi__value.kpi__value--sm', 'Directorio'), h('div.kpi__foot', 'Busca y registra clientes')));
    let mine = null;
    if (me.can('sales.read.own') || me.can('sales.read')) { try { const r = await api.get('/sales', { size: 8, sort: '-sold_at', from: fmt.dateInput() }); mine = r.data; } catch { /* nada */ } }
    return h('div.stack', { style: { gap: '20px' } }, h('div.grid.grid--kpi', cards), mine ? h('div.card', h('div.card__head', h('div.card__title', 'Tus ventas de hoy')), h('div.card__body.card__body--flush', mine.length ? h('table.table.table--compact', h('tbody', mine.map(s => h('tr', h('td', s.folio), h('td', fmt.time(s.sold_at)), h('td', badge('sale', s.status)), h('td.num.strong', fmt.money(s.total)))))) : h('div.card__body', emptyState({ icon: 'receipt', title: 'Aún no has vendido hoy' })))) : null);
  }
  await load();
  return () => {};
}
