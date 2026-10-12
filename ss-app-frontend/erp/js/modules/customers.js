// ═══════════════════════════════════════════════════════════════════════════
// Clientes — directorio privado, Customer 360, direcciones y colonias
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, badge } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openModal, openDrawer, confirm, toast, dropdown } from '../ui/overlay.js';
import { field, formData, showErrors, setLoading, spinner, emptyState, sparkline } from '../ui/widgets.js';

export const routes = ['/customers', '/customers/:id'];
export const title = 'Clientes';
export const crumb = 'Operación';
export const perms = ['customers.read'];

export async function render(root, ctx) {
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Clientes'), h('p.page-head__sub', 'Información privada y mínima. La colonia se normaliza para el análisis geográfico. El modo discreto oculta nombres en pantalla.')),
    h('div.page-head__actions', me.can('customers.export') ? h('button.btn.btn--secondary', { onclick: () => api.download('/reports/customers_recurring', { format: 'xlsx' }).catch(e => toast.error(friendlyError(e))) }, icon('download'), 'Exportar') : null, me.can('customers.create') ? h('button.btn.btn--primary', { onclick: () => openCustomerForm(null, () => table.reload()) }, icon('plus'), 'Nuevo cliente') : null)));
  const box = h('div'); root.append(box);
  const neigh = await api.get('/neighborhoods').catch(() => []);
  const table = new DataTable({ id: 'customers', endpoint: '/customers', defaultSort: '-last_purchase_at', searchPlaceholder: 'Nombre, teléfono o correo…', emptyTitle: 'Sin clientes', emptyText: 'Registra clientes desde el POS o aquí para medir recompra y RFM.', emptyIcon: 'users', emptyAction: me.can('customers.create') ? { label: 'Agregar cliente', onClick: () => openCustomerForm(null, () => table.reload()) } : null,
    filters: [{ key: 'neighborhood', label: 'Colonia', type: 'select', options: neigh.map(n => ({ value: n.id, label: `${n.name} (${n.customers})` })) }, { key: 'source', label: 'Origen', type: 'select', options: [['POS', 'Tienda'], ['ONLINE', 'En línea'], ['IMPORT', 'Importado']].map(([value, label]) => ({ value, label })) }, { key: 'status', label: 'Estado', type: 'select', options: [{ value: 'ACTIVE', label: 'Activo' }, { value: 'INACTIVE', label: 'Inactivo' }] }],
    columns: [
      { key: 'first_name', label: 'Cliente', render: r => h('div.row.gap-2', { style: { flexWrap: 'nowrap' } }, h('div.avatar', fmt.initials(r)), h('div', h('div.cell-main', { 'data-private': '' }, fmt.name(r)), h('div.cell-sub', { 'data-private': '' }, [r.phone, r.email].filter(Boolean).join(' · ') || '—'))) },
      { key: 'neighborhood', label: 'Colonia', sortable: false, hideSm: true, render: r => r.neighborhood_name || h('span.text-3', '—') },
      { key: 'purchases_count', label: 'Compras', num: true },
      { key: 'total_spent', label: 'Gasto total', num: true, render: r => fmt.money(r.total_spent) },
      { key: 'avg', label: 'Ticket prom.', num: true, sortable: false, hideSm: true, render: r => r.purchases_count ? fmt.money(r.total_spent / r.purchases_count) : '—' },
      { key: 'last_purchase_at', label: 'Última compra', render: r => r.last_purchase_at ? fmt.relative(r.last_purchase_at) : h('span.text-3', 'Nunca') },
      { key: 'source', label: 'Origen', hideSm: true, hide: true, render: r => badge('channel', r.source === 'IMPORT' ? 'OTHER' : r.source) },
      { key: '_actions', label: '', render: r => dropdown(h('button.btn.btn--ghost.btn--icon.btn--sm', { 'aria-label': 'Acciones' }, icon('more')), [{ label: 'Ver expediente', icon: 'eye', onClick: () => openCustomer360(r.id, () => table.reload()) }, me.can('customers.update') ? { label: 'Editar', icon: 'edit', onClick: () => openCustomerForm(r, () => table.reload()) } : null, me.can('customers.delete') ? { sep: true } : null, me.can('customers.delete') ? { label: 'Eliminar', icon: 'trash', danger: true, onClick: async () => { if (await confirm({ title: `Eliminar a ${fmt.name(r)}`, text: 'Se anonimizan sus datos de contacto; el historial de ventas se conserva sin datos personales.', confirmText: 'Eliminar', danger: true })) { try { await api.del(`/customers/${r.id}`); toast('Cliente eliminado'); table.reload(); } catch (e) { toast.error(friendlyError(e)); } } } } : null]) },
    ], onRow: (r) => openCustomer360(r.id, () => table.reload()) }).mount(box);
  if (ctx.params.id) openCustomer360(ctx.params.id, () => table.reload());
}

