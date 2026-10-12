// ═══════════════════════════════════════════════════════════════════════════
// Existencias — vista por almacén/variante con semáforo, resumen y ajustes
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, debounce, badge } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openModal, toast } from '../ui/overlay.js';
import { field, setLoading, stockBadge, kpi, skeletonCards, emptyState } from '../ui/widgets.js';
import { openProductQuickView, loadCatalogRefs } from './products.js';

export const route = '/stock';
export const title = 'Existencias';
export const crumb = 'Inventario';
export const perms = ['inventory.read', 'products.read'];

export async function render(root, ctx) {
  const refs = await loadCatalogRefs();
  const summary = h('div.grid.grid--kpi', skeletonCards(4));
  const head = h('div.page-head', h('div', h('h1.page-head__title', 'Existencias'), h('p.page-head__sub', 'Una fila por producto, variante y almacén. 🔴 agotado · 🟠 crítico · 🟡 bajo · 🟢 saludable · 🔵 exceso.')),
    h('div.page-head__actions', me.can('inventory.adjust') ? h('button.btn.btn--primary', { onclick: () => openAdjustment({}, () => { table.reload(); loadSummary(); }) }, icon('layers'), 'Ajuste de inventario') : null, me.can('inventory.transfer') && me.warehouses.length > 1 ? h('a.btn.btn--secondary', { href: '#/transfers' }, icon('shuffle'), 'Transferir') : null));
  const box = h('div');
  root.append(head, summary, box);
  const canCost = me.can('products.cost.read');
  const table = new DataTable({
    id: 'stock', endpoint: '/inventory/stock', defaultSort: 'product_name', exportKey: 'stock_current', searchPlaceholder: 'Producto, SKU o código…', emptyTitle: 'Sin existencias registradas', emptyText: 'Recibe una compra o registra un ajuste de inventario inicial.', emptyIcon: 'layers',
    filters: [
      { key: 'warehouse', label: 'Almacén', type: 'select', options: me.warehouses.map(w => ({ value: w.id, label: w.name })) },
      { key: 'category', label: 'Categoría', type: 'select', options: refs.categories.map(c => ({ value: c.id, label: c.parent_id ? `— ${c.name}` : c.name })) },
      { key: 'status', label: 'Estado', type: 'select', options: [['OUT', '🔴 Agotado'], ['CRITICAL', '🟠 Crítico'], ['LOW', '🟡 Bajo'], ['HEALTHY', '🟢 Saludable'], ['EXCESS', '🔵 Exceso']].map(([value, label]) => ({ value, label })) },
    ],
    columns: [
      { key: 'product_name', label: 'Producto', render: r => h('div', h('div.cell-main', r.product_name, r.variant_name ? h('span.badge', { style: { marginLeft: '6px' } }, r.variant_name) : null), h('div.cell-sub', [r.effective_sku, r.category_name].filter(Boolean).join(' · '))) },
      { key: 'warehouse_name', label: 'Almacén', hideSm: true },
      { key: 'quantity', label: 'Existencia', num: true, render: r => h('b', { style: { fontSize: '1.05rem' } }, fmt.int(r.quantity)) },
      { key: 'min_stock', label: 'Mín / Máx', num: true, sortable: false, hideSm: true, render: r => `${r.min_stock} / ${r.max_stock ?? '—'}` },
      { key: 'stock_status', label: 'Estado', render: r => stockBadge(r.stock_status) },
      ...(canCost ? [{ key: 'unit_cost', label: 'Costo', num: true, hideSm: true, render: r => fmt.money(r.unit_cost) }, { key: 'stock_value', label: 'Valor', num: true, render: r => fmt.money(r.stock_value) }] : []),
      { key: 'updated_at', label: 'Actualizado', hideSm: true, render: r => fmt.relative(r.updated_at) },
      { key: '_actions', label: '', render: r => me.can('inventory.adjust') ? h('button.btn.btn--ghost.btn--sm', { onclick: () => openAdjustment({ product: { id: r.product_id, name: r.product_name, has_variants: !!r.variant_id }, variant: r.variant_id ? { id: r.variant_id, name: r.variant_name } : null, warehouse: r.warehouse_id }, () => { table.reload(); loadSummary(); }) }, 'Ajustar') : null },
    ],
    onRow: (r) => openProductQuickView(r.product_id),
  }).mount(box);
  async function loadSummary() {
    try {
      const s = await api.get('/inventory/summary');
      const st = s.by_status || {};
      replace(summary,
        kpi({ label: 'Unidades en inventario', value: s.units, format: fmt.int, icon: 'layers', foot: `${fmt.int(s.items)} filas producto/almacén` }),
        canCost ? kpi({ label: 'Valor a costo', value: s.value, format: fmt.money, icon: 'dollar', foot: (s.by_warehouse || []).map(w => `${w.name}: ${fmt.money(w.value, true)}`).join(' · ') }) : kpi({ label: 'Almacenes', value: (s.by_warehouse || []).length, format: fmt.int, icon: 'store' }),
        kpi({ label: 'Agotados + críticos', value: (st.OUT?.items || 0) + (st.CRITICAL?.items || 0), format: fmt.int, icon: 'alertTriangle', foot: `${st.OUT?.items || 0} agotados · ${st.CRITICAL?.items || 0} críticos` }),
        kpi({ label: 'Stock bajo', value: st.LOW?.items || 0, format: fmt.int, icon: 'alertCircle', foot: `${st.HEALTHY?.items || 0} saludables · ${st.EXCESS?.items || 0} en exceso` }));
    } catch (e) { replace(summary, emptyState({ icon: 'alertCircle', title: 'Sin resumen', text: friendlyError(e) })); }
  }
  loadSummary();
}

