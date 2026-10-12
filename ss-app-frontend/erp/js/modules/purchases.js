// ═══════════════════════════════════════════════════════════════════════════
// Órdenes de compra y recepciones — Draft → Sent → Partial → Received → Completed
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, badge, debounce } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openModal, openDrawer, confirm, toast } from '../ui/overlay.js';
import { field, setLoading, spinner, emptyState, tabs } from '../ui/widgets.js';

export const routes = ['/purchases', '/purchases/:id', '/receipts'];
export const title = 'Compras';
export const crumb = 'Compras';
export const perms = ['purchases.read'];

export async function render(root, ctx) {
  const isReceipts = location.hash.startsWith('#/receipts');
  ctx.setTitle(isReceipts ? 'Recepciones' : 'Órdenes de compra', 'Compras');
  const suppliers = (await api.get('/suppliers', { size: 200, status: 'ACTIVE' }).catch(() => ({ data: [] }))).data;
  root.append(h('div.page-head', h('div', h('h1.page-head__title', isReceipts ? 'Recepciones' : 'Órdenes de compra'), h('p.page-head__sub', isReceipts ? 'Cada recepción (total o parcial) sube el inventario y actualiza el costo.' : 'Borrador → Enviada → Parcial → Recibida → Completada. Al recibir, entra al almacén.')),
    h('div.page-head__actions', isReceipts ? h('a.btn.btn--secondary', { href: '#/purchases' }, 'Órdenes') : [h('a.btn.btn--secondary', { href: '#/receipts' }, 'Recepciones'), me.can('purchases.create') ? h('button.btn.btn--secondary', { onclick: () => openSuggestions(suppliers, () => table.reload()) }, icon('sparkles'), 'Sugerencias') : null, me.can('purchases.create') ? h('button.btn.btn--primary', { onclick: () => openPoForm(null, suppliers, () => table.reload(), ctx.params.supplier) }, icon('plus'), 'Nueva orden') : null])));
  const box = h('div'); root.append(box);
  let table;
  if (isReceipts) {
    table = new DataTable({ id: 'receipts', endpoint: '/purchases/receipts', defaultSort: '-received_at', searchPlaceholder: 'Folio o factura…', emptyTitle: 'Sin recepciones', emptyIcon: 'inbox', filters: [{ key: 'received', label: 'Fecha', type: 'daterange' }],
      columns: [{ key: 'folio', label: 'Recepción', render: r => h('div', h('div.cell-main.mono', r.folio), h('div.cell-sub', fmt.datetime(r.received_at))) }, { key: 'po', label: 'Orden', sortable: false, render: r => h('a', { href: `#/purchases/${r.purchase_order_id}` }, r.purchase_orders?.folio) }, { key: 'supplier', label: 'Proveedor', sortable: false, render: r => r.purchase_orders?.suppliers?.name || '—' }, { key: 'warehouse', label: 'Almacén', sortable: false, hideSm: true, render: r => r.warehouses?.name }, { key: 'invoice_number', label: 'Factura', sortable: false, hideSm: true, render: r => r.invoice_number || '—' }, { key: 'receiver', label: 'Recibió', sortable: false, hideSm: true, render: r => fmt.name(r.receiver) }, { key: 'units', label: 'Unidades', num: true, sortable: false }, ...(me.can('products.cost.read') ? [{ key: 'total', label: 'Costo', num: true, sortable: false, render: r => fmt.money(r.total) }] : [])],
      onRow: (r) => openPo(r.purchase_order_id, suppliers, () => table.reload()) }).mount(box);
    return;
  }
  table = new DataTable({ id: 'purchases', endpoint: '/purchases', defaultSort: '-created_at', exportKey: 'purchases_detail', searchPlaceholder: 'Folio…', emptyTitle: 'Sin órdenes de compra', emptyIcon: 'clipboard', emptyAction: me.can('purchases.create') ? { label: 'Nueva orden', onClick: () => openPoForm(null, suppliers, () => table.reload()) } : null,
    filters: [{ key: 'created', label: 'Fecha', type: 'daterange' }, { key: 'status', label: 'Estado', type: 'select', options: [['DRAFT', 'Borrador'], ['SENT', 'Enviada'], ['PARTIAL', 'Parcial'], ['RECEIVED', 'Recibida'], ['COMPLETED', 'Completada'], ['CANCELLED', 'Cancelada']].map(([value, label]) => ({ value, label })) }, { key: 'supplier', label: 'Proveedor', type: 'select', options: suppliers.map(s => ({ value: s.id, label: s.name })) }],
    columns: [
      { key: 'folio', label: 'Orden', render: r => h('div', h('div.cell-main.mono', r.folio), h('div.cell-sub', fmt.datetime(r.created_at))) },
      { key: 'supplier', label: 'Proveedor', sortable: false, render: r => r.suppliers?.name },
      { key: 'warehouse', label: 'Almacén', sortable: false, hideSm: true, render: r => r.warehouses?.name },
      { key: 'expected_date', label: 'Esperada', hideSm: true, render: r => r.expected_date ? h('span', { class: r.status in { SENT: 1, PARTIAL: 1 } && r.expected_date < fmt.dateInput() ? 'down' : '' }, fmt.date(r.expected_date)) : '—' },
      { key: 'items', label: 'Avance', sortable: false, render: r => { const its = r.purchase_order_items || []; const q = its.reduce((a, i) => a + i.quantity, 0), rc = its.reduce((a, i) => a + i.received_quantity, 0); return h('div', { style: { minWidth: '110px' } }, h('div.text-xs', `${rc} / ${q} uds`), h('div.bar.mt-2', h('i', { style: { width: `${q ? rc / q * 100 : 0}%` } }))); } },
      ...(me.can('products.cost.read') ? [{ key: 'total', label: 'Total', num: true, render: r => h('b', fmt.money(r.total)) }] : []),
      { key: 'status', label: 'Estado', render: r => badge('purchase', r.status) },
    ], onRow: (r) => openPo(r.id, suppliers, () => table.reload()) }).mount(box);
  if (ctx.params.id) openPo(ctx.params.id, suppliers, () => table.reload());
  if (ctx.params.new) openPoForm(null, suppliers, () => table.reload(), ctx.params.supplier);
  if (ctx.params.suggest) openSuggestions(suppliers, () => table.reload(), ctx.params.supplier);
}