export async function openCustomer360(id, onDone) {
  const box = h('div', spinner());
  const d = openDrawer({ title: 'Cliente', size: 'lg', body: box, footer: (ctx) => [me.can('customers.update') ? h('button.btn.btn--secondary', { onclick: () => { ctx.close(); api.get(`/customers/${id}`).then(x => openCustomerForm(x.customer, onDone)); } }, icon('edit'), 'Editar') : null, me.can('sales.create') ? h('a.btn.btn--primary', { href: '#/pos' }, icon('cart'), 'Vender') : null] });
  try {
    const x = await api.get(`/customers/${id}`);
    const c = x.customer, st = x.stats || {}, rfm = x.rfm || {};
    d.setTitle(fmt.name(c));
    replace(box,
      h('div.row.gap-4.mb-4', { style: { flexWrap: 'nowrap' } }, h('div.avatar.avatar--lg', fmt.initials(c)), h('div.flex-1', h('div.row.gap-2', badge('generic', c.status), badge('channel', c.source === 'IMPORT' ? 'OTHER' : c.source), c.accepts_marketing ? h('span.badge.badge--info', 'Acepta promociones') : null), h('div.text-sm.text-2.mt-2', { 'data-private': '' }, [c.phone, c.email, c.birthday ? `cumple ${fmt.dateShort(c.birthday)}` : null].filter(Boolean).join(' · ') || 'Sin datos de contacto'), h('div.text-xs.text-3', `Cliente desde ${fmt.date(c.created_at)}`))),
      h('div.grid.grid--4', { style: { gap: '10px' } }, mini('Compras', fmt.int(st.purchases)), mini('Ingresos', fmt.money(st.revenue)), mini('Ticket promedio', fmt.money(st.avg_ticket)), mini('Frecuencia', st.avg_days_between ? `cada ${st.avg_days_between} días` : '—')),
      h('div.grid.grid--3.mt-4', { style: { gap: '10px' } }, mini('Última compra', st.last_purchase_at ? fmt.relative(st.last_purchase_at) : 'Nunca'), mini('Devoluciones', fmt.int(st.returns)), mini('RFM', `R ${rfm.recency_days ?? '—'} d · F ${rfm.frequency ?? 0} · M ${fmt.money(rfm.monetary || 0, true)}`)),
      h('div.grid.grid--2.mt-4', { style: { gap: '12px' } },
        h('div.card.card--soft', { style: { padding: '14px' } }, h('div.eyebrow.mb-2', 'Productos favoritos'), (x.favorite_products || []).length ? x.favorite_products.map(p => h('div.stat-row', h('span', p.name), h('b', `${p.units} uds`))) : h('p.text-sm.text-3', 'Sin compras.')),
        h('div.card.card--soft', { style: { padding: '14px' } }, h('div.eyebrow.mb-2', 'Categorías favoritas'), (x.favorite_categories || []).length ? x.favorite_categories.map(p => h('div.stat-row', h('span', p.name || 'Sin categoría'), h('b', fmt.money(p.revenue)))) : h('p.text-sm.text-3', '—'))),
      h('div.mt-4', h('div.row.row--between.mb-2', h('div.eyebrow', 'Direcciones'), me.can('customers.update') ? h('button.btn.btn--ghost.btn--sm', { onclick: () => openAddressForm(c.id, null, () => { d.close(); openCustomer360(id, onDone); }) }, icon('plus'), 'Agregar') : null),
        (x.addresses || []).length ? x.addresses.map(a => h('div.alert.alert--info', { style: { marginBottom: '8px', background: 'var(--color-bg-muted)', color: 'var(--color-text)' } }, icon('pin'), h('div.flex-1', h('div.alert__title', `${a.label || 'Dirección'}${a.is_default ? ' · principal' : ''}`), h('div.alert__text', { 'data-private': '' }, [a.street && `${a.street} ${a.ext_number || ''}${a.int_number ? ' int. ' + a.int_number : ''}`, a.neighborhood_name || a.neighborhood_text, a.zip, a.city].filter(Boolean).join(', ')), a.references_text ? h('div.text-xs.text-3', a.references_text) : null), me.can('customers.update') ? h('button.btn.btn--ghost.btn--sm.btn--icon', { 'aria-label': 'Editar', onclick: () => openAddressForm(c.id, a, () => { d.close(); openCustomer360(id, onDone); }) }, icon('edit')) : null)) : h('p.text-sm.text-3', 'Sin dirección. Agrega la colonia para el análisis geográfico.')),
      c.notes ? h('div.mt-4', h('div.eyebrow.mb-2', 'Notas'), h('p.text-sm', c.notes)) : null,
      h('div.mt-4', h('div.eyebrow.mb-2', 'Historial de compras'), (x.recent_sales || []).length ? h('div.card', h('div.table-wrap', h('table.table.table--compact', h('tbody', x.recent_sales.map(s => h('tr.clickable', { onclick: () => location.hash = `#/sales/${s.id}` }, h('td', s.folio), h('td', fmt.date(s.sold_at)), h('td', badge('channel', s.channel)), h('td', badge('sale', s.status)), h('td.num', `${s.items_count} arts.`), h('td.num.strong', fmt.money(s.total)))))))) : h('p.text-sm.text-3', 'Sin compras todavía.')));
  } catch (e) { replace(box, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar', text: friendlyError(e) })); }
  function mini(l, v) { return h('div.card--soft', { style: { padding: '12px', borderRadius: '12px' } }, h('div.text-xs.text-3', l), h('div.strong', { style: { fontSize: '1.05rem' } }, v)); }
}

export function openCustomerForm(c, onDone) {
  const form = h('form', { novalidate: true });
  form.append(h('div.form-grid',
    field({ label: 'Nombre', name: 'first_name', required: true, value: c?.first_name }), field({ label: 'Apellidos', name: 'last_name', value: c?.last_name }),
    field({ label: 'Teléfono / WhatsApp', name: 'phone', type: 'tel', value: c?.phone, hint: 'Evita duplicados: se valida que sea único.' }), field({ label: 'Correo', name: 'email', type: 'email', value: c?.email }),
    field({ label: 'Cumpleaños', name: 'birthday', type: 'date', value: c?.birthday }), field({ label: 'Origen', name: 'source', type: 'select', options: [['POS', 'Tienda'], ['ONLINE', 'En línea'], ['OTHER', 'Otro']].map(([value, label]) => ({ value, label })), value: c?.source || 'POS' }),
    field({ label: 'Acepta recibir promociones', name: 'accepts_marketing', type: 'switch', value: c?.accepts_marketing, span: 2 }),
    c ? field({ label: 'Estado', name: 'status', type: 'select', options: [{ value: 'ACTIVE', label: 'Activo' }, { value: 'INACTIVE', label: 'Inactivo' }], value: c.status }) : null,
    field({ label: 'Notas (sin información sensible)', name: 'notes', type: 'textarea', rows: 2, value: c?.notes, span: 2 })),
    c ? null : h('div.form-section', h('div.form-section__title', icon('pin'), 'Dirección (opcional)'), h('div.form-grid', field({ label: 'Calle', name: 'a_street' }), field({ label: 'Número', name: 'a_ext_number' }), field({ label: 'Colonia', name: 'a_neighborhood_text', hint: 'Se normaliza automáticamente para el análisis geográfico.' }), field({ label: 'C.P.', name: 'a_zip' }), field({ label: 'Ciudad', name: 'a_city', value: 'Guaymas' }), field({ label: 'Estado', name: 'a_state', value: 'Sonora' }))));
  openDrawer({ title: c ? 'Editar cliente' : 'Nuevo cliente', body: form, footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
    setLoading(e.target.closest('button'), true);
    try {
      const data = formData(form); const address = {}; Object.keys(data).forEach(k => { if (k.startsWith('a_')) { if (data[k]) address[k.slice(2)] = data[k]; delete data[k]; } });
      const saved = c ? await api.patch(`/customers/${c.id}`, data) : await api.post('/customers', { ...data, address: address.neighborhood_text || address.street ? address : undefined });
      toast('Cliente guardado'); m.close(); onDone?.(saved);
    } catch (err) { if (!showErrors(form, err)) toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); }
  } }, 'Guardar')] });
  setTimeout(() => form.querySelector('input')?.focus(), 50);
}

