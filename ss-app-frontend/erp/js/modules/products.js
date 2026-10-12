// ═══════════════════════════════════════════════════════════════════════════
// Productos — catálogo, formulario (variantes, imágenes), quick view
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, badge, $, $$ } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openModal, openDrawer, confirm, toast, dropdown } from '../ui/overlay.js';
import { field, formData, showErrors, setLoading, spinner, emptyState, stockBadge, sparkline, delta, tabs } from '../ui/widgets.js';

export const routes = ['/products', '/products/:id'];
export const title = 'Productos';
export const crumb = 'Inventario';
export const perms = ['products.read'];

let cache = { categories: null, brands: null, suppliers: null, taxRates: null };
export async function loadCatalogRefs(force = false) {
  if (!force && cache.categories) return cache;
  const [c, b, s, t] = await Promise.all([api.get('/categories'), api.get('/brands'), api.get('/suppliers', { size: 200 }), api.get('/tax-rates').catch(() => [])]);
  cache = { categories: c.flat, categoryTree: c.tree, brands: b, suppliers: s.data, taxRates: t };
  return cache;
}
const categoryOptions = (flat) => { const byP = {}; flat.forEach(c => (byP[c.parent_id || 'root'] ||= []).push(c)); const out = []; (byP.root || []).forEach(p => { out.push({ value: p.id, label: p.name }); (byP[p.id] || []).forEach(k => out.push({ value: k.id, label: `— ${k.name}` })); }); return out; };

