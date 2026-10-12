// ═══════════════════════════════════════════════════════════════════════════
// Centro de alertas — inventario, caja, anomalías, compras pendientes
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { store } from '../core/store.js';
import { h, icon, fmt, replace, badge } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { toast } from '../ui/overlay.js';

export const route = '/alerts';
export const title = 'Centro de alertas';
export const crumb = 'Acción';
export const perms = ['alerts.read'];

const TYPES = { INVENTORY_LOW: 'Stock bajo', OUT_OF_STOCK: 'Agotado', HIGH_DEMAND: 'Alta demanda', LOW_DEMAND: 'Baja demanda', UNUSUAL_SALES: 'Venta inusual', CASH_DISCREPANCY: 'Diferencia de caja', PURCHASE_PENDING: 'Compra pendiente', PRODUCT_INACTIVE: 'Producto inactivo', UNUSUAL_CANCELLATIONS: 'Cancelaciones', UNUSUAL_DISCOUNTS: 'Descuentos', FREQUENT_RETURNS: 'Devoluciones', UNUSUAL_ADJUSTMENTS: 'Ajustes de inventario', TRANSFER_DISCREPANCY: 'Faltante en transferencia' };
const LINK = { PRODUCT: id => `#/products/${id}`, SALE: id => `#/sales/${id}`, CASH_SHIFT: () => '#/cash', PURCHASE_ORDER: id => `#/purchases/${id}`, TRANSFER: id => `#/transfers/${id}`, USER: () => '#/settings/audit' };

export async function render(root) {
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Centro de alertas'), h('p.page-head__sub', 'Lo que requiere tu atención: inventario, caja, compras y actividad inusual. Las alertas se generan solas a partir de los datos.')),
    h('div.page-head__actions', h('button.btn.btn--secondary', { onclick: async () => { try { const n = store.get('unreadAlerts') || 0; await api.post('/alerts/read-all'); store.set('unreadAlerts', 0); toast(n ? `${fmt.plural(n, 'alerta marcada', 'alertas marcadas')} como leída${n === 1 ? '' : 's'}. Siguen abiertas hasta que las resuelvas.` : 'No había alertas sin leer.'); table.reload(); } catch (e) { toast.error(friendlyError(e)); } } }, icon('check'), 'Marcar todo leído'), me.can('alerts.resolve') ? h('button.btn.btn--ghost', { onclick: async () => { try { const r = await api.post('/alerts/run-checks'); toast(r.generated ? `Se revisaron inventario, caja, compras y actividad inusual: ${fmt.plural(r.generated, 'alerta nueva o actualizada', 'alertas nuevas o actualizadas')}.` : 'Se revisaron inventario, caja, compras y actividad inusual: no hay nada nuevo.', { title: 'Revisión terminada' }); table.reload(); } catch (e) { toast.error(friendlyError(e)); } } }, icon('refresh'), 'Revisar ahora') : null)));
  const box = h('div'); root.append(box);
  const table = new DataTable({ id: 'alerts', endpoint: '/alerts', defaultSort: '-created_at', searchPlaceholder: 'Buscar alerta…', emptyTitle: 'Sin alertas abiertas', emptyText: 'Todo en orden.', emptyIcon: 'checkCircle',
    filters: [{ key: 'status', label: 'Estado', type: 'select', options: [{ value: 'open', label: 'Abiertas' }, { value: 'UNREAD', label: 'No leídas' }, { value: 'RESOLVED', label: 'Resueltas' }, { value: 'all', label: 'Todas' }] }, { key: 'severity', label: 'Severidad', type: 'select', options: [['CRITICAL', 'Crítico'], ['WARNING', 'Atención'], ['INFO', 'Info']].map(([value, label]) => ({ value, label })) }, { key: 'type', label: 'Tipo', type: 'select', options: Object.entries(TYPES).map(([value, label]) => ({ value, label })) }],
    columns: [
      { key: 'severity', label: '', width: '40px', sortable: false, render: r => h(`span.dot`, { style: { background: r.severity === 'CRITICAL' ? 'var(--color-danger)' : r.severity === 'WARNING' ? 'var(--color-warning)' : r.severity === 'SUCCESS' ? 'var(--color-success)' : 'var(--color-info)', width: '11px', height: '11px' } }) },
      { key: 'title', label: 'Alerta', sortable: false, render: r => h('div', h('div.cell-main', { style: { fontWeight: r.status === 'UNREAD' ? '700' : '500' } }, r.title), h('div.cell-sub', r.description || '')) },
      { key: 'type', label: 'Tipo', hideSm: true, render: r => h('span.badge', TYPES[r.type] || r.type) },
      { key: 'created_at', label: 'Cuándo', render: r => fmt.relative(r.created_at) },
      { key: 'status', label: 'Estado', render: r => badge('alert', r.status) },
      { key: '_actions', label: '', render: r => h('div.row.gap-1', { style: { justifyContent: 'flex-end' } }, LINK[r.entity_type] ? h('a.btn.btn--ghost.btn--sm', { href: LINK[r.entity_type](r.entity_id) }, 'Ver') : null, r.status === 'UNREAD' ? h('button.btn.btn--ghost.btn--sm', { onclick: async () => { try { await api.post(`/alerts/${r.id}/read`); store.set('unreadAlerts', Math.max(0, (store.get('unreadAlerts') || 1) - 1)); table.reload(); } catch (e) { toast.error(friendlyError(e)); } } }, 'Leída') : null, r.status !== 'RESOLVED' && me.can('alerts.resolve') ? h('button.btn.btn--soft.btn--sm', { onclick: async () => { try { await api.post(`/alerts/${r.id}/resolve`); toast(r.title, { title: 'Alerta resuelta' }); table.reload(); } catch (e) { toast.error(friendlyError(e)); } } }, icon('check'), 'Resolver') : null) },
    ], onRow: async (r) => { if (r.status === 'UNREAD') { await api.post(`/alerts/${r.id}/read`).catch(() => {}); store.set('unreadAlerts', Math.max(0, (store.get('unreadAlerts') || 1) - 1)); } if (LINK[r.entity_type]) location.hash = LINK[r.entity_type](r.entity_id); } }).mount(box);
}
