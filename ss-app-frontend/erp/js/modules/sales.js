// ═══════════════════════════════════════════════════════════════════════════
// Ventas — historial, detalle, cancelación, devolución y ticket
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, badge, $ } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openModal, openDrawer, confirm, toast, dropdown } from '../ui/overlay.js';
import { field, setLoading, spinner, emptyState } from '../ui/widgets.js';

export const routes = ['/sales', '/sales/:id'];
export const title = 'Ventas';
export const crumb = 'Operación';
export const perms = ['sales.read', 'sales.read.own'];

export async function render(root, ctx) {
  const head = h('div.page-head', h('div', h('h1.page-head__title', 'Ventas'), h('p.page-head__sub', me.can('sales.read') ? 'Historial completo de ventas. Una venta completada nunca se borra: se cancela o se devuelve con rastro.' : 'Tus ventas.')),
    h('div.page-head__actions', me.can('sales.create') ? h('a.btn.btn--primary', { href: '#/pos' }, icon('cart'), 'Nueva venta') : null));
  const tableBox = h('div');
  root.append(head, tableBox);
  const sellers = me.can('sales.read') ? (await api.get('/users', { size: 100 }).catch(() => ({ data: [] }))).data : [];
  const table = new DataTable({
    id: 'sales', endpoint: '/sales', defaultSort: '-sold_at', exportKey: 'sales_detail', searchPlaceholder: 'Folio…', emptyTitle: 'Sin ventas', emptyText: 'Las ventas del POS y de la tienda en línea aparecerán aquí.',
    filters: [
      { key: 'sold', label: 'Fecha', type: 'daterange' },
      { key: 'status', label: 'Estado', type: 'select', options: [['COMPLETED', 'Completada'], ['CANCELLED', 'Cancelada'], ['REFUNDED', 'Devuelta'], ['PARTIALLY_REFUNDED', 'Dev. parcial']].map(([value, label]) => ({ value, label })) },
      { key: 'channel', label: 'Canal', type: 'select', options: [['POS', 'Tienda'], ['ONLINE', 'En línea']].map(([value, label]) => ({ value, label })) },
      { key: 'payment_method', label: 'Pago', type: 'select', options: me.paymentMethods.map(m => ({ value: m.code, label: m.name })) },
      ...(me.branches.length > 1 ? [{ key: 'branch', label: 'Sucursal', type: 'select', options: me.branches.map(b => ({ value: b.id, label: b.name })) }] : []),
      ...(sellers.length ? [{ key: 'seller', label: 'Vendedor', type: 'select', options: sellers.map(u => ({ value: u.id, label: fmt.name(u) })) }] : []),
    ],
    columns: [
      { key: 'folio', label: 'Folio', render: r => h('div', h('div.cell-main', r.folio), h('div.cell-sub', fmt.datetime(r.sold_at))) },
      { key: 'customer', label: 'Cliente', sortable: false, render: r => r.customer ? h('span', { 'data-private': '' }, fmt.name(r.customer)) : h('span.text-3', 'Público') },
      { key: 'seller_name', label: 'Vendedor', sortable: false, hideSm: true, render: r => r.seller_name || h('span.text-3', '—') },
      { key: 'channel', label: 'Canal', sortable: false, hideSm: true, render: r => badge('channel', r.channel) },
      { key: 'items_count', label: 'Arts.', num: true, hideSm: true },
      { key: 'payments', label: 'Pago', sortable: false, hideSm: true, render: r => (r.payments || []).map(p => me.paymentMethods.find(m => m.code === p.method_code)?.name || p.method_code).join(' + ') || '—' },
      { key: 'discount_amount', label: 'Desc.', num: true, hideSm: true, render: r => r.discount_amount > 0 ? h('span.down', `−${fmt.money(r.discount_amount)}`) : '—' },
      { key: 'total', label: 'Total', num: true, render: r => h('b', fmt.money(r.total)) },
      { key: 'status', label: 'Estado', render: r => badge('sale', r.status) },
      { key: '_actions', label: '', sortable: false, render: r => dropdown(h('button.btn.btn--ghost.btn--icon.btn--sm', { 'aria-label': 'Acciones' }, icon('more')), () => actionsFor(r, () => table.reload())) },
    ],
    onRow: (r) => openSaleDetail(r.id, () => table.reload()),
  }).mount(tableBox);
  if (ctx.params.id) openSaleDetail(ctx.params.id, () => table.reload());
}

function actionsFor(s, onDone) {
  const items = [{ label: 'Ver detalle', icon: 'eye', onClick: () => openSaleDetail(s.id, onDone) }, { label: 'Reimprimir ticket', icon: 'print', onClick: () => printTicket(s.id) }];
  if (s.status === 'COMPLETED' && me.can('sales.refund')) items.push({ label: 'Registrar devolución', icon: 'undo', onClick: () => openReturn(s.id, onDone) });
  if (s.status === 'COMPLETED' && me.can('sales.cancel')) items.push({ sep: true }, { label: 'Cancelar venta', icon: 'x', danger: true, onClick: () => cancelSale(s, onDone) });
  return items;
}

