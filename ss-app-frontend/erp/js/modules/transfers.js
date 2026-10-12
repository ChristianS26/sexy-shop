// ═══════════════════════════════════════════════════════════════════════════
// Transferencias entre almacenes — DRAFT → IN_TRANSIT → RECEIVED | CANCELLED
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, badge, debounce } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openModal, openDrawer, confirm, toast } from '../ui/overlay.js';
import { field, setLoading, spinner, emptyState } from '../ui/widgets.js';

export const routes = ['/transfers', '/transfers/:id'];
export const title = 'Transferencias';
export const crumb = 'Inventario';
export const perms = ['inventory.read'];

export async function render(root, ctx) {
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Transferencias'), h('p.page-head__sub', 'Al enviar, sale del origen; al recibir, entra al destino. Las diferencias se registran como faltantes.')), h('div.page-head__actions', me.can('inventory.transfer') ? h('button.btn.btn--primary', { onclick: () => openTransferForm(() => table.reload()) }, icon('plus'), 'Nueva transferencia') : null)));
  const box = h('div'); root.append(box);
  const table = new DataTable({ id: 'transfers', endpoint: '/inventory/transfers', defaultSort: '-created_at', searchPlaceholder: 'Referencia…', emptyTitle: 'Sin transferencias', emptyIcon: 'shuffle',
    filters: [{ key: 'status', label: 'Estado', type: 'select', options: [['DRAFT', 'Borrador'], ['IN_TRANSIT', 'En tránsito'], ['RECEIVED', 'Recibida'], ['CANCELLED', 'Cancelada']].map(([value, label]) => ({ value, label })) }],
    columns: [
      { key: 'reference', label: 'Referencia', render: r => h('div', h('div.cell-main.mono', r.reference), h('div.cell-sub', fmt.datetime(r.created_at))) },
      { key: 'from', label: 'Origen → Destino', sortable: false, render: r => `${r.from_warehouse?.name} → ${r.to_warehouse?.name}` },
      { key: 'items', label: 'Partidas', sortable: false, num: true, render: r => `${(r.inventory_transfer_items || []).length} · ${fmt.int((r.inventory_transfer_items || []).reduce((a, i) => a + i.quantity, 0))} uds` },
      { key: 'status', label: 'Estado', render: r => badge('transfer', r.status) },
      { key: 'notes', label: 'Notas', sortable: false, hideSm: true, render: r => r.notes || '—' },
    ], onRow: (r) => openDetail(r.id, () => table.reload()) }).mount(box);
  if (ctx.params.id) openDetail(ctx.params.id, () => table.reload());
}

