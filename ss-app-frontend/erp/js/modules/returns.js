// ═══════════════════════════════════════════════════════════════════════════
// Devoluciones — historial
// ═══════════════════════════════════════════════════════════════════════════
import { h, icon, fmt } from '../core/dom.js';
import { me } from '../core/auth.js';
import { DataTable } from '../ui/table.js';
import { openSaleDetail } from './sales.js';

export const route = '/returns';
export const title = 'Devoluciones';
export const crumb = 'Operación';
export const perms = ['sales.read', 'sales.refund'];

export async function render(root) {
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Devoluciones'), h('p.page-head__sub', 'Cada devolución regresa el inventario (si aplica) y registra el reembolso en caja.'))));
  const box = h('div'); root.append(box);
  new DataTable({
    id: 'returns', endpoint: '/returns', defaultSort: '-created_at', searchPlaceholder: 'Folio de devolución…', emptyTitle: 'Sin devoluciones', emptyIcon: 'undo',
    filters: [{ key: 'created', label: 'Fecha', type: 'daterange' }, ...(me.branches.length > 1 ? [{ key: 'branch', label: 'Sucursal', type: 'select', options: me.branches.map(b => ({ value: b.id, label: b.name })) }] : [])],
    columns: [
      { key: 'folio', label: 'Devolución', render: r => h('div', h('div.cell-main', r.folio), h('div.cell-sub', fmt.datetime(r.created_at))) },
      { key: 'sale', label: 'Venta', sortable: false, render: r => h('a', { href: `#/sales/${r.sale_id}` }, r.sales?.folio || '—') },
      { key: 'customer', label: 'Cliente', sortable: false, render: r => r.sales?.customers ? h('span', { 'data-private': '' }, fmt.name(r.sales.customers)) : h('span.text-3', 'Público') },
      { key: 'items', label: 'Artículos', sortable: false, render: r => (r.sale_return_items || []).map(i => `${i.quantity}× ${i.sale_items?.product_name || ''}${i.restock ? '' : ' (merma)'}`).join(', ') },
      { key: 'reason', label: 'Motivo', sortable: false, hideSm: true },
      { key: 'refund_method_code', label: 'Reembolso', sortable: false, hideSm: true, render: r => me.paymentMethods.find(m => m.code === r.refund_method_code)?.name || r.refund_method_code },
      { key: 'user', label: 'Registró', sortable: false, hideSm: true, render: r => fmt.name(r.users) },
      { key: 'refund_amount', label: 'Monto', num: true, render: r => h('b', fmt.money(r.refund_amount)) },
    ],
    onRow: (r) => openSaleDetail(r.sale_id),
  }).mount(box);
}
