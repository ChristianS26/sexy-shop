// ═══════════════════════════════════════════════════════════════════════════
// Alertas de stock — agotados, críticos, bajos, exceso, sin movimiento, rotación
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, badge } from '../core/dom.js';
import { kpi, skeletonCards, emptyState, tabs, stockBadge } from '../ui/widgets.js';
import { openProductQuickView } from './products.js';

export const route = '/inventory-alerts';
export const title = 'Alertas de stock';
export const crumb = 'Inventario';
export const perms = ['inventory.read', 'alerts.read'];

export async function render(root) {
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Alertas de stock'), h('p.page-head__sub', 'Qué reordenar, qué está detenido y qué vende mucho con poco inventario.')), h('div.page-head__actions', me.can('purchases.create') ? h('a.btn.btn--primary', { href: '#/purchases?suggest=1' }, icon('truck'), 'Sugerir compra') : null)));
  const kpis = h('div.grid.grid--kpi', skeletonCards(4)); const body = h('div'); root.append(kpis, body);
  let d;
  try { d = await api.get('/inventory/alerts'); } catch (e) { replace(kpis); replace(body, emptyState({ icon: 'alertCircle', title: 'No se pudieron cargar las alertas', text: friendlyError(e) })); return; }
  const s = d.summary;
  replace(kpis, kpi({ label: 'Agotados', value: s.out, format: fmt.int, icon: 'alertCircle' }), kpi({ label: 'Críticos', value: s.critical, format: fmt.int, icon: 'alertTriangle' }), kpi({ label: 'Bajos', value: s.low, format: fmt.int, icon: 'activity' }), kpi({ label: 'Sin movimiento / lentos', value: s.dead + s.slow, format: fmt.int, icon: 'clock', foot: s.dead_value != null ? `${fmt.money(s.dead_value)} detenidos` : null }));
  const stock = d.stock || [], slow = d.slow || [];
  const canCost = me.can('products.cost.read');
  const stockTable = (rows) => rows.length ? h('div.card', h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', 'Producto'), h('th', 'Almacén'), h('th', 'Estado'), h('th.num', 'Stock'), h('th.num', 'Mínimo'), h('th.num', 'Sugerido'), h('th', 'Proveedor'), h('th', ''))),
    h('tbody', rows.map(p => h('tr.clickable', { onclick: () => openProductQuickView(p.id) }, h('td', h('div.cell-main', p.name), h('div.cell-sub', [p.sku, p.category_name].filter(Boolean).join(' · '))), h('td', p.warehouse_name || '—'), h('td', stockBadge(p.stock_status)), h('td.num', h('b', p.stock)), h('td.num', p.min_stock), h('td.num', p.suggested_order ? h('b.up', `+${p.suggested_order}`) : '—'), h('td', p.supplier_name || h('span.text-3', '—')), h('td.actions', me.can('purchases.create') ? h('a.btn.btn--ghost.btn--sm', { href: `#/purchases?suggest=1&supplier=${p.supplier_id || ''}`, onclick: e => e.stopPropagation() }, 'Ordenar') : null))))))) : emptyState({ icon: 'checkCircle', title: 'Todo en orden', text: 'Ningún producto bajo mínimo en ningún almacén.' });
  const slowTable = () => slow.length ? h('div.card', h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', 'Producto'), h('th', 'Rotación'), h('th.num', 'Stock'), h('th.num', 'Vendidas 90 d'), h('th.num', 'Días inv.'), canCost ? h('th.num', 'Valor') : null, h('th', 'Última venta'))),
    h('tbody', slow.map(p => h('tr.clickable', { onclick: () => openProductQuickView(p.product_id) }, h('td', h('div.cell-main', p.name), h('div.cell-sub', [p.sku, p.category_name].filter(Boolean).join(' · '))), h('td', badge('rotation', p.classification)), h('td.num', p.stock), h('td.num', p.units_sold), h('td.num', p.days_of_inventory ?? '∞'), canCost ? h('td.num', fmt.money(p.stock_value)) : null, h('td', p.last_sold ? fmt.date(p.last_sold) : h('span.text-3', 'Nunca')))))))) : emptyState({ icon: 'checkCircle', title: 'Sin productos detenidos' });
  const content = h('div.mt-4');
  const t = tabs([{ key: 'reorder', label: 'Por reordenar', badge: stock.filter(p => p.stock_status !== 'EXCESS').length }, { key: 'slow', label: 'Sin movimiento / lentos', badge: slow.length }, { key: 'excess', label: 'Exceso', badge: stock.filter(p => p.stock_status === 'EXCESS').length }], 'reorder', (k) => replace(content, k === 'reorder' ? stockTable(stock.filter(p => p.stock_status !== 'EXCESS')) : k === 'slow' ? slowTable() : stockTable(stock.filter(p => p.stock_status === 'EXCESS'))));
  body.append(t, content); replace(content, stockTable(stock.filter(p => p.stock_status !== 'EXCESS')));
}