function openAddressForm(customerId, a, onDone) {
  const form = h('form', { novalidate: true });
  form.append(h('div.form-grid', field({ label: 'Etiqueta', name: 'label', value: a?.label || 'Casa' }), field({ label: 'Principal', name: 'is_default', type: 'switch', value: a ? a.is_default : true }), field({ label: 'Calle', name: 'street', value: a?.street }), field({ label: 'Número', name: 'ext_number', value: a?.ext_number }), field({ label: 'Interior', name: 'int_number', value: a?.int_number }), field({ label: 'Colonia', name: 'neighborhood_text', value: a?.neighborhood_text || a?.neighborhood_name, required: true }), field({ label: 'C.P.', name: 'zip', value: a?.zip }), field({ label: 'Ciudad', name: 'city', value: a?.city || 'Guaymas' }), field({ label: 'Estado', name: 'state', value: a?.state || 'Sonora' }), field({ label: 'Referencias', name: 'references_text', value: a?.references_text, span: 2 })));
  openModal({ title: a ? 'Editar dirección' : 'Nueva dirección', body: form, footer: (m) => [a ? h('button.btn.btn--danger-soft', { onclick: async () => { if (await confirm({ title: 'Eliminar dirección', confirmText: 'Eliminar', danger: true })) { await api.del(`/customers/addresses/${a.id}`); m.close(); onDone?.(); } } }, 'Eliminar') : null, h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { setLoading(e.target.closest('button'), true); try { const data = formData(form); if (a) await api.patch(`/customers/addresses/${a.id}`, data); else await api.post(`/customers/${customerId}/addresses`, data); toast('Dirección guardada'); m.close(); onDone?.(); } catch (err) { if (!showErrors(form, err)) toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); } } }, 'Guardar')] });
}