async function openPo(id, suppliers, onDone) {
  const box = h('div', spinner());
  const d = openDrawer({ title: 'Orden de compra', size: 'lg', body: box });
  try {
    const po = await api.get(`/purchases/${id}`);
    d.setTitle(po.folio);
    const items = po.purchase_order_items || [];
    const canCost = me.can('products.cost.read');
    replace(box, h('div.row.gap-2.mb-4', badge('purchase', po.status), h('span.text-sm.text-2', `${po.suppliers?.name} · ${po.warehouses?.name}`), po.expected_date ? h('span.text-sm.text-3', `· esperada ${fmt.date(po.expected_date)}`) : null),
      h('div.card', h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto'), h('th.num', 'Pedido'), h('th.num', 'Recibido'), canCost ? h('th.num', 'Costo') : null, canCost ? h('th.num', 'Importe') : null)), h('tbody', items.map(i => h('tr', h('td', h('div.cell-main', i.products?.name, i.product_variants?.name ? ` · ${i.product_variants.name}` : ''), h('div.cell-sub', i.products?.sku)), h('td.num', i.quantity), h('td.num', h('b', { class: i.received_quantity >= i.quantity ? 'up' : i.received_quantity > 0 ? 'flat' : '' }, i.received_quantity)), canCost ? h('td.num', fmt.money(i.unit_cost)) : null, canCost ? h('td.num', fmt.money(i.line_total)) : null)))))),
      canCost ? h('div.card.card--soft.mt-4', { style: { padding: '12px 16px' } }, h('div.stat-row', h('span', 'Subtotal'), h('b', fmt.money(po.subtotal))), h('div.stat-row', h('span', 'IVA'), h('b', fmt.money(po.tax_amount))), h('div.stat-row', h('span.strong', 'Total'), h('b.serif', fmt.money(po.total)))) : null,
      po.notes ? h('p.text-sm.text-2.mt-4', po.notes) : null,
      (po.receipts || []).length ? h('div.mt-4', h('div.eyebrow.mb-2', 'Recepciones'), po.receipts.map(r => h('div.alert.alert--success', { style: { marginBottom: '8px' } }, icon('inbox'), h('div', h('div.alert__title', `${r.folio} · ${fmt.datetime(r.received_at)} · ${fmt.name(r.receiver)}${r.invoice_number ? ' · Fact. ' + r.invoice_number : ''}`), h('div.alert__text', (r.purchase_receipt_items || []).map(i => `${i.quantity}× ${i.products?.name}`).join(', ')))))) : null);
    const foot = d.el.appendChild(h('div.drawer__foot'));
    if (po.status === 'DRAFT' && me.can('purchases.update')) foot.append(h('button.btn.btn--secondary', { onclick: () => { d.close(); openPoForm(po, suppliers, onDone); } }, icon('edit'), 'Editar'), h('button.btn.btn--primary', { onclick: () => setStatus('SENT') }, icon('send'), 'Marcar enviada'));
    if ((po.status === 'SENT' || po.status === 'PARTIAL') && me.can('purchases.receive')) foot.append(h('button.btn.btn--primary', { onclick: () => receive(po) }, icon('inbox'), 'Recibir mercancía'));
    if (po.status === 'PARTIAL' && me.can('purchases.update')) foot.append(h('button.btn.btn--secondary', { onclick: () => setStatus('COMPLETED') }, 'Cerrar como completada'));
    if (!['COMPLETED', 'CANCELLED', 'RECEIVED'].includes(po.status) && me.can('purchases.cancel')) foot.prepend(h('button.btn.btn--danger-soft', { onclick: async () => { const r = await confirm({ title: `Cancelar ${po.folio}`, confirmText: 'Cancelar orden', danger: true, input: { label: 'Motivo', required: true } }); if (r) setStatus('CANCELLED', r); } }, 'Cancelar'));
    async function setStatus(status, reason) { try { await api.post(`/purchases/${id}/status`, { status, reason }); const msg = { SENT: [`Marcada como enviada a ${po.suppliers?.name}. Recíbela cuando llegue la mercancía.`, `Orden ${po.folio} enviada`], COMPLETED: ['Lo que faltaba por llegar ya no se espera; la orden quedó cerrada.', `Orden ${po.folio} completada`], CANCELLED: ['No se recibirá mercancía de esta orden.', `Orden ${po.folio} cancelada`] }[status]; toast(msg[0], { title: msg[1] }); d.close(); onDone?.(); } catch (e) { toast.error(friendlyError(e), { title: `No se actualizó ${po.folio}` }); } }
    function receive(po) {
      const pending = items.filter(i => i.quantity - i.received_quantity > 0);
      const inputs = {};
      const invoice = field({ label: 'Número de factura / remisión', name: 'invoice_number' });
      const notes = field({ label: 'Notas', name: 'notes', type: 'textarea', rows: 2 });
      openModal({ title: `Recibir ${po.folio}`, size: 'md', sub: 'Ajusta las cantidades si la entrega fue parcial. Lo pendiente queda en la orden.', body: h('div.stack', h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto'), h('th.num', 'Pendiente'), h('th', 'Recibir'), canCost ? h('th', 'Costo real') : null)), h('tbody', pending.map(i => { inputs[i.id] = { q: h('input.input.input--sm', { type: 'number', min: 0, max: i.quantity - i.received_quantity, value: i.quantity - i.received_quantity, style: { width: '90px' } }), c: h('input.input.input--sm', { type: 'number', min: 0, step: '0.01', value: i.unit_cost, style: { width: '100px' } }) }; return h('tr', h('td', i.products?.name, i.product_variants?.name ? ` · ${i.product_variants.name}` : ''), h('td.num', i.quantity - i.received_quantity), h('td', inputs[i.id].q), canCost ? h('td', inputs[i.id].c) : null); })))), h('div.form-grid', invoice, notes)),
        footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { const over = pending.find(i => Number(inputs[i.id].q.value) > i.quantity - i.received_quantity || Number(inputs[i.id].q.value) < 0); if (over) { toast.warn(`De “${over.products?.name}” solo faltan ${over.quantity - over.received_quantity} por recibir.`); inputs[over.id].q.focus(); return; } const units = pending.reduce((a, i) => a + (Number(inputs[i.id].q.value) || 0), 0); if (!units) { toast.warn('Indica al menos una cantidad recibida mayor a 0.'); return; } if (canCost && pending.some(i => inputs[i.id].c.value === '' || Number(inputs[i.id].c.value) < 0)) { toast.warn('Revisa el costo real: no puede quedar vacío ni ser negativo.'); return; } setLoading(e.target.closest('button'), true); try { const res = await api.post(`/purchases/${id}/receive`, { invoice_number: invoice.input.value || null, notes: notes.input.value || null, items: pending.map(i => ({ po_item_id: i.id, quantity: Number(inputs[i.id].q.value) || 0, unit_cost: canCost ? Number(inputs[i.id].c.value) : undefined })) }); const st = res?.purchase_order?.status; toast(`${fmt.int(units)} unidades entraron a ${po.warehouses?.name}. ${st === 'PARTIAL' ? 'La orden sigue abierta con lo pendiente.' : 'La orden quedó recibida completa.'}`, { title: `Recepción ${res?.receipt?.folio || ''} registrada` }); m.close(); d.close(); onDone?.(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); } } }, icon('check'), 'Confirmar recepción')] });
    }
  } catch (e) { replace(box, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar', text: friendlyError(e) })); }
}

export function openPoForm(po, suppliers, onDone, presetSupplier = null, presetItems = []) {
  const items = po ? (po.purchase_order_items || []).map(i => ({ product: { id: i.product_id, name: i.products?.name }, variant: i.variant_id ? { id: i.variant_id, name: i.product_variants?.name } : null, quantity: i.quantity, unit_cost: i.unit_cost })) : presetItems;
  const sup = field({ label: 'Proveedor', name: 'supplier_id', type: 'select', required: true, options: suppliers, value: po?.supplier_id || presetSupplier, placeholder: 'Elige…' });
  const wh = field({ label: 'Almacén destino', name: 'warehouse_id', type: 'select', required: true, options: me.warehouses, value: po?.warehouse_id || me.warehouses[0]?.id });
  const expected = field({ label: 'Fecha esperada', name: 'expected_date', type: 'date', value: po?.expected_date });
  const notes = field({ label: 'Notas', name: 'notes', type: 'textarea', rows: 2, value: po?.notes });
  const search = h('input.input', { placeholder: 'Agregar producto…', autocomplete: 'off' });
  const results = h('div.menu.menu--left', { hidden: true, style: { position: 'static', marginTop: '4px' } });
  const list = h('div'); const totalEl = h('div.row.row--end.text-sm.strong');
  const canCost = me.can('products.cost.read');
  const renderList = () => { replace(list, items.length ? h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto'), h('th', 'Cantidad'), h('th', 'Costo unit.'), h('th', ''))), h('tbody', items.map((it, i) => h('tr', h('td', it.product.name, it.variant ? ` · ${it.variant.name}` : ''), h('td', h('input.input.input--sm', { type: 'number', min: 1, value: it.quantity, style: { width: '80px' }, oninput: e => { it.quantity = Number(e.target.value) || 0; total(); } })), h('td', h('input.input.input--sm', { type: 'number', min: 0, step: '0.01', value: it.unit_cost ?? '', style: { width: '110px' }, oninput: e => { it.unit_cost = Number(e.target.value) || 0; total(); } })), h('td.actions', h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', onclick: () => { items.splice(i, 1); renderList(); } }, icon('x'))))))) : h('p.text-sm.text-3', 'Agrega productos a la orden.')); total(); };
  const total = () => { const t = items.reduce((a, i) => a + (i.quantity || 0) * (i.unit_cost || 0), 0); totalEl.textContent = `Subtotal ${fmt.money(t)} · con IVA ${fmt.money(t * 1.16)}`; };
  search.addEventListener('input', debounce(async () => {
    const q = search.value.trim(); if (q.length < 2) { results.hidden = true; return; }
    const r = await api.get('/products', { q, size: 8, warehouse: wh.input.value });
    replace(results, r.data.map(p => h('button.menu__item', { type: 'button', onclick: async () => { if (p.has_variants) { const full = await api.get(`/products/${p.id}`); (full.variants || []).forEach(v => items.push({ product: p, variant: v, quantity: 0, unit_cost: canCost ? (v.cost_price ?? p.cost_price ?? 0) : 0 })); } else items.push({ product: p, variant: null, quantity: 1, unit_cost: canCost ? (p.cost_price ?? 0) : 0 }); results.hidden = true; search.value = ''; renderList(); } }, h('div', h('div', p.name), h('div.text-xs.text-3', `${p.sku || ''} · ${p.warehouse_stock ?? p.stock} en el almacén${canCost ? ' · costo ' + fmt.money(p.cost_price) : ''}`)))));
    results.hidden = false;
  }, 250));
  renderList();
  openModal({ title: po ? `Editar ${po.folio}` : 'Nueva orden de compra', size: 'lg', body: h('div.stack', h('div.form-grid.form-grid--3', sup, wh, expected), h('div', h('div.search', icon('search'), search), results), list, totalEl, notes),
    footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--secondary', { onclick: (e) => save(e, false, m) }, 'Guardar borrador'), h('button.btn.btn--primary', { onclick: (e) => save(e, true, m) }, icon('send'), po ? 'Guardar y enviar' : 'Crear y enviar')] });
  async function save(e, send, m) {
    const valid = items.filter(i => i.quantity > 0);
    if (!sup.input.value) { toast.warn('Elige el proveedor.'); sup.input.focus(); return; } if (!valid.length) { toast.warn(items.length ? 'Escribe una cantidad mayor a 0 en al menos un producto.' : 'Agrega al menos un producto con el buscador.'); return; }
    if (valid.some(i => (i.unit_cost || 0) < 0)) { toast.warn('El costo unitario no puede ser negativo.'); return; }
    setLoading(e.target.closest('button'), true);
    const payload = { supplier_id: sup.input.value, warehouse_id: wh.input.value, expected_date: expected.input.value || null, notes: notes.input.value || null, items: valid.map(i => ({ product_id: i.product.id, variant_id: i.variant?.id || null, quantity: i.quantity, unit_cost: i.unit_cost || 0 })) };
    try {
      let saved;
      if (po) { saved = await api.patch(`/purchases/${po.id}`, payload); if (send) saved = await api.post(`/purchases/${po.id}/status`, { status: 'SENT' }); }
      else saved = await api.post('/purchases', { ...payload, send });
      const supName = sup.input.selectedOptions[0]?.textContent; const units = valid.reduce((a, i) => a + i.quantity, 0);
      toast(`${supName} · ${fmt.int(units)} unidades${canCost ? ` · ${fmt.money(saved?.total)}` : ''}.${send ? ' Recíbela cuando llegue la mercancía.' : ''}`, { title: `Orden ${saved?.folio || ''} ${send ? 'enviada' : (po ? 'actualizada' : 'guardada como borrador')}` }); m.close(); onDone?.();
    } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); }
  }
}