async function openDetail(id, onDone) {
  const box = h('div', spinner());
  const d = openDrawer({ title: 'Transferencia', size: 'lg', body: box });
  try {
    const t = await api.get(`/inventory/transfers/${id}`);
    d.setTitle(t.reference);
    const items = t.inventory_transfer_items || [];
    const canReceive = t.status === 'IN_TRANSIT' && me.can('inventory.transfer');
    const recv = {};
    replace(box, h('div.row.gap-2.mb-4', badge('transfer', t.status), h('span.text-sm.text-2', `${t.from_warehouse?.name} → ${t.to_warehouse?.name}`)),
      t.notes ? h('p.text-sm.mb-4', t.notes) : null,
      h('div.card', h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto'), h('th.num', 'Enviado'), h('th.num', canReceive ? 'Recibido' : 'Recibido'))), h('tbody', items.map(i => h('tr', h('td', i.products?.name, i.product_variants?.name ? ` · ${i.product_variants.name}` : ''), h('td.num', i.quantity), h('td.num', canReceive ? (recv[i.id] = h('input.input.input--sm', { type: 'number', min: 0, max: i.quantity, value: i.quantity, style: { width: '80px' } })) : (i.received_quantity ?? '—')))))))),
      h('div.timeline.mt-4', t.sent_at ? h('div.timeline__item', h('div.timeline__dot'), h('div', h('div.timeline__title', 'Enviada'), h('div.timeline__meta', fmt.datetime(t.sent_at)))) : null, t.received_at ? h('div.timeline__item', h('div.timeline__dot'), h('div', h('div.timeline__title', 'Recibida'), h('div.timeline__meta', fmt.datetime(t.received_at)))) : null, t.cancelled_at ? h('div.timeline__item', h('div.timeline__dot'), h('div', h('div.timeline__title', 'Cancelada'), h('div.timeline__meta', fmt.datetime(t.cancelled_at)))) : null));
    const foot = d.el.querySelector('.drawer__foot') || d.el.appendChild(h('div.drawer__foot'));
    if (t.status === 'DRAFT' && me.can('inventory.transfer')) foot.append(h('button.btn.btn--primary', { onclick: async (e) => { setLoading(e.currentTarget, true); try { await api.post(`/inventory/transfers/${id}/send`); toast('Transferencia enviada'); d.close(); onDone?.(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.currentTarget, false); } } }, icon('send'), 'Enviar (descontar origen)'));
    if (canReceive) foot.append(h('button.btn.btn--primary', { onclick: async (e) => { setLoading(e.currentTarget, true); try { await api.post(`/inventory/transfers/${id}/receive`, { items: items.map(i => ({ item_id: i.id, received_quantity: Number(recv[i.id].value) })) }); toast('Transferencia recibida'); d.close(); onDone?.(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.currentTarget, false); } } }, icon('check'), 'Confirmar recepción'));
    if (t.status !== 'RECEIVED' && t.status !== 'CANCELLED' && me.can('inventory.transfer')) foot.prepend(h('button.btn.btn--danger-soft', { onclick: async () => { const r = await confirm({ title: 'Cancelar transferencia', text: t.status === 'IN_TRANSIT' ? 'La mercancía regresará al almacén origen.' : '', confirmText: 'Cancelar transferencia', danger: true, input: { label: 'Motivo', required: true } }); if (!r) return; try { await api.post(`/inventory/transfers/${id}/cancel`, { reason: r }); toast('Transferencia cancelada'); d.close(); onDone?.(); } catch (err) { toast.error(friendlyError(err)); } } }, 'Cancelar'));
  } catch (e) { replace(box, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar', text: friendlyError(e) })); }
}

function openTransferForm(onDone) {
  const whs = me.warehouses;
  const from = field({ label: 'Almacén origen', name: 'from', type: 'select', options: whs, value: whs[0]?.id });
  const to = field({ label: 'Almacén destino', name: 'to', type: 'select', options: whs, value: whs[1]?.id });
  const notes = field({ label: 'Notas', name: 'notes', type: 'textarea', rows: 2 });
  const items = [];
  const search = h('input.input', { placeholder: 'Agregar producto…', autocomplete: 'off' });
  const results = h('div.menu.menu--left', { hidden: true, style: { position: 'static', marginTop: '4px' } });
  const list = h('div');
  const renderList = () => replace(list, items.length ? h('table.table.table--compact', h('tbody', items.map((it, i) => h('tr', h('td', it.product.name, it.variant ? ` · ${it.variant.name}` : ''), h('td.num', h('input.input.input--sm', { type: 'number', min: 1, value: it.quantity, style: { width: '80px' }, oninput: e => { it.quantity = Number(e.target.value) || 0; } })), h('td.actions', h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', onclick: () => { items.splice(i, 1); renderList(); } }, icon('x'))))))) : h('p.text-sm.text-3', 'Agrega productos a transferir.'));
  search.addEventListener('input', debounce(async () => {
    const q = search.value.trim(); if (q.length < 2) { results.hidden = true; return; }
    const r = await api.get('/products', { q, size: 8 });
    replace(results, r.data.map(p => h('button.menu__item', { type: 'button', onclick: async () => { if (p.has_variants) { const full = await api.get(`/products/${p.id}`); (full.variants || []).forEach(v => items.push({ product: p, variant: v, quantity: 0 })); } else items.push({ product: p, variant: null, quantity: 1 }); results.hidden = true; search.value = ''; renderList(); } }, h('div', h('div', p.name), h('div.text-xs.text-3', `${p.sku || ''} · stock ${p.stock}`)))));
    results.hidden = false;
  }, 250));
  renderList();
  openModal({ title: 'Nueva transferencia', size: 'md', body: h('div.stack', h('div.form-grid', from, to), h('div', h('div.search', icon('search'), search), results), list, notes), footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--secondary', { onclick: (e) => save(e, false, m) }, 'Guardar borrador'), h('button.btn.btn--primary', { onclick: (e) => save(e, true, m) }, icon('send'), 'Guardar y enviar')] });
  async function save(e, send, m) {
    const valid = items.filter(i => i.quantity > 0);
    if (from.input.value === to.input.value) { toast.warn('Origen y destino deben ser distintos.'); return; }
    if (!valid.length) { toast.warn('Agrega productos con cantidad.'); return; }
    setLoading(e.currentTarget, true);
    try { await api.post('/inventory/transfers', { from_warehouse_id: from.input.value, to_warehouse_id: to.input.value, notes: notes.input.value || null, send, items: valid.map(i => ({ product_id: i.product.id, variant_id: i.variant?.id || null, quantity: i.quantity })) }); toast(send ? 'Transferencia enviada' : 'Borrador guardado'); m.close(); onDone?.(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.currentTarget, false); }
  }
}
