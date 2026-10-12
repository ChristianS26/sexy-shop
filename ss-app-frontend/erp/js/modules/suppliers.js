// ═══════════════════════════════════════════════════════════════════════════
// Proveedores — directorio, ficha con productos y órdenes
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, badge } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openDrawer, confirm, toast, dropdown } from '../ui/overlay.js';
import { field, formData, showErrors, setLoading, spinner, emptyState } from '../ui/widgets.js';

export const routes = ['/suppliers', '/suppliers/:id'];
export const title = 'Proveedores';
export const crumb = 'Compras';
export const perms = ['suppliers.manage', 'purchases.read', 'products.read'];

export async function render(root, ctx) {
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Proveedores'), h('p.page-head__sub', 'Quién te surte, en cuánto tiempo y qué le has comprado.')), h('div.page-head__actions', me.can('suppliers.manage') ? h('button.btn.btn--primary', { onclick: () => openSupplierForm(null, () => table.reload()) }, icon('plus'), 'Nuevo proveedor') : null)));
  const box = h('div'); root.append(box);
  const table = new DataTable({ id: 'suppliers', endpoint: '/suppliers', defaultSort: 'name', searchPlaceholder: 'Nombre, contacto, correo…', emptyTitle: 'Sin proveedores', emptyIcon: 'truck', emptyAction: me.can('suppliers.manage') ? { label: 'Agregar proveedor', onClick: () => openSupplierForm(null, () => table.reload()) } : null,
    filters: [{ key: 'status', label: 'Estado', type: 'select', options: [{ value: 'ACTIVE', label: 'Activo' }, { value: 'INACTIVE', label: 'Inactivo' }] }],
    columns: [
      { key: 'name', label: 'Proveedor', render: r => h('div', h('div.cell-main', r.name), h('div.cell-sub', [r.code, r.rfc].filter(Boolean).join(' · '))) },
      { key: 'contact_name', label: 'Contacto', sortable: false, render: r => h('div', h('div', r.contact_name || '—'), h('div.cell-sub', [r.phone, r.email].filter(Boolean).join(' · '))) },
      { key: 'city', label: 'Ciudad', hideSm: true, render: r => [r.city, r.state].filter(Boolean).join(', ') || '—' },
      { key: 'lead_time_days', label: 'Entrega', sortable: false, hideSm: true, render: r => r.lead_time_days ? `${r.lead_time_days} días` : '—' },
      { key: 'payment_terms', label: 'Condiciones', sortable: false, hideSm: true, render: r => r.payment_terms || '—' },
      { key: 'status', label: 'Estado', render: r => badge('generic', r.status) },
      { key: '_actions', label: '', render: r => me.can('suppliers.manage') ? dropdown(h('button.btn.btn--ghost.btn--icon.btn--sm', { 'aria-label': 'Acciones' }, icon('more')), [{ label: 'Editar', icon: 'edit', onClick: () => openSupplierForm(r, () => table.reload()) }, { label: 'Nueva orden de compra', icon: 'clipboard', onClick: () => location.hash = `#/purchases?new=1&supplier=${r.id}` }, { sep: true }, { label: 'Eliminar', icon: 'trash', danger: true, onClick: async () => { if (await confirm({ title: `Eliminar ${r.name}`, text: 'Se desactiva y oculta; las compras históricas se conservan.', confirmText: 'Eliminar', danger: true })) { try { await api.del(`/suppliers/${r.id}`); toast('Proveedor eliminado'); table.reload(); } catch (e) { toast.error(friendlyError(e)); } } } }]) : null },
    ], onRow: (r) => openSupplier(r.id, () => table.reload()) }).mount(box);
  if (ctx.params.id) openSupplier(ctx.params.id, () => table.reload());
}