export async function cancelSale(s, onDone) {
  const reason = await confirm({ title: `Cancelar ${s.folio}`, text: 'El inventario regresa al almacén y el reembolso se registra en el turno abierto (si lo hay). Esta acción queda auditada.', confirmText: 'Cancelar venta', danger: true, input: { label: 'Motivo', placeholder: 'Ej. error de captura', required: true } });
  if (!reason) return;
  try {
    const cur = await api.get('/cash/shifts/current').catch(() => ({ shift: null }));
    await api.post(`/sales/${s.id}/cancel`, { reason, cash_shift_id: cur.shift?.id || null });
    toast('Venta cancelada'); onDone?.();
  } catch (e) { toast.error(friendlyError(e)); }
}

export async function openSaleDetail(id, onDone) {
  const body = h('div', spinner());
  const d = openDrawer({ title: 'Venta', size: 'lg', body, footer: (ctx) => [h('button.btn.btn--secondary', { onclick: () => printTicket(id) }, icon('print'), 'Ticket')] });
  try {
    const s = await api.get(`/sales/${id}`);
    d.setTitle(s.folio);
    const returned = (s.items || []).reduce((a, i) => a + (i.returned_quantity || 0), 0);
    replace(body,
      h('div.row.gap-2.mb-4', badge('sale', s.status), badge('channel', s.channel), h('span.text-sm.text-2', fmt.datetime(s.sold_at)), s.branch_name ? h('span.text-sm.text-3', `· ${s.branch_name}`) : null),
      h('div.grid.grid--3', { style: { gap: '12px' } },
        info('Cliente', s.customer ? h('a', { href: `#/customers/${s.customer.id}`, 'data-private': '' }, fmt.name(s.customer)) : 'Público en general'),
        info('Vendedor', s.seller_name || '—'), info('Colonia', s.neighborhood_name || '—')),
      h('div.card.mt-4', h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto'), h('th.num', 'Cant.'), h('th.num', 'Precio'), h('th.num', 'Desc.'), h('th.num', 'Importe'))),
        h('tbody', (s.items || []).map(i => h('tr', h('td', h('div.cell-main', i.product_name, i.variant_name ? ` · ${i.variant_name}` : ''), h('div.cell-sub', [i.sku, i.returned_quantity > 0 ? `${i.returned_quantity} devueltas` : null].filter(Boolean).join(' · '))), h('td.num', i.quantity), h('td.num', fmt.money(i.unit_price)), h('td.num', i.discount_amount > 0 ? `−${fmt.money(i.discount_amount)}` : '—'), h('td.num.strong', fmt.money(i.line_total)))))))),
      h('div.grid.grid--2.mt-4', { style: { gap: '12px' } },
        h('div.card.card--soft', { style: { padding: '14px 16px' } }, stat('Subtotal', fmt.money(s.subtotal)), stat('IVA', fmt.money(s.tax_amount)), s.discount_amount > 0 ? stat(`Descuento${s.discount_reason ? ` (${s.discount_reason})` : ''}`, `−${fmt.money(s.discount_amount)}`) : null, stat('Total', fmt.money(s.total), true), s.refunded_amount > 0 ? stat('Reembolsado', `−${fmt.money(s.refunded_amount)}`) : null, s.change_amount > 0 ? stat('Cambio entregado', fmt.money(s.change_amount)) : null),
        h('div.card.card--soft', { style: { padding: '14px 16px' } }, h('div.eyebrow.mb-2', 'Pagos'), (s.payments || []).map(p => stat(me.paymentMethods.find(m => m.code === p.method_code)?.name || p.method_code, fmt.money(p.amount))), s.notes ? h('div.mt-4', h('div.eyebrow', 'Notas'), h('p.text-sm', s.notes)) : null)),
      (s.returns || []).length ? h('div.mt-4', h('div.eyebrow.mb-2', 'Devoluciones'), (s.returns || []).map(r => h('div.alert.alert--warning', { style: { marginBottom: '8px' } }, icon('undo'), h('div', h('div.alert__title', `${r.folio} · ${fmt.money(r.refund_amount)} vía ${r.refund_method_code}`), h('div.alert__text', `${r.reason} · ${fmt.datetime(r.created_at)}`))))) : null,
      s.status === 'CANCELLED' ? h('div.alert.alert--danger.mt-4', icon('x'), h('div', h('div.alert__title', 'Venta cancelada'), h('div.alert__text', `${s.cancel_reason || ''} · ${fmt.datetime(s.cancelled_at)}`))) : null,
      h('div.mt-6', h('div.eyebrow.mb-2', 'Trazabilidad'), h('div.timeline', (s.audit || []).map(a => h('div.timeline__item', h('div.timeline__dot'), h('div', h('div.timeline__title', labelAction(a.action)), h('div.timeline__meta', `${a.user_name || 'Sistema'} · ${fmt.datetime(a.created_at)}${a.metadata?.reason ? ' · ' + a.metadata.reason : ''}`)))),
        (s.inventory_movements || []).map(m => h('div.timeline__item', h('div.timeline__dot', { style: { background: 'var(--color-bg-muted)', borderColor: 'var(--color-border-strong)' } }), h('div', h('div.timeline__title', `${m.reference} · ${badge('movement', m.movement_type).textContent} ${m.quantity > 0 ? '+' : ''}${m.quantity} ${m.products?.name || ''}`), h('div.timeline__meta', `${m.quantity_before} → ${m.quantity_after} · ${fmt.datetime(m.created_at)}`)))))),
    );
    const foot = $('.drawer__foot', d.el);
    if (s.status === 'COMPLETED' && me.can('sales.refund')) foot.prepend(h('button.btn.btn--secondary', { onclick: () => openReturn(s.id, () => { d.close(); onDone?.(); }) }, icon('undo'), 'Devolución'));
    if (s.status === 'COMPLETED' && me.can('sales.cancel')) foot.prepend(h('button.btn.btn--danger-soft', { onclick: () => cancelSale(s, () => { d.close(); onDone?.(); }) }, icon('x'), 'Cancelar venta'));
  } catch (e) { replace(body, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar la venta', text: friendlyError(e) })); }
  function info(l, v) { return h('div', h('div.eyebrow', l), h('div.text-sm.mt-2', v)); }
  function stat(l, v, strong) { return h('div.stat-row', h('span', { class: strong ? 'strong' : 'text-2' }, l), h('b', { class: strong ? 'serif' : '', style: strong ? { fontSize: '1.1rem' } : null }, v)); }
}
function labelAction(a) { return ({ 'sales.create': 'Venta creada', 'sales.discount': 'Descuento aplicado', 'sales.cancel': 'Venta cancelada', 'sales.refund': 'Devolución registrada', 'sales.update': 'Venta editada', 'sales.ticket.print': 'Ticket impreso' })[a] || a; }

export async function openReturn(saleId, onDone) {
  const s = await api.get(`/sales/${saleId}`);
  const items = (s.items || []).filter(i => i.product_id && i.quantity - i.returned_quantity > 0);
  if (!items.length) { toast.warn('No quedan artículos por devolver.'); return; }
  const qtys = {};
  const rows = items.map(i => { const q = h('input.input.input--sm', { type: 'number', min: 0, max: i.quantity - i.returned_quantity, value: 0, style: { width: '70px' } }); const restock = h('input', { type: 'checkbox', checked: true }); qtys[i.id] = { q, restock }; return h('tr', h('td', h('div.cell-main', i.product_name), h('div.cell-sub', `${fmt.money(i.line_total / i.quantity)} c/u · ${i.quantity - i.returned_quantity} disponibles`)), h('td', q), h('td', h('label.check', restock, 'Regresa a stock'))); });
  const reason = field({ label: 'Motivo', name: 'reason', type: 'select', placeholder: 'Elige un motivo', options: ['No le gustó', 'Producto defectuoso', 'Talla o modelo incorrecto', 'Cambio por otro producto', 'Otro'].map(v => ({ value: v, label: v })), required: true });
  const method = field({ label: 'Método de reembolso', name: 'method', type: 'select', options: me.paymentMethods.map(m => ({ value: m.code, label: m.name })), value: (s.payments?.[0]?.method_code) || 'CASH' });
  const notes = field({ label: 'Notas', name: 'notes', type: 'textarea', rows: 2 });
  const totalEl = h('div.pos__total', h('span', 'Reembolso'), h('span', fmt.money(0)));
  const recalc = () => { let t = 0; items.forEach(i => { t += (Number(qtys[i.id].q.value) || 0) * (i.line_total / i.quantity); }); totalEl.lastChild.textContent = fmt.money(t); };
  items.forEach(i => qtys[i.id].q.addEventListener('input', recalc));
  openModal({ title: `Devolución de ${s.folio}`, size: 'md', body: h('div.stack', h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto'), h('th', 'Cantidad'), h('th', ''))), h('tbody', rows))), h('div.form-grid', reason, method), notes, totalEl),
    footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
      const sel = items.filter(i => Number(qtys[i.id].q.value) > 0).map(i => ({ sale_item_id: i.id, quantity: Number(qtys[i.id].q.value), restock: qtys[i.id].restock.checked }));
      if (!sel.length) { toast.warn('Indica las cantidades a devolver.'); return; }
      if (!reason.input.value) { toast.warn('Elige el motivo.'); return; }
      setLoading(e.currentTarget, true);
      try {
        const cur = await api.get('/cash/shifts/current').catch(() => ({ shift: null }));
        await api.post(`/sales/${saleId}/returns`, { reason: reason.input.value, refund_method_code: method.input.value, cash_shift_id: cur.shift?.id || null, notes: notes.input.value || null, items: sel });
        toast('Devolución registrada'); m.close(); onDone?.();
      } catch (err) { toast.error(friendlyError(err)); setLoading(e.currentTarget, false); }
    } }, icon('undo'), 'Registrar devolución')] });
}