export async function render(root, ctx) {
  const refs = await loadCatalogRefs();
  const head = h('div.page-head', h('div', h('h1.page-head__title', 'Productos'), h('p.page-head__sub', 'Catálogo con SKU, código de barras, costo, precio, mínimos y variantes. El stock se mueve solo con movimientos.')),
    h('div.page-head__actions', me.can('products.import') ? h('a.btn.btn--secondary', { href: '#/settings/import' }, icon('upload'), 'Importar') : null, me.can('products.create') ? h('button.btn.btn--primary', { onclick: () => openProductForm(null, () => table.reload()) }, icon('plus'), 'Nuevo producto') : null));
  const box = h('div'); root.append(head, box);
  const canCost = me.can('products.cost.read');
  const table = new DataTable({
    id: 'products', endpoint: '/products', defaultSort: 'name', exportKey: 'stock_current', searchPlaceholder: 'Nombre, SKU o código de barras…', selectable: me.can('products.update'), emptyTitle: 'No tienes productos todavía', emptyText: 'Agrega tu primer producto o importa tu catálogo.', emptyAction: me.can('products.create') ? { label: 'Agregar producto', onClick: () => openProductForm(null, () => table.reload()) } : null, emptyIcon: 'tag',
    filters: [
      { key: 'category', label: 'Categoría', type: 'select', options: categoryOptions(refs.categories) },
      { key: 'brand', label: 'Marca', type: 'select', options: refs.brands.map(b => ({ value: b.id, label: b.name })) },
      { key: 'supplier', label: 'Proveedor', type: 'select', options: refs.suppliers.map(s => ({ value: s.id, label: s.name })) },
      { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo'], ['DISCONTINUED', 'Descontinuado'], ['DRAFT', 'Borrador']].map(([value, label]) => ({ value, label })) },
      { key: 'stock_status', label: 'Stock', type: 'select', options: [['OUT', '🔴 Agotado'], ['CRITICAL', '🟠 Crítico'], ['LOW', '🟡 Bajo'], ['HEALTHY', '🟢 Saludable'], ['EXCESS', '🔵 Exceso']].map(([value, label]) => ({ value, label })) },
    ],
    bulkActions: [
      { label: 'Activar', onClick: async (rows, t) => { await bulk(rows, { status: 'ACTIVE' }); t.clearSelection(); t.reload(); } },
      { label: 'Desactivar', onClick: async (rows, t) => { await bulk(rows, { status: 'INACTIVE' }); t.clearSelection(); t.reload(); } },
    ],
    columns: [
      { key: 'name', label: 'Producto', render: r => h('div.row.gap-2', { style: { flexWrap: 'nowrap' } }, h('div.thumb', r.image_url ? h('img', { src: r.image_url, alt: '', loading: 'lazy' }) : icon('box')), h('div', { style: { minWidth: 0 } }, h('div.cell-main.truncate', { style: { maxWidth: '320px' } }, r.name), h('div.cell-sub', [r.sku, r.barcode, r.has_variants ? 'con variantes' : null].filter(Boolean).join(' · ')))) },
      { key: 'category', label: 'Categoría', sortable: false, hideSm: true, render: r => r.category?.name || '—' },
      { key: 'brand', label: 'Marca', sortable: false, hideSm: true, hide: true, render: r => r.brand?.name || '—' },
      { key: 'price', label: 'Precio', num: true, render: r => h('b', fmt.money(r.price)) },
      ...(canCost ? [{ key: 'cost_price', label: 'Costo', num: true, hideSm: true, render: r => fmt.money(r.cost_price) }, { key: 'margin', label: 'Margen', num: true, hideSm: true, sortable: false, render: r => r.margin != null ? h('span', { class: r.margin < 20 ? 'down' : r.margin >= 50 ? 'up' : '' }, `${r.margin} %`) : '—' }] : []),
      { key: 'stock', label: 'Stock', num: true, render: r => h('div', { style: { textAlign: 'right' } }, h('b', fmt.int(r.stock)), h('div.cell-sub', `mín ${r.min_stock}`)) },
      { key: 'stock_status', label: 'Estado stock', sortable: false, render: r => stockBadge(r.stock_status) },
      { key: 'status', label: 'Estado', render: r => badge('product', r.status) },
      { key: '_actions', label: '', render: r => dropdown(h('button.btn.btn--ghost.btn--icon.btn--sm', { 'aria-label': 'Acciones' }, icon('more')), () => [
        { label: 'Vista rápida', icon: 'eye', onClick: () => openProductQuickView(r.id) },
        me.can('products.update') ? { label: 'Editar', icon: 'edit', onClick: () => openProductForm(r.id, () => table.reload()) } : null,
        me.can('inventory.adjust') ? { label: 'Ajustar stock', icon: 'layers', onClick: () => import('./stock.js').then(m => m.openAdjustment({ product: r }, () => table.reload())) } : null,
        me.can('products.delete') ? { sep: true } : null,
        me.can('products.delete') ? { label: r.stock > 0 ? 'Desactivar / ocultar' : 'Eliminar', icon: 'trash', danger: true, onClick: async () => { if (await confirm({ title: `Eliminar “${r.name}”`, text: 'Si tiene ventas o existencia solo se desactivará y ocultará para conservar el historial.', confirmText: 'Eliminar', danger: true })) { try { const res = await api.del(`/products/${r.id}`); toast(res?.message || `“${r.name}” se eliminó.`, { title: res?.soft ? 'Producto desactivado' : 'Producto eliminado', timeout: 6000 }); table.reload(); } catch (e) { toast.error(friendlyError(e)); } } } } : null,
      ]) },
    ],
    onRow: (r) => openProductQuickView(r.id, () => table.reload()),
  }).mount(box);
  async function bulk(rows, patch) {
    const res = await Promise.allSettled(rows.map(r => api.patch(`/products/${r.id}`, patch)));
    const bad = res.filter(x => x.status === 'rejected');
    const n = rows.length - bad.length; const verb = (patch.status === 'ACTIVE' ? 'activado' : 'desactivado') + (n === 1 ? '' : 's');
    if (!bad.length) toast(`${fmt.plural(n, 'producto', 'productos')} ${verb}.`);
    else toast.error(`${n} ${verb} y ${bad.length} con error: ${friendlyError(bad[0].reason)}`);
  }
  if (ctx.params.id) openProductQuickView(ctx.params.id, () => table.reload());
}

/** Quick view: foto, precio, stock, ventas, margen, tendencia, última compra, proveedor */
export async function openProductQuickView(id, onChange) {
  const box = h('div', spinner());
  const d = openDrawer({ title: 'Producto', size: 'lg', body: box, footer: (ctx) => [me.can('products.update') ? h('button.btn.btn--secondary', { onclick: () => { ctx.close(); openProductForm(id, onChange); } }, icon('edit'), 'Editar') : null, me.can('sales.create') ? h('a.btn.btn--primary', { href: '#/pos' }, icon('cart'), 'Vender') : null] });
  try {
    const { product: p, history: hst } = await api.get(`/products/${id}/quick`);
    d.setTitle(p.name);
    const weekly = hst.weekly || [];
    const canCost = me.can('products.cost.read');
    replace(box,
      h('div.row.gap-4', { style: { alignItems: 'flex-start', flexWrap: 'nowrap' } }, h('div.thumb.thumb--lg', p.image_url ? h('img', { src: p.image_url, alt: '' }) : icon('box')),
        h('div.flex-1', h('div.row.gap-2', badge('product', p.status), stockBadge(p.stock_status, p.stock), p.has_variants ? h('span.badge', 'Con variantes') : null), h('div.text-sm.text-2.mt-2', [p.sku, p.barcode, p.category?.name, p.brand?.name].filter(Boolean).join(' · ')), p.description ? h('p.text-sm.mt-2', { style: { maxWidth: '60ch' } }, p.description.slice(0, 220)) : null)),
      h('div.grid.grid--4.mt-4', { style: { gap: '10px' } }, mini('Precio', fmt.money(p.price), p.old_price ? h('s.text-xs.text-3', fmt.money(p.old_price)) : null), canCost ? mini('Costo · margen', `${fmt.money(p.cost_price)} · ${p.margin ?? '—'} %`) : mini('IVA', p.tax_rate ? `${(p.tax_rate.rate * 100).toFixed(0)} %` : 'Por defecto'),
        mini('Stock total', `${fmt.int(p.stock)} ${p.unit || ''}`, h('span.text-xs.text-3', `mín ${p.min_stock}${p.max_stock ? ` · máx ${p.max_stock}` : ''}`)), mini('Días de inventario', hst.days_of_stock != null ? `${hst.days_of_stock} días` : 'Sin ventas 30 d')),
      h('div.grid.grid--2.mt-4', { style: { gap: '12px' } },
        h('div.card.card--soft', { style: { padding: '14px' } }, h('div.row.row--between', h('div.eyebrow', 'Ventas · últimas 12 semanas'), delta(hst.last_30d?.revenue, hst.prev_30d?.revenue)), h('div.mt-2', sparkline(weekly.map(w => w.units), { w: 240, h: 60, cls: 'w-full' })), h('div.row.row--between.text-sm.mt-2', h('span', `30 d: ${fmt.int(hst.last_30d?.units)} uds · ${fmt.money(hst.last_30d?.revenue)}`), canCost ? h('span.text-2', `margen ${fmt.money(hst.last_30d?.margin)}`) : null)),
        h('div.card.card--soft', { style: { padding: '14px' } }, h('div.eyebrow.mb-2', 'Existencias por almacén'), (p.stock_by_warehouse || []).length ? p.stock_by_warehouse.map(l => h('div.stat-row', h('span', `${l.warehouse_name}${l.variant_id ? ' · ' + ((p.variants || []).find(v => v.id === l.variant_id)?.name || 'variante') : ''}`), h('b', fmt.int(l.quantity)))) : h('p.text-sm.text-3', 'Sin existencias registradas.'), h('div.divider'), h('div.stat-row', h('span.text-2', 'Última venta'), h('b', fmt.relative(hst.last_sale_at))), h('div.stat-row', h('span.text-2', 'Última compra'), h('b', hst.last_purchase ? `${fmt.date(hst.last_purchase.at)} · ${hst.last_purchase.quantity} uds${canCost ? ' a ' + fmt.money(hst.last_purchase.unit_cost) : ''}` : '—')), h('div.stat-row', h('span.text-2', 'Proveedor'), h('b', p.supplier?.name || '—')))),
      (p.variants || []).length ? h('div.mt-4', h('div.eyebrow.mb-2', 'Variantes'), h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Variante'), h('th', 'SKU'), h('th.num', 'Precio'), h('th.num', 'Stock'))), h('tbody', p.variants.map(v => h('tr', h('td', v.name), h('td', v.sku || '—'), h('td.num', fmt.money(v.price ?? p.price)), h('td.num', fmt.int((p.stock_by_warehouse || []).filter(l => l.variant_id === v.id).reduce((a, l) => a + l.quantity, 0))))))))) : null,
      h('div.row.gap-2.mt-4', h('a.btn.btn--ghost.btn--sm', { href: `#/movements?product=${p.id}` }, icon('activity'), 'Movimientos'), h('a.btn.btn--ghost.btn--sm', { href: `#/sales?product=${p.id}` }, icon('receipt'), 'Ventas'), h('a.btn.btn--ghost.btn--sm', { href: `#/analytics/products` }, icon('chart'), 'Analytics')),
    );
  } catch (e) { replace(box, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar el producto', text: friendlyError(e) })); }
  function mini(l, v, extra) { return h('div.card--soft', { style: { padding: '12px', borderRadius: '12px' } }, h('div.text-xs.text-3', l), h('div.strong', { style: { fontSize: '1.05rem' } }, v), extra || null); }
}

/** Formulario de producto (crear / editar) con variantes e imágenes */
export async function openProductForm(id, onDone) {
  const refs = await loadCatalogRefs();
  let p = null;
  if (id) { try { p = await api.get(`/products/${id}`); } catch (e) { toast.error(friendlyError(e), { title: 'No se pudo abrir el producto' }); return; } }
  const canCost = me.can('products.cost.read');
  const form = h('form', { novalidate: true });
  const f = {
    name: field({ label: 'Nombre', name: 'name', required: true, value: p?.name, span: 2 }),
    short_name: field({ label: 'Nombre corto (ticket)', name: 'short_name', value: p?.short_name, maxlength: 40 }),
    sku: field({ label: 'SKU', name: 'sku', value: p?.sku, placeholder: 'Se genera si lo dejas vacío' }),
    barcode: field({ label: 'Código de barras', name: 'barcode', value: p?.barcode, placeholder: 'Escanea aquí', hint: 'Puedes escanear con el lector USB.' }),
    category: field({ label: 'Categoría', name: 'category_id', type: 'select', required: true, options: categoryOptions(refs.categories), value: p?.category_id, placeholder: 'Elige…' }),
    brand: field({ label: 'Marca', name: 'brand_id', type: 'select', options: refs.brands.map(b => ({ value: b.id, label: b.name })), value: p?.brand_id, placeholder: 'Sin marca' }),
    supplier: field({ label: 'Proveedor', name: 'supplier_id', type: 'select', options: refs.suppliers.map(s => ({ value: s.id, label: s.name })), value: p?.supplier_id, placeholder: 'Sin proveedor' }),
    price: field({ label: 'Precio de venta (con IVA)', name: 'price', type: 'number', min: 0, step: '0.01', prefix: '$', required: true, value: p?.price }),
    old_price: field({ label: 'Precio anterior (tachado)', name: 'old_price', type: 'number', min: 0, step: '0.01', prefix: '$', value: p?.old_price }),
    cost: canCost ? field({ label: 'Costo', name: 'cost_price', type: 'number', min: 0, step: '0.01', prefix: '$', value: p?.cost_price ?? 0, hint: 'El margen se calcula automáticamente.' }) : null,
    tax: field({ label: 'IVA', name: 'tax_rate_id', type: 'select', options: refs.taxRates.map(t => ({ value: t.id, label: t.name })), value: p?.tax_rate_id, placeholder: 'Tasa por defecto' }),
    unit: field({ label: 'Unidad', name: 'unit', type: 'select', options: ['PZA', 'ML', 'GR', 'KIT', 'PAR'].map(u => ({ value: u, label: u })), value: p?.unit || 'PZA' }),
    min: field({ label: 'Stock mínimo', name: 'low_stock_threshold', type: 'number', min: 0, value: p?.low_stock_threshold ?? 3, hint: '🟡 bajo ≤ mínimo · 🟠 crítico ≤ mitad' }),
    max: field({ label: 'Stock máximo', name: 'max_stock', type: 'number', min: 0, value: p?.max_stock }),
    status: field({ label: 'Estado', name: 'status', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo'], ['DISCONTINUED', 'Descontinuado'], ['DRAFT', 'Borrador']].map(([value, label]) => ({ value, label })), value: p?.status || 'ACTIVE' }),
    weight: field({ label: 'Peso (kg)', name: 'weight', type: 'number', min: 0, step: '0.001', value: p?.weight }),
    dims: h('div.field', h('label.field__label', 'Dimensiones L × A × H (cm)'), h('div.row.gap-1', { style: { flexWrap: 'nowrap' } }, ['length', 'width', 'height'].map(k => h('input.input', { name: k, type: 'number', min: 0, step: '0.1', value: p?.[k] ?? '', placeholder: k[0].toUpperCase(), 'aria-label': k })))),
    description: field({ label: 'Descripción', name: 'description', type: 'textarea', rows: 4, value: p?.description, span: 2 }),
    badge: field({ label: 'Etiqueta en tienda', name: 'badge', type: 'select', options: [['nuevo', 'Nuevo'], ['oferta', 'Oferta'], ['popular', 'Popular']].map(([value, label]) => ({ value, label })), value: p?.badge, placeholder: 'Ninguna' }),
  };
  const margin = h('div.field__hint');
  const upd = () => { const pr = Number(f.price.input.value) || 0, c = Number(f.cost?.input.value) || 0; margin.textContent = pr > 0 && canCost ? `Margen: ${((pr - c) / pr * 100).toFixed(1)} % · utilidad ${fmt.money(pr - c)} por unidad` : ''; };
  f.price.input.addEventListener('input', upd); f.cost?.input.addEventListener('input', upd); upd();
  form.append(h('div.form-grid', f.name, f.short_name, f.category, f.sku, f.barcode, f.brand, f.supplier, f.price, f.old_price, f.cost, canCost ? h('div.span-2', margin) : null, f.tax, f.unit, f.min, f.max, f.status, f.weight, f.dims, f.badge, f.description));
  const extra = h('div');
  if (p) extra.append(variantsSection(p, () => {}), imagesSection(p));
  else extra.append(h('div.alert.alert--info.mt-4', icon('info'), h('div', 'Guarda el producto para agregar variantes e imágenes. El inventario inicial se registra desde Existencias → Ajuste o recibiendo una compra.')));
  const d = openDrawer({ title: p ? 'Editar producto' : 'Nuevo producto', size: 'lg', body: [form, extra], footer: (ctx) => [h('button.btn.btn--secondary', { onclick: () => ctx.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
    const data = formData(form);
    const local = {};
    if (!data.name?.trim()) local.name = 'El nombre es obligatorio.';
    if (!data.category_id) local.category_id = 'Elige una categoría.';
    if (!(data.price > 0)) local.price = 'El precio debe ser mayor a 0.';
    if (data.max_stock != null && data.low_stock_threshold != null && data.max_stock < data.low_stock_threshold) local.max_stock = 'El máximo debe ser mayor o igual al mínimo.';
    if (Object.keys(local).length) { showErrors(form, { details: local }); toast.warn(Object.values(local)[0], { title: 'Revisa los campos marcados' }); return; }
    ['length', 'width', 'height'].forEach(k => { const v = form.querySelector(`input[name="${k}"]`).value; data[k] = v === '' ? null : Number(v); });
    setLoading(e.target.closest('button'), true);
    try {
      const saved = p ? await api.patch(`/products/${p.id}`, data) : await api.post('/products', data);
      toast(p ? `“${saved.name}” · ${fmt.money(saved.price)}` : `SKU ${saved.sku}. Ahora puedes agregar variantes e imágenes; la existencia se carga con un ajuste o una compra.`, { title: p ? 'Cambios guardados' : `Producto “${saved.name}” creado`, timeout: 6000 }); onDone?.();
      if (!p) { ctx.close(); openProductForm(saved.id, onDone); } else ctx.close();
    } catch (err) { showErrors(form, err); toast.error(friendlyError(err), { title: err?.details ? 'Revisa los campos marcados' : null }); setLoading(e.target.closest('button'), false); }
  } }, icon('check'), p ? 'Guardar cambios' : 'Crear producto')] });
  setTimeout(() => f.name.input.focus(), 50);
}

function variantsSection(p, onChange) {
  const list = h('div');
  const sec = h('div.form-section', h('div.form-section__title', icon('layers'), 'Variantes', h('span.text-xs.text-3', '(color, talla, presentación, aroma, modelo…)')), list, h('button.btn.btn--secondary.btn--sm.mt-2', { type: 'button', onclick: () => editVariant(null) }, icon('plus'), 'Agregar variante'));
  const render = (variants) => replace(list, variants.length ? h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Nombre'), h('th', 'Atributos'), h('th', 'SKU'), h('th.num', 'Precio'), h('th', ''))), h('tbody', variants.map(v => h('tr', h('td', v.name, v.is_active === false ? h('span.badge', { style: { marginLeft: '6px' } }, 'inactiva') : null), h('td.text-xs.text-3', Object.entries(v.attributes || {}).map(([k, x]) => `${k}: ${x}`).join(', ')), h('td', v.sku || '—'), h('td.num', v.price != null ? fmt.money(v.price) : h('span.text-3', 'hereda')), h('td.actions', h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', 'aria-label': 'Editar', onclick: () => editVariant(v) }, icon('edit')), h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', 'aria-label': 'Eliminar', onclick: async () => { if (await confirm({ title: `Eliminar variante ${v.name}`, confirmText: 'Eliminar', danger: true })) { try { await api.del(`/variants/${v.id}`); toast(`Si tenía ventas o existencia, quedó inactiva para conservar el historial.`, { title: `Variante ${v.name} eliminada` }); reload(); } catch (e) { toast.error(friendlyError(e)); } } } }, icon('trash')))))))) : h('p.text-sm.text-3', 'Sin variantes. El producto se vende tal cual.'));
  const reload = async () => { const full = await api.get(`/products/${p.id}`); render(full.variants || []); onChange(); };
  render(p.variants || []);
  function editVariant(v) {
    const name = field({ label: 'Nombre (ej. Rosa, 250 ml, Talla M)', name: 'name', required: true, value: v?.name });
    const attrK = field({ label: 'Atributo', name: 'attr', type: 'select', options: ['color', 'talla', 'presentacion', 'aroma', 'modelo', 'sabor'].map(a => ({ value: a, label: a })), value: Object.keys(v?.attributes || {})[0] || 'color' });
    const attrV = field({ label: 'Valor', name: 'attrv', value: Object.values(v?.attributes || {})[0] || '' });
    const sku = field({ label: 'SKU', name: 'sku', value: v?.sku }); const barcode = field({ label: 'Código de barras', name: 'barcode', value: v?.barcode });
    const price = field({ label: 'Precio (vacío = hereda)', name: 'price', type: 'number', min: 0, step: '0.01', prefix: '$', value: v?.price });
    const cost = me.can('products.cost.read') ? field({ label: 'Costo (vacío = hereda)', name: 'cost_price', type: 'number', min: 0, step: '0.01', prefix: '$', value: v?.cost_price }) : null;
    const active = field({ label: 'Activa', name: 'is_active', type: 'switch', value: v ? v.is_active !== false : true });
    openModal({ title: v ? 'Editar variante' : 'Nueva variante', body: h('div.form-grid', h('div.span-2', name), attrK, attrV, sku, barcode, price, cost, active), footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
      if (!name.input.value.trim()) { toast.warn('Escribe el nombre de la variante (ej. Rosa, 250 ml, Talla M).'); name.input.focus(); return; }
      const data = { name: name.input.value.trim(), sku: sku.input.value || null, barcode: barcode.input.value || null, price: price.input.value === '' ? null : Number(price.input.value), is_active: active.querySelector('input').checked, attributes: attrV.input.value ? { [attrK.input.value]: attrV.input.value } : {} };
      if (cost) data.cost_price = cost.input.value === '' ? null : Number(cost.input.value);
      setLoading(e.target.closest('button'), true);
      try { if (v) await api.patch(`/variants/${v.id}`, data); else await api.post(`/products/${p.id}/variants`, data); toast(`${data.name} · ${data.price != null ? fmt.money(data.price) : 'precio del producto'}`, { title: v ? 'Variante actualizada' : 'Variante agregada' }); m.close(); reload(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); }
    } }, 'Guardar')] });
  }
  return sec;
}