async function openSupplier(id, onDone) {
  const box = h('div', spinner());
  const d = openDrawer({ title: 'Proveedor', size: 'lg', body: box, footer: (ctx) => [me.can('suppliers.manage') ? h('button.btn.btn--secondary', { onclick: async () => { const s = await api.get(`/suppliers/${id}`); ctx.close(); openSupplierForm(s, onDone); } }, icon('edit'), 'Editar') : null, me.can('purchases.create') ? h('a.btn.btn--primary', { href: `#/purchases?new=1&supplier=${id}` }, icon('clipboard'), 'Orden de compra') : null] });
  try {
    const s = await api.get(`/suppliers/${id}`);
    d.setTitle(s.name);
    replace(box, h('div.row.gap-2.mb-4', badge('generic', s.status), h('span.text-sm.text-2', [s.contact_name, s.phone, s.email].filter(Boolean).join(' · '))),
      h('div.grid.grid--3', { style: { gap: '10px' } }, mini('RFC', s.rfc || '—'), mini('Entrega', s.lead_time_days ? `${s.lead_time_days} días` : '—'), mini('Condiciones', s.payment_terms || '—')),
      s.notes ? h('p.text-sm.mt-4', s.notes) : null,
      h('div.mt-4', h('div.eyebrow.mb-2', `Productos (${(s.products || []).length})`), (s.products || []).length ? h('div.card', h('div.table-wrap', h('table.table.table--compact', h('tbody', s.products.map(p => h('tr', h('td', p.name), h('td.text-3', p.sku), h('td.num', fmt.money(p.price)), h('td.num', `${p.stock} uds`))))))) : h('p.text-sm.text-3', 'Sin productos asignados.')),
      h('div.mt-4', h('div.eyebrow.mb-2', 'Órdenes de compra recientes'), (s.purchase_orders || []).length ? h('div.card', h('div.table-wrap', h('table.table.table--compact', h('tbody', s.purchase_orders.map(po => h('tr.clickable', { onclick: () => location.hash = `#/purchases/${po.id}` }, h('td', po.folio), h('td', fmt.date(po.created_at)), h('td', badge('purchase', po.status)), h('td.num', fmt.money(po.total)))))))) : h('p.text-sm.text-3', 'Sin órdenes.')));
  } catch (e) { replace(box, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar', text: friendlyError(e) })); }
  function mini(l, v) { return h('div.card--soft', { style: { padding: '12px', borderRadius: '12px' } }, h('div.text-xs.text-3', l), h('div.strong', v)); }
}

export function openSupplierForm(s, onDone) {
  const form = h('form', { novalidate: true });
  form.append(h('div.form-grid',
    field({ label: 'Nombre', name: 'name', required: true, value: s?.name, span: 2 }), field({ label: 'Código', name: 'code', value: s?.code }), field({ label: 'RFC', name: 'rfc', value: s?.rfc }),
    field({ label: 'Contacto', name: 'contact_name', value: s?.contact_name }), field({ label: 'Teléfono', name: 'phone', type: 'tel', value: s?.phone }), field({ label: 'Correo', name: 'email', type: 'email', value: s?.email }), field({ label: 'Sitio web', name: 'website', value: s?.website }),
    field({ label: 'Calle y número', name: 'street', value: s?.street }), field({ label: 'Colonia', name: 'neighborhood', value: s?.neighborhood }), field({ label: 'Ciudad', name: 'city', value: s?.city }), field({ label: 'Estado', name: 'state', value: s?.state }), field({ label: 'C.P.', name: 'zip', value: s?.zip }),
    field({ label: 'Condiciones de pago', name: 'payment_terms', value: s?.payment_terms, placeholder: 'Ej. contado, 15 días' }), field({ label: 'Tiempo de entrega (días)', name: 'lead_time_days', type: 'number', min: 0, value: s?.lead_time_days }),
    field({ label: 'Estado', name: 'status', type: 'select', options: [{ value: 'ACTIVE', label: 'Activo' }, { value: 'INACTIVE', label: 'Inactivo' }], value: s?.status || 'ACTIVE' }), field({ label: 'Notas', name: 'notes', type: 'textarea', rows: 3, value: s?.notes, span: 2 })));
  openDrawer({ title: s ? 'Editar proveedor' : 'Nuevo proveedor', body: form, footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { setLoading(e.currentTarget, true); try { const data = formData(form); if (s) await api.patch(`/suppliers/${s.id}`, data); else await api.post('/suppliers', data); toast('Proveedor guardado'); m.close(); onDone?.(); } catch (err) { if (!showErrors(form, err)) toast.error(friendlyError(err)); setLoading(e.currentTarget, false); } } }, 'Guardar')] });
}