/** Ticket 80 mm / carta, imprimible y reimprimible */
export async function printTicket(saleId, { auto = false } = {}) {
  let t;
  try { t = await api.get(`/sales/${saleId}/ticket`); } catch (e) { toast.error(friendlyError(e)); return; }
  const s = t.sale, cfg = t.ticket || {}, company = t.company || {};
  const showCustomer = cfg.show_customer && s.customer;
  const el = (letter) => h(`div.ticket${letter ? '.ticket--letter' : ''}`,
    h('div.ticket__brand', h('div.ticket__name', cfg.header || company.name || 'SONROJA'), h('div.ticket__tag', cfg.tagline || 'Sensual · Confiada · Libre'), t.branch ? h('div', { style: { fontSize: '9px', marginTop: '4px' } }, [t.branch.name, t.branch.street, t.branch.phone].filter(Boolean).join(' · ')) : null),
    h('hr.ticket__rule'),
    h('div.ticket__meta', h('span', `Folio ${s.folio}`), h('span', fmt.date(s.sold_at))),
    h('div.ticket__meta', h('span', `${t.branch?.name || ''}`), h('span', fmt.time(s.sold_at))),
    s.seller_name ? h('div.ticket__meta', h('span', `Atendió: ${s.seller_name}`), h('span', '')) : null,
    showCustomer ? h('div.ticket__meta', h('span', `Cliente: ${fmt.name(s.customer)}`), h('span', '')) : null,
    s.status !== 'COMPLETED' ? h('div.ticket__status', ({ CANCELLED: 'CANCELADA', REFUNDED: 'DEVUELTA', PARTIALLY_REFUNDED: 'DEVOLUCIÓN PARCIAL' })[s.status]) : null,
    h('hr.ticket__rule'),
    (s.items || []).map(i => h('div.ticket__item', h('div.ticket__item-name', i.product_name + (i.variant_name ? ` · ${i.variant_name}` : '')), h('div.ticket__item-total', fmt.money(i.line_total)), h('div.ticket__item-sub', `${i.quantity} × ${fmt.money(i.unit_price)}${i.discount_amount > 0 ? `  (desc. −${fmt.money(i.discount_amount)})` : ''}`))),
    h('hr.ticket__rule'),
    h('div.ticket__totals', h('div.ticket__row', h('span', 'Subtotal'), h('span', fmt.money(s.subtotal))), s.discount_amount > 0 ? h('div.ticket__row', h('span', 'Descuento'), h('span', `−${fmt.money(s.discount_amount)}`)) : null, h('div.ticket__row', h('span', 'IVA'), h('span', fmt.money(s.tax_amount))), h('div.ticket__row.ticket__row--grand', h('span', 'TOTAL'), h('span', fmt.money(s.total))),
      (s.payments || []).map(p => h('div.ticket__row', h('span', me.paymentMethods.find(m => m.code === p.method_code)?.name || p.method_code), h('span', fmt.money(p.amount)))), s.change_amount > 0 ? h('div.ticket__row', h('span', 'Cambio'), h('span', fmt.money(s.change_amount))) : null),
    h('hr.ticket__rule'),
    h('div.ticket__foot', cfg.footer || 'Gracias por tu compra.'), h('div.ticket__barcode', s.folio));
  let letter = false;
  const box = h('div', el(false));
  const m = openModal({ title: `Ticket ${s.folio}`, print: true, body: box, footer: (ctx) => [
    h('button.btn.btn--ghost', { onclick: () => { letter = !letter; replace(box, el(letter)); } }, icon('file'), 'Cambiar formato'),
    h('button.btn.btn--secondary', { onclick: () => ctx.close() }, 'Cerrar'),
    h('button.btn.btn--primary', { onclick: doPrint }, icon('print'), 'Imprimir / PDF')] });
  function doPrint() { document.body.classList.add('print-ticket'); window.print(); setTimeout(() => document.body.classList.remove('print-ticket'), 500); }
  if (auto && me.settings?.ticket?.auto_print) setTimeout(doPrint, 300);
}