function imagesSection(p) {
  const grid = h('div.row.gap-2');
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const sec = h('div.form-section', h('div.form-section__title', icon('eye'), 'Imágenes', h('span.text-xs.text-3', '(la primera es la principal)')), grid, h('div.row.gap-2.mt-2', h('button.btn.btn--secondary.btn--sm', { type: 'button', onclick: () => input.click() }, icon('upload'), 'Subir imágenes'), input));
  const render = (images) => replace(grid, images.length ? images.map((im, i) => h('div', { style: { position: 'relative' } }, h('div.thumb.thumb--lg', h('img', { src: im.image_url, alt: '' })), i === 0 ? h('span.badge.badge--primary', { style: { position: 'absolute', top: '4px', left: '4px' } }, 'Principal') : null,
    h('div.row.gap-1.mt-2', i > 0 ? h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', 'aria-label': 'Hacer principal', 'data-tip': 'Principal', onclick: () => move(im, 'up', true) }, icon('star')) : null, h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', 'aria-label': 'Eliminar', onclick: async () => { if (await confirm({ title: 'Eliminar imagen', confirmText: 'Eliminar', danger: true })) { try { await api.legacyDelete(`/images/${im.id}`); toast('Imagen eliminada.'); reload(); } catch (e) { toast.error(friendlyError(e)); } } } }, icon('trash'))))) : h('p.text-sm.text-3', 'Sin imágenes.'));
  let current = p.images || [];
  const reload = async () => { try { current = await api.legacy(`/products/${p.id}/images`); render(current); } catch { render([]); } };
  const move = async (im) => { try { await api.legacyPut('/images/reorder', { image_ids: [im.id, ...current.filter(x => x.id !== im.id).map(x => x.id)] }); toast('Esa imagen es ahora la principal en la tienda y el POS.'); reload(); } catch (e) { toast.error(friendlyError(e)); } };
  input.addEventListener('change', async () => {
    let okN = 0;
    for (const file of input.files) {
      if (!file.type.startsWith('image/')) { toast.warn(`${file.name} no es una imagen.`); continue; }
      if (file.size > 5 * 1024 * 1024) { toast.warn(`${file.name} pesa más de 5 MB; redúcela e intenta de nuevo.`); continue; }
      const fd = new FormData(); fd.append('productId', p.id); fd.append('isPrimary', String(current.length === 0 && okN === 0)); fd.append('file', file);
      try { await api.legacyUpload('/images/upload', fd); okN++; } catch (e) { toast.error(friendlyError(e), { title: `No se subió ${file.name}` }); }
    }
    if (okN) toast(`${fmt.plural(okN, 'imagen subida', 'imágenes subidas')}.`);
    input.value = ''; reload();
  });
  render(p.images || []);
  return sec;
}
