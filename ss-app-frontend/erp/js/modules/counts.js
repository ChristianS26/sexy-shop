// ═══════════════════════════════════════════════════════════════════════════
// Conteos físicos — foto del almacén, captura de contados, finalizar con ajustes
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, badge, debounce } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openModal, openDrawer, confirm, toast } from '../ui/overlay.js';
import { field, setLoading, spinner, emptyState } from '../ui/widgets.js';
import { loadCatalogRefs } from './products.js';

export const routes = ['/counts', '/counts/:id'];
export const title = 'Conteos físicos';
export const crumb = 'Inventario';
export const perms = ['inventory.read'];

export async function render(root, ctx) {
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Conteos físicos'), h('p.page-head__sub', 'Toma la foto del almacén, captura lo contado y al finalizar cada diferencia se vuelve un movimiento de inventario.')), h('div.page-head__actions', me.can('inventory.count') ? h('button.btn.btn--primary', { onclick: () => startCount(() => table.reload()) }, icon('plus'), 'Iniciar conteo') : null)));
  const box = h('div'); root.append(box);
  const table = new DataTable({ id: 'counts', endpoint: '/inventory/counts', defaultSort: '-created_at', search: false, emptyTitle: 'Sin conteos', emptyIcon: 'clipboard',
    filters: [{ key: 'status', label: 'Estado', type: 'select', options: [['OPEN', 'Abierto'], ['FINALIZED', 'Finalizado'], ['CANCELLED', 'Cancelado']].map(([value, label]) => ({ value, label })) }],
    columns: [{ key: 'reference', label: 'Referencia', render: r => h('div', h('div.cell-main.mono', r.reference), h('div.cell-sub', fmt.datetime(r.created_at))) }, { key: 'warehouse', label: 'Almacén', sortable: false, render: r => r.warehouses?.name }, { key: 'creator', label: 'Creado por', sortable: false, hideSm: true, render: r => fmt.name(r.creator) }, { key: 'status', label: 'Estado', render: r => badge('count', r.status) }, { key: 'finalized_at', label: 'Finalizado', hideSm: true, render: r => r.finalized_at ? fmt.datetime(r.finalized_at) : '—' }],
    onRow: (r) => openCount(r.id, () => table.reload()) }).mount(box);
  if (ctx.params.id) openCount(ctx.params.id, () => table.reload());
}

async function startCount(onDone) {
  const refs = await loadCatalogRefs();
  const wh = field({ label: 'Almacén', name: 'warehouse_id', type: 'select', options: me.warehouses, value: me.warehouses[0]?.id });
  const cat = field({ label: 'Limitar a una categoría (opcional)', name: 'category_id', type: 'select', options: refs.categories.map(c => ({ value: c.id, label: c.parent_id ? `— ${c.name}` : c.name })), placeholder: 'Todo el almacén' });
  const notes = field({ label: 'Notas', name: 'notes', type: 'textarea', rows: 2 });
  openModal({ title: 'Iniciar conteo físico', body: h('div.form-grid', wh, cat, h('div.span-2', notes)), footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { setLoading(e.currentTarget, true); try { const c = await api.post('/inventory/counts', { warehouse_id: wh.input.value, category_id: cat.input.value || null, notes: notes.input.value || null }); toast(`Conteo ${c.reference} iniciado`); m.close(); onDone?.(); openCount(c.id, onDone); } catch (err) { toast.error(friendlyError(err)); setLoading(e.currentTarget, false); } } }, 'Iniciar')] });
}

