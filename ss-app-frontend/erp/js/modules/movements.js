// ═══════════════════════════════════════════════════════════════════════════
// Movimientos de inventario — kardex inmutable con referencia INV-AAAA-NNNNNN
// ═══════════════════════════════════════════════════════════════════════════
import { api } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, badge } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openProductQuickView } from './products.js';

export const route = '/movements';
export const title = 'Movimientos de inventario';
export const crumb = 'Inventario';
export const perms = ['inventory.read'];

const TYPES = ['PURCHASE', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'LOSS', 'INITIAL_STOCK', 'INVENTORY_COUNT'];
const LBL = { PURCHASE: 'Compra', SALE: 'Venta', SALE_RETURN: 'Devolución', PURCHASE_RETURN: 'Dev. a proveedor', TRANSFER_IN: 'Entrada transf.', TRANSFER_OUT: 'Salida transf.', ADJUSTMENT_IN: 'Ajuste +', ADJUSTMENT_OUT: 'Ajuste −', DAMAGE: 'Merma', LOSS: 'Pérdida', INITIAL_STOCK: 'Inicial', INVENTORY_COUNT: 'Conteo' };

export async function render(root, ctx) {
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Movimientos'), h('p.page-head__sub', 'Nada cambia el stock sin un movimiento. Los movimientos no se editan ni se borran: se compensan con otro.'))));
  const box = h('div'); root.append(box);
  const productParam = ctx.params.product;
  const users = me.can('users.read') ? (await api.get('/users', { size: 100 }).catch(() => ({ data: [] }))).data : [];
  new DataTable({
    id: productParam ? null : 'movements', endpoint: '/inventory/movements', defaultSort: '-created_at', exportKey: 'stock_movements', searchPlaceholder: 'Referencia o motivo…', params: productParam ? { product: productParam } : {},
    emptyTitle: 'Sin movimientos', emptyIcon: 'activity',
    filters: [
      { key: 'created', label: 'Fecha', type: 'daterange' },
      { key: 'type', label: 'Tipo', type: 'select', options: TYPES.map(t => ({ value: t, label: LBL[t] })) },
      { key: 'warehouse', label: 'Almacén', type: 'select', options: me.warehouses.map(w => ({ value: w.id, label: w.name })) },
      ...(users.length ? [{ key: 'user', label: 'Usuario', type: 'select', options: users.map(u => ({ value: u.id, label: fmt.name(u) })) }] : []),
    ],
    columns: [
      { key: 'created_at', label: 'Fecha', render: r => h('div', h('div.cell-main', fmt.datetime(r.created_at)), h('div.cell-sub.mono', r.reference)) },
      { key: 'movement_type', label: 'Tipo', render: r => badge('movement', r.movement_type) },
      { key: 'product', label: 'Producto', sortable: false, render: r => h('a', { href: '#', onclick: (e) => { e.preventDefault(); openProductQuickView(r.product_id); } }, r.product_name, r.variant_name ? ` · ${r.variant_name}` : '') },
      { key: 'warehouse_name', label: 'Almacén', sortable: false, hideSm: true },
      { key: 'quantity', label: 'Cantidad', num: true, render: r => h('b', { class: r.quantity > 0 ? 'up' : 'down' }, `${r.quantity > 0 ? '+' : ''}${r.quantity}`) },
      { key: 'quantity_before', label: 'Antes → Después', num: true, sortable: false, hideSm: true, render: r => `${r.quantity_before} → ${r.quantity_after}` },
      { key: 'reason', label: 'Motivo / referencia', sortable: false, hideSm: true, render: r => h('div', h('div', r.reason || '—'), r.reference_type ? h('div.cell-sub', refLink(r)) : null) },
      { key: 'user_name', label: 'Usuario', sortable: false, hideSm: true, render: r => r.user_name || h('span.text-3', 'Sistema') },
    ],
  }).mount(box);
  function refLink(r) {
    const map = { SALE: `#/sales/${r.reference_id}`, TRANSFER: `#/transfers/${r.reference_id}`, COUNT: `#/counts/${r.reference_id}`, PURCHASE_RECEIPT: '#/receipts' };
    const href = map[r.reference_type];
    return href && r.reference_id ? h('a', { href }, r.reference_type) : r.reference_type;
  }
}
