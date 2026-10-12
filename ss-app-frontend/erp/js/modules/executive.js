// ═══════════════════════════════════════════════════════════════════════════
// Modo ejecutivo — las preguntas del dueño respondidas en una pantalla
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { rangeParams } from '../core/store.js';
import { h, icon, fmt, replace, badge } from '../core/dom.js';
import { kpi, dateFilter, skeletonCards, emptyState, delta } from '../ui/widgets.js';
import { openProductQuickView } from './products.js';
import { openCustomer360 } from './customers.js';

export const route = '/executive';
export const title = 'Modo ejecutivo';
export const crumb = 'Acción';
export const perms = ['analytics.read'];

export async function render(root) {
  const body = h('div.stack', { style: { gap: '20px' } });
  root.append(h('div.page-head', h('div', h('h1.page-head__title', '¿Cómo está el negocio?'), h('p.page-head__sub', 'Respuestas directas con datos reales. Sin ruido.')), dateFilter(load)), body);
  async function load() {
    replace(body, skeletonCards(6));
    let d; try { d = await api.get('/analytics/executive', rangeParams()); } catch (e) { replace(body, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar', text: friendlyError(e) })); return; }
    const hb = d.how_is_business;
    const q = (title, sub, content) => h('div.card', h('div.card__head', h('div', h('div.card__title', title), sub ? h('div.card__sub', sub) : null)), h('div.card__body.card__body--flush', content));
    const list = (rows, map) => rows?.length ? h('div.table-wrap', h('table.table.table--compact', h('tbody', rows.map(map)))) : h('div.card__body', h('p.text-sm.text-3', 'Sin datos en el periodo.'));
    replace(body,
      h('div.grid.grid--kpi', kpi({ label: 'Ventas', value: hb.revenue.current, prev: hb.revenue.previous, hero: true, tone: 'accent', foot: `${d.range.label} · ${fmt.int(hb.orders.current)} tickets` }), kpi({ label: 'Ticket promedio', value: hb.avg_ticket.current, prev: hb.avg_ticket.previous }), kpi({ label: 'Unidades', value: hb.units.current, prev: hb.units.previous, format: fmt.int }), kpi({ label: 'Clientes', value: hb.customers.current, prev: hb.customers.previous, format: fmt.int }), d.margin ? kpi({ label: 'Margen bruto', value: d.margin.gross_profit, foot: `${d.margin.gross_margin_pct} % · utilidad operativa ${fmt.money(d.margin.operating_profit, true)}` }) : kpi({ label: 'Alertas abiertas', value: d.alerts?.unread, format: fmt.int })),
      h('div.card', h('div.card__head', h('div', h('div.card__title', '¿Qué debería hacer esta semana?'), h('div.card__sub', 'Acciones sugeridas a partir de los datos'))), h('div.card__body', (d.this_week || []).length ? h('div.stack', d.this_week.map(i => h('div.insight', { class: `insight--${i.severity}` }, icon(i.severity === 'CRITICAL' ? 'alertCircle' : i.severity === 'WARNING' ? 'alertTriangle' : i.severity === 'SUCCESS' ? 'checkCircle' : 'sparkles'), h('div', h('div.insight__title', i.title), h('div.insight__text', i.text), i.action ? h('a.insight__action', { href: i.link || '#' }, icon('arrowRight'), i.action) : null)))) : h('p.text-sm.text-3', 'Todo tranquilo: no hay acciones urgentes.'))),
      h('div.grid.grid--2',
        q('¿Qué vendí?', 'Top productos por ingresos', list(d.what_sold, p => h('tr.clickable', { onclick: () => openProductQuickView(p.product_id) }, h('td', p.name), h('td.num', `${p.units} uds`), h('td.num.strong', fmt.money(p.revenue))))),
        q('¿Qué está creciendo?', 'Últimas 4 semanas vs anteriores', list(d.what_grows, p => h('tr.clickable', { onclick: () => openProductQuickView(p.product_id) }, h('td', p.name), h('td.num', fmt.money(p.cur)), h('td.num.up', fmt.pct(p.growth_pct)))))),
      h('div.grid.grid--2',
        q('¿Qué está cayendo?', 'Últimas 4 semanas vs anteriores', list(d.what_falls, p => h('tr.clickable', { onclick: () => openProductQuickView(p.product_id) }, h('td', p.name), h('td.num', fmt.money(p.cur)), h('td.num.down', fmt.pct(p.growth_pct))))),
        q('¿Qué productos debo comprar?', 'Bajo mínimo o con menos de 10 días de inventario', list(d.what_to_buy, p => h('tr.clickable', { onclick: () => openProductQuickView(p.product_id) }, h('td', p.name), h('td.num', `${p.stock} en stock`), h('td.num', p.days_of_inventory != null ? h('b.down', `${p.days_of_inventory} días`) : h('span.text-3', 'bajo mínimo')))))),
      h('div.grid.grid--2',
        q('¿De dónde vienen mis clientes?', 'Colonias con más ingresos', list(d.where_customers, n => h('tr', h('td', n.name), h('td.num', `${n.customers} clientes`), h('td.num.strong', `${fmt.money(n.revenue)} · ${n.share_pct} %`)))),
        q('¿A qué hora vendo más?', 'Franjas con más ingresos', list(d.when_sell, x => h('tr', h('td', `${fmt.dowLong(x.dow)} ${fmt.hour(x.hour)}`), h('td.num', `${x.sales} ventas`), h('td.num.strong', fmt.money(x.revenue)))))),
      h('div.grid.grid--2',
        q('¿Qué productos están detenidos?', 'Sin movimiento o rotación lenta', list(d.stuck_products, p => h('tr.clickable', { onclick: () => openProductQuickView(p.product_id) }, h('td', p.name), h('td', badge('rotation', p.classification)), h('td.num', `${p.stock} uds${me.can('products.cost.read') ? ' · ' + fmt.money(p.stock_value, true) : ''}`)))),
        q('¿Qué clientes están regresando?', 'Dos o más compras en las últimas 4 semanas', list(d.returning_customers, c => h('tr.clickable', { onclick: () => openCustomer360(c.customer_id) }, h('td', { 'data-private': '' }, fmt.name(c)), h('td.num', `${c.purchases} compras`), h('td.num.strong', fmt.money(c.revenue)))))),
      d.categories_growing?.length || d.categories_falling?.length ? h('div.grid.grid--2', q('Categorías creciendo', '', list(d.categories_growing, c => h('tr', h('td', c.name), h('td.num', fmt.money(c.cur)), h('td.num.up', fmt.pct(c.growth_pct))))), q('Categorías cayendo', '', list(d.categories_falling, c => h('tr', h('td', c.name), h('td.num', fmt.money(c.cur)), h('td.num.down', fmt.pct(c.growth_pct)))))) : null,
      h('div.card', h('div.card__head', h('div.card__title', 'Todos los insights')), h('div.card__body', h('div.stack', (d.insights || []).map(i => h('div.insight', { class: `insight--${i.severity}` }, icon(i.severity === 'CRITICAL' ? 'alertCircle' : i.severity === 'WARNING' ? 'alertTriangle' : i.severity === 'SUCCESS' ? 'checkCircle' : 'info'), h('div', h('div.insight__title', i.title), h('div.insight__text', i.text), i.action ? h('a.insight__action', { href: i.link || '#' }, icon('arrowRight'), i.action) : null)))))));
  }
  await load();
}