async function openCount(id, onDone) {
  const box = h('div', spinner());
  const d = openDrawer({ title: 'Conteo', size: 'xl', body: box });
  try {
    let c = await api.get(`/inventory/counts/${id}`);
    d.setTitle(`${c.reference} · ${c.warehouses?.name}`);
    const open = c.status === 'OPEN' && me.can('inventory.count');
    const pending = {};
    const filter = h('input.input', { placeholder: 'Filtrar por nombre o SKU…' });
    const onlyDiff = h('input', { type: 'checkbox' });
    const progress = h('div.row.gap-2.text-sm');
    const tbody = h('tbody');
    const renderRows = () => {
      const q = filter.value.trim().toLowerCase();
      replace(tbody, c.items.filter(i => (!q || (i.products?.name || '').toLowerCase().includes(q) || (i.products?.sku || '').toLowerCase().includes(q)) && (!onlyDiff.checked || (i.counted_qty != null && i.counted_qty !== i.expected_qty))).map(i => {
        const diff = i.counted_qty == null ? null : i.counted_qty - i.expected_qty;
        return h('tr', h('td', h('div.cell-main', i.products?.name, i.product_variants?.name ? ` · ${i.product_variants.name}` : ''), h('div.cell-sub', [i.products?.sku, i.products?.barcode].filter(Boolean).join(' · '))), h('td.num', i.expected_qty),
          h('td.num', open ? h('input.input.input--sm', { type: 'number', min: 0, value: i.counted_qty ?? '', placeholder: '—', style: { width: '90px' }, oninput: (e) => { pending[i.id] = e.target.value === '' ? null : Number(e.target.value); i.counted_qty = pending[i.id]; saveSoon(); updateProgress(); } }) : (i.counted_qty ?? '—')),
          h('td.num', diff == null ? '—' : h('b', { class: diff === 0 ? 'flat' : diff > 0 ? 'up' : 'down' }, `${diff > 0 ? '+' : ''}${diff}`)));
      }));
    };
    const updateProgress = () => { const counted = c.items.filter(i => i.counted_qty != null).length, diffs = c.items.filter(i => i.counted_qty != null && i.counted_qty !== i.expected_qty).length; replace(progress, h('span.badge', `${counted} / ${c.items.length} contados`), h('span.badge.badge--warning', `${diffs} con diferencia`)); };
    const saveSoon = debounce(async () => { const items = Object.entries(pending).map(([id, counted_qty]) => ({ id, counted_qty })); if (!items.length) return; Object.keys(pending).forEach(k => delete pending[k]); try { await api.patch(`/inventory/counts/${id}/items`, { items }); } catch (e) { toast.error(friendlyError(e)); } }, 600);
    filter.addEventListener('input', renderRows); onlyDiff.addEventListener('change', renderRows);
    replace(box, h('div.row.row--between.mb-4', h('div.row.gap-2', badge('count', c.status), progress), h('div.row.gap-2', h('div.search', icon('search'), filter), h('label.check', onlyDiff, 'Solo diferencias'))),
      c.notes ? h('p.text-sm.text-2.mb-4', c.notes) : null,
      h('div.card', h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto'), h('th.num', 'Sistema'), h('th.num', 'Contado'), h('th.num', 'Diferencia'))), tbody))),
      open ? h('p.text-xs.text-3.mt-2', 'Los contados se guardan automáticamente. Al finalizar, cada diferencia genera un movimiento INVENTORY_COUNT.') : null);
    renderRows(); updateProgress();
    const foot = d.el.appendChild(h('div.drawer__foot'));
    if (open) {
      foot.append(h('button.btn.btn--danger-soft', { onclick: async () => { if (await confirm({ title: 'Cancelar conteo', text: 'No se aplicará ningún ajuste.', confirmText: 'Cancelar conteo', danger: true })) { try { await api.post(`/inventory/counts/${id}/cancel`); toast('Conteo cancelado'); d.close(); onDone?.(); } catch (e) { toast.error(friendlyError(e)); } } } }, 'Cancelar conteo'),
        h('button.btn.btn--primary', { onclick: async (e) => { await saveSoon.flush?.(); const diffs = c.items.filter(i => i.counted_qty != null && i.counted_qty !== i.expected_qty).length; if (!(await confirm({ title: 'Finalizar conteo', text: `Se aplicarán ${diffs} ajustes de inventario con rastro. Los productos sin contar no cambian.`, confirmText: 'Finalizar y ajustar' }))) return; setLoading(e.currentTarget, true); try { const items = Object.entries(pending).map(([k, v]) => ({ id: k, counted_qty: v })); if (items.length) await api.patch(`/inventory/counts/${id}/items`, { items }); await api.post(`/inventory/counts/${id}/finalize`); toast('Conteo finalizado'); d.close(); onDone?.(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.currentTarget, false); } } }, icon('check'), 'Finalizar conteo'));
    }
  } catch (e) { replace(box, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar', text: friendlyError(e) })); }
}