async function openSuggestions(suppliers, onDone, presetSupplier) {
  const box = h('div', spinner());
  const m = openModal({ title: 'Sugerencias de reorden', size: 'lg', sub: 'Productos bajo mínimo o con menos de 14 días de inventario al ritmo de venta actual, agrupados por proveedor.', body: box });
  try {
    const s = await api.get('/purchases/suggestions');
    const groups = (s.by_supplier || []).filter(g => !presetSupplier || g.supplier_id === presetSupplier);
    replace(box, groups.length ? groups.map(g => h('div.card.mb-4', h('div.card__head', h('div.card__title', g.supplier_name), me.can('purchases.create') && g.supplier_id ? h('button.btn.btn--primary.btn--sm', { onclick: () => { m.close(); openPoForm(null, suppliers, onDone, g.supplier_id, g.items.map(i => ({ product: { id: i.id, name: i.name }, variant: null, quantity: i.suggested_qty, unit_cost: i.cost_price ?? 0 }))); } }, icon('clipboard'), 'Crear orden') : null),
      h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto'), h('th.num', 'Stock'), h('th.num', 'Mínimo'), h('th.num', 'Venta diaria'), h('th.num', 'Días'), h('th.num', 'Sugerido'))), h('tbody', g.items.map(i => h('tr', h('td', i.name, h('div.cell-sub', i.sku)), h('td.num', i.stock), h('td.num', i.low_stock_threshold ?? 3), h('td.num', fmt.num(i.avg_daily_sales, 2)), h('td.num', i.days_of_stock ?? '—'), h('td.num', h('b.up', `+${i.suggested_qty}`))))))))) : emptyState({ icon: 'checkCircle', title: 'Nada que reordenar por ahora' }));
  } catch (e) { replace(box, emptyState({ icon: 'alertCircle', title: 'No se pudieron calcular', text: friendlyError(e) })); }
}