/** Ajuste de inventario: entrada, salida, merma, pérdida o inventario inicial. Genera movimientos INV- */
export async function openAdjustment({ product = null, variant = null, warehouse = null } = {}, onDone) {
  const items = product ? [{ product, variant, quantity: 1 }] : [];
  const whSel = field({ label: 'Almacén', name: 'warehouse_id', type: 'select', required: true, options: me.warehouses, value: warehouse || me.warehousesOf(me.user?.default_branch_id)[0]?.id || me.warehouses[0]?.id });
  const type = field({ label: 'Tipo de ajuste', name: 'type', type: 'select', required: true, options: [['ADJUSTMENT_IN', 'Entrada por ajuste (+)'], ['ADJUSTMENT_OUT', 'Salida por ajuste (−)'], ['DAMAGE', 'Merma / producto dañado (−)'], ['LOSS', 'Pérdida / robo (−)'], ['INITIAL_STOCK', 'Inventario inicial (+)']].map(([value, label]) => ({ value, label })) });
  const reason = field({ label: 'Motivo (obligatorio, queda auditado)', name: 'reason', required: true, placeholder: 'Ej. conteo de estante, empaque roto…' });
  const notes = field({ label: 'Notas', name: 'notes', type: 'textarea', rows: 2 });
  const search = h('input.input', { placeholder: 'Agregar producto: nombre, SKU o código…', autocomplete: 'off' });
  const results = h('div.menu.menu--left', { hidden: true, style: { position: 'static', marginTop: '4px' } });
  const list = h('div');
  const renderList = () => replace(list, items.length ? h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto'), h('th', 'Cantidad'), me.can('products.cost.read') ? h('th', 'Costo unit.') : null, h('th', ''))), h('tbody', items.map((it, i) => h('tr', h('td', h('div.cell-main', it.product.name), it.variant ? h('div.cell-sub', it.variant.name) : null),
    h('td', h('input.input.input--sm', { type: 'number', min: 1, value: it.quantity, style: { width: '90px' }, oninput: (e) => { it.quantity = Number(e.target.value) || 0; } })),
    me.can('products.cost.read') ? h('td', h('input.input.input--sm', { type: 'number', min: 0, step: '0.01', placeholder: 'opcional', style: { width: '110px' }, oninput: (e) => { it.unit_cost = e.target.value === '' ? null : Number(e.target.value); } })) : null,
    h('td.actions', h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', 'aria-label': 'Quitar', onclick: () => { items.splice(i, 1); renderList(); } }, icon('x')))))))) : h('p.text-sm.text-3', 'Agrega al menos un producto.'));
  const doSearch = debounce(async () => {
    const q = search.value.trim(); if (q.length < 2) { results.hidden = true; return; }
    const r = await api.get('/products', { q, size: 8, active: 'false' });
    replace(results, r.data.length ? r.data.map(p => h('button.menu__item', { type: 'button', onclick: async () => {
      if (p.has_variants) { const full = await api.get(`/products/${p.id}`); const vs = full.variants || []; vs.forEach(v => items.push({ product: p, variant: v, quantity: 0 })); }
      else items.push({ product: p, variant: null, quantity: 1 });
      results.hidden = true; search.value = ''; renderList();
    } }, h('div.thumb', { style: { width: '28px', height: '28px' } }, p.image_url ? h('img', { src: p.image_url, alt: '' }) : icon('box')), h('div', h('div', p.name), h('div.text-xs.text-3', `${p.sku || ''} · stock ${p.stock}`)))) : h('div.menu__label', 'Sin resultados'));
    results.hidden = false;
  }, 250);
  search.addEventListener('input', doSearch);
  renderList();
  openModal({ title: 'Ajuste de inventario', size: 'md', sub: 'Cada partida genera un movimiento con referencia única y queda en auditoría.', body: h('div.stack', h('div.form-grid', whSel, type), reason, h('div', h('div.search', icon('search'), search), results), list, notes),
    footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
      const valid = items.filter(it => it.quantity > 0);
      if (!valid.length) { toast.warn('Agrega productos con cantidad mayor a 0.'); return; }
      if (!reason.input.value.trim()) { toast.warn('Indica el motivo.'); reason.input.focus(); return; }
      setLoading(e.target.closest('button'), true);
      try {
        const res = await api.post('/inventory/adjustments', { warehouse_id: whSel.input.value, type: type.input.value, reason: reason.input.value, notes: notes.input.value || null, items: valid.map(it => ({ product_id: it.product.id, variant_id: it.variant?.id || null, quantity: it.quantity, unit_cost: it.unit_cost ?? null })) });
        toast(`Ajuste ${res.reference} aplicado`); m.close(); onDone?.();
      } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); }
    } }, icon('check'), 'Aplicar ajuste')] });
}
