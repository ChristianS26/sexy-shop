// ═══════════════════════════════════════════════════════════════════════════
// Punto de venta — buscar → agregar → cantidad → cliente → descuento → cobrar → ticket
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { store } from '../core/store.js';
import { h, icon, fmt, replace, clear, debounce, uid, $, badge } from '../core/dom.js';
import { openModal, toast, confirm } from '../ui/overlay.js';
import { emptyState, spinner, field, setLoading } from '../ui/widgets.js';
import { printTicket } from './sales.js';
import { openCustomerForm } from './customers.js';

export const route = '/pos';
export const title = 'Punto de venta';
export const crumb = 'Ventas';
export const perms = ['sales.create'];

const CART_KEY = 'sonroja_pos_cart';

export async function render(root) {
  const branches = me.branches;
  let branchId = store.pref('pos_branch') || me.user?.default_branch_id || branches[0]?.id;
  if (!branches.some(b => b.id === branchId)) branchId = branches[0]?.id;
  let shift = null, products = [], categories = [], cart = loadCart(), customer = null, discountPct = 0, discountReason = '', notes = '', quote = null, seller = me.user?.id;
  const clientRef = { v: uid() };
  /** Almacén del que vende la sucursal (el predeterminado). */
  const whOf = () => (me.warehousesOf(branchId).find(w => w.is_default) || me.warehousesOf(branchId)[0])?.id;
  /** Existencia que puede venderse aquí: la del almacén de la sucursal. */
  const stockHere = (p) => p.warehouse_stock ?? p.stock;

  // ── Layout ───────────────────────────────────────────────────────────────
  const scan = h('input.input', { type: 'search', placeholder: 'Escanea un código de barras o busca por nombre / SKU…', autocomplete: 'off', 'aria-label': 'Buscar producto', autofocus: true });
  const catBar = h('div.tabs.tabs--pills');
  const grid = h('div.pos__grid');
  const branchSel = h('select.select.select--sm', { 'aria-label': 'Sucursal', style: { width: 'auto' } }, branches.map(b => h('option', { value: b.id, selected: b.id === branchId }, b.name)));
  branchSel.addEventListener('change', () => { branchId = branchSel.value; store.pref('pos_branch', branchId); loadShift(); loadProducts(); });
  const shiftBox = h('div.row.gap-2');
  const catalog = h('div.pos__catalog', h('div.row', h('div.search.flex-1', icon('scan'), scan), branches.length > 1 ? branchSel : null, shiftBox), catBar, grid);
  const lines = h('div.pos__lines');
  const totals = h('div.pos__totals');
  const cartCard = h('div.card.pos__cart', h('div.card__head', h('div', h('div.card__title', 'Venta'), h('div.card__sub', { id: 'pos-cust' })), h('div.row.gap-1', h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: pickCustomer }, icon('user'), h('span.hide-mobile', 'Cliente')), h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', 'aria-label': 'Vaciar', 'data-tip': 'Vaciar carrito', onclick: async () => { if (cart.length && await confirm({ title: 'Vaciar la venta', text: 'Se quitarán todos los productos.', confirmText: 'Vaciar', danger: true })) { cart = []; saveCart(); renderCart(); } } }, icon('trash')))), lines, totals);
  // barra fija para teléfono: total y cobro siempre a la mano
  const barTotal = h('div.pos__bar-total', fmt.money(0)), barCount = h('div.pos__bar-count', 'Carrito vacío');
  const barPay = h('button.btn.btn--primary', { type: 'button', disabled: true, onclick: () => totals.querySelector('.btn--primary.btn--block')?.click() }, icon('cash'), 'Cobrar');
  const bar = h('div.pos__bar', h('div.pos__bar-info', barTotal, barCount), h('button.btn.btn--secondary', { type: 'button', onclick: () => cartCard.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 'Ver venta'), barPay);
  replace(root, h('div.pos', catalog, cartCard), bar);

  // ── Datos ────────────────────────────────────────────────────────────────
  async function loadShift() {
    try { const r = await api.get('/cash/shifts/current', { branch: branchId }); shift = r.shift; } catch { shift = null; }
    replace(shiftBox, shift ? h('span.badge.badge--success.badge--dot', `Caja: ${shift.cash_registers?.name || 'abierta'}`) : h('button.btn.btn--secondary.btn--sm', { type: 'button', onclick: () => openShift() }, icon('cash'), 'Abrir caja'));
  }
  async function openShift() {
    const regs = me.registersOf(branchId);
    if (!me.can('cash.open')) { toast.warn('No tienes permiso para abrir caja. Pide a un gerente que abra el turno.'); return; }
    if (!regs.length) { toast.error('Esta sucursal no tiene cajas configuradas.'); return; }
    const regSel = field({ label: 'Caja', name: 'cash_register_id', type: 'select', options: regs, value: regs[0].id });
    const amount = field({ label: 'Fondo inicial en efectivo', name: 'opening_amount', type: 'number', value: 500, min: 0, step: '0.01', prefix: '$', required: true });
    openModal({ title: 'Abrir turno de caja', body: h('div.form-grid', regSel, amount), footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
      setLoading(e.target.closest('button'), true);
      if (amount.input.value === '' || Number(amount.input.value) < 0) { toast.warn('Indica el fondo inicial; puede ser $0 si la caja empieza vacía.'); amount.input.focus(); setLoading(e.target.closest('button'), false); return; }
      try { await api.post('/cash/shifts/open', { cash_register_id: regSel.input.value, opening_amount: Number(amount.input.value) }); toast(`${regSel.input.selectedOptions[0]?.textContent || 'Caja'} con fondo de ${fmt.money(Number(amount.input.value))}. Ya puedes cobrar en efectivo.`, { title: 'Turno abierto' }); m.close(); loadShift(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); }
    } }, 'Abrir turno')] });
  }
  async function loadProducts(q = '', category = '') {
    replace(grid, spinner());
    try {
      const r = await api.get('/products', { q: q || undefined, category: category || undefined, active: 'true', size: 60, sort: 'name', warehouse: whOf() });
      products = r.data;
      renderGrid();
    } catch (e) { replace(grid, emptyState({ icon: 'alertCircle', title: 'No se pudieron cargar los productos', text: friendlyError(e) })); }
  }
  async function loadCategories() {
    try { const r = await api.get('/categories'); categories = r.tree; renderCats(); } catch { /* opcional */ }
  }
  let activeCat = '';
  function renderCats() {
    replace(catBar, h('button.tabs__tab', { type: 'button', role: 'tab', 'aria-selected': activeCat === '' ? 'true' : 'false', onclick: () => { activeCat = ''; renderCats(); loadProducts(scan.value.trim(), ''); } }, 'Todo'),
      categories.filter(c => c.product_count > 0 || c.children?.some(k => k.product_count > 0)).map(c => h('button.tabs__tab', { type: 'button', role: 'tab', 'aria-selected': activeCat === c.id ? 'true' : 'false', onclick: () => { activeCat = c.id; renderCats(); loadProducts(scan.value.trim(), c.id); } }, c.name)));
  }
  function renderGrid() {
    if (!products.length) { replace(grid, emptyState({ icon: 'search', title: 'Sin productos', text: 'Prueba con otro término o categoría.' })); return; }
    replace(grid, products.map(p => h('button.pos__product', { type: 'button', disabled: stockHere(p) <= 0 && !me.settings?.inventory?.allow_negative, onclick: () => add(p), title: stockHere(p) <= 0 ? 'Sin existencia en esta sucursal' : p.name },
      h('div.pos__product-img', p.image_url ? h('img', { src: p.image_url, alt: '', loading: 'lazy' }) : icon('box')),
      h('div.pos__product-name', p.name),
      h('div.pos__product-price', fmt.money(p.price), h('small', { class: stockHere(p) <= (p.min_stock || 3) ? 'down' : '' }, `${stockHere(p)} uds`)))));
  }

  // ── Carrito ──────────────────────────────────────────────────────────────
  function loadCart() { try { return JSON.parse(sessionStorage.getItem(CART_KEY) || '[]'); } catch { return []; } }
  function saveCart() { sessionStorage.setItem(CART_KEY, JSON.stringify(cart)); }
  async function add(p, variant = null, variantStock = null) {
    if (p.has_variants && !variant) {
      const full = await api.get(`/products/${p.id}`);
      const vs = (full.variants || []).filter(v => v.is_active !== false);
      if (!vs.length) { toast.warn('Este producto tiene variantes pero ninguna está activa.'); return; }
      const stockOf = (vid) => (full.stock_by_warehouse || []).filter(l => l.variant_id === vid && me.warehousesOf(branchId).some(w => w.id === l.warehouse_id)).reduce((a, l) => a + l.quantity, 0);
      const vm = openModal({ title: p.name, sub: 'Elige la variante', body: h('div.grid.grid--2', { style: { gap: '10px' } }, vs.map(v => h('button.pay-btn', { type: 'button', disabled: stockOf(v.id) <= 0, onclick: () => { vm.close(); add(p, v, stockOf(v.id)); } }, h('b', v.name), h('span.text-xs.text-3', `${fmt.money(v.price ?? p.price)} · ${stockOf(v.id)} uds`)))) });
      return;
    }
    const key = p.id + (variant ? ':' + variant.id : '');
    const ex = cart.find(l => l.key === key);
    const max = variant ? variantStock : stockHere(p);
    if (max != null && max <= 0 && !me.settings?.inventory?.allow_negative) { toast.warn(`“${p.name}” no tiene existencia en esta sucursal.`); return; }
    if (ex) { if (max != null && ex.quantity + 1 > max) { toast.warn(`Solo hay ${max} en existencia en esta sucursal.`); return; } ex.quantity++; ex.stock = max; }
    else cart.push({ key, product_id: p.id, variant_id: variant?.id || null, name: p.name + (variant ? ` · ${variant.name}` : ''), price: variant?.price ?? p.price, quantity: 1, image: p.image_url, stock: max });
    saveCart(); renderCart(); scan.value = ''; scan.focus();
  }
  function setQty(line, q) { if (q <= 0) { cart = cart.filter(l => l !== line); } else { if (line.stock != null && q > line.stock) { toast.warn(`Solo hay ${line.stock} en existencia en esta sucursal.`); q = line.stock; } line.quantity = q; } saveCart(); renderCart(); }
  const requote = debounce(async () => {
    if (!cart.length) { quote = null; renderTotals(); return; }
    try { quote = await api.post('/pos/quote', { items: cart.map(l => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity })), discount_pct: discountPct || undefined }); }
    catch (e) { quote = null; toast.error(friendlyError(e)); }
    renderTotals();
  }, 250);
  function renderCart() {
    if (lines.contains(document.activeElement)) document.activeElement.blur();
    const custEl = $('#pos-cust'); if (custEl) replace(custEl, customer ? h('span', { 'data-private': '' }, `${fmt.name(customer)}${customer.phone ? ' · ' + customer.phone : ''}`) : 'Público en general');
    if (!cart.length) { replace(lines, emptyState({ icon: 'cart', title: 'Carrito vacío', text: 'Escanea un código o toca un producto para agregarlo.' })); }
    else replace(lines, cart.map(l => { const q = quote?.items?.find(i => i.product_id === l.product_id && (i.variant_id || null) === (l.variant_id || null)); return h('div.pos__line',
      h('div', { style: { minWidth: 0 } }, h('div.pos__line-name.truncate', l.name), h('div.pos__line-sub', `${fmt.money(l.price)} c/u`, q?.discount_amount > 0 ? h('span.badge.badge--success', { style: { marginLeft: '6px' } }, `−${fmt.money(q.discount_amount)} promo`) : null)),
      h('div.row.gap-2', h('div.qty', h('button', { type: 'button', 'aria-label': 'Menos', onclick: () => setQty(l, l.quantity - 1) }, icon('minus')), h('input', { type: 'number', value: l.quantity, min: 0, 'aria-label': 'Cantidad', onchange: (e) => setQty(l, parseInt(e.target.value) || 0) }), h('button', { type: 'button', 'aria-label': 'Más', onclick: () => setQty(l, l.quantity + 1) }, icon('plus'))),
        h('b.num', { style: { minWidth: '72px', textAlign: 'right' } }, fmt.money(l.price * l.quantity - (q?.discount_amount || 0))), h('button.btn.btn--ghost.btn--icon.btn--sm', { type: 'button', 'aria-label': 'Quitar', onclick: () => setQty(l, 0) }, icon('x')))); }));
    requote();
  }
  function renderTotals() {
    const gross = cart.reduce((a, l) => a + l.price * l.quantity, 0);
    const promo = quote?.promotion_discount || 0; const manual = quote?.manual_discount || (discountPct ? Math.round((gross - promo) * discountPct) / 100 : 0);
    const total = quote?.total ?? (gross - promo - manual);
    const rate = me.settings?.tax?.prices_include_tax === false ? 0 : 0.16;
    const canDiscount = me.can('sales.discount');
    replace(totals,
      h('div.row.row--between', h('span.text-2', `${fmt.int(cart.reduce((a, l) => a + l.quantity, 0))} artículos`), h('span.num', fmt.money(gross))),
      promo > 0 ? h('div.row.row--between.up', h('span', `Promociones ${quote?.applied_promotions?.map(p => p.name).join(', ') || ''}`), h('span.num', `−${fmt.money(promo)}`)) : null,
      (quote?.suggestions || []).map(s => h('div.alert.alert--info', { style: { padding: '8px 10px' } }, icon('gift'), h('span.text-xs', s.message))),
      h('div.row.row--between', h('button.btn.btn--ghost.btn--sm', { type: 'button', disabled: !canDiscount, title: canDiscount ? '' : 'Tu rol no puede aplicar descuentos', onclick: askDiscount }, icon('percent'), discountPct ? `Descuento ${discountPct} %` : 'Descuento'), h('span.num', manual > 0 ? `−${fmt.money(manual)}` : '—')),
      h('div.row.row--between.text-xs.text-3', h('span', 'IVA incluido'), h('span.num', fmt.money(total - total / (1 + rate)))),
      h('div.pos__total', h('span', 'Total'), h('span.num', fmt.money(total))),
      h('div.row.gap-2.mt-2', h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: askNotes }, icon('edit'), notes ? 'Nota ✓' : 'Nota'), me.can('sales.read') ? h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: pickSeller }, icon('user'), 'Vendedor') : null),
      h('button.btn.btn--primary.btn--lg.btn--block.mt-2', { type: 'button', disabled: !cart.length, onclick: () => checkout(total) }, icon('cash'), `Cobrar ${fmt.money(total)}`),
    );
    const units = cart.reduce((a, l) => a + l.quantity, 0);
    barTotal.textContent = fmt.money(total); barCount.textContent = units ? fmt.plural(units, 'artículo', 'artículos') : 'Carrito vacío'; barPay.disabled = !cart.length;
  }
  async function askDiscount() {
    const max = me.maxDiscount;
    const pct = field({ label: `Descuento (%)${max != null ? ` · máximo ${max} %` : ''}`, name: 'pct', type: 'number', value: discountPct || '', min: 0, max: max ?? 100, step: '0.5' });
    const reason = field({ label: 'Motivo (obligatorio, queda auditado)', name: 'reason', type: 'select', value: discountReason, options: [{ value: 'Cliente frecuente' }, { value: 'Promoción del día' }, { value: 'Producto con empaque dañado' }, { value: 'Ajuste de precio autorizado' }, { value: 'Otro' }].map(o => ({ value: o.value, label: o.value })), placeholder: 'Elige un motivo' });
    openModal({ title: 'Aplicar descuento', body: h('div.form-grid', pct, reason), footer: (m) => [h('button.btn.btn--ghost', { onclick: () => { discountPct = 0; discountReason = ''; m.close(); renderCart(); } }, 'Quitar'), h('button.btn.btn--primary', { onclick: () => {
      const v = Number(pct.input.value) || 0; if (max != null && v > max) { toast.warn(`Tu rol permite hasta ${max} %.`); return; } if (v > 0 && !reason.input.value) { toast.warn('Indica el motivo.'); return; }
      discountPct = v; discountReason = reason.input.value; m.close(); renderCart();
    } }, 'Aplicar')] });
  }
  function askNotes() { const t = field({ label: 'Nota para la venta', name: 'notes', type: 'textarea', value: notes }); openModal({ title: 'Nota', body: t, footer: (m) => [h('button.btn.btn--primary', { onclick: () => { notes = t.input.value; m.close(); renderTotals(); } }, 'Guardar')] }); }
  async function pickSeller() {
    const users = (await api.get('/users', { size: 100, status: 'ACTIVE' })).data;
    const sel = field({ label: 'Vendedor', name: 'seller', type: 'select', value: seller, options: users.map(u => ({ value: u.id, label: fmt.name(u) })) });
    openModal({ title: 'Asignar vendedor', body: sel, footer: (m) => [h('button.btn.btn--primary', { onclick: () => { seller = sel.input.value; m.close(); toast('Vendedor asignado'); } }, 'Guardar')] });
  }
  async function pickCustomer() {
    const input = h('input.input', { placeholder: 'Nombre, teléfono o correo…', autofocus: true });
    const list = h('div.stack', { style: { gap: '6px', minHeight: '120px' } });
    const search = debounce(async () => {
      const q = input.value.trim(); if (q.length < 2) { clear(list); return; }
      const r = await api.get('/customers', { q, size: 8 });
      replace(list, r.data.length ? r.data.map(c => h('button.menu__item', { type: 'button', onclick: () => { customer = c; m.close(); renderCart(); } }, h('div.avatar', fmt.initials(c)), h('div', h('div', { 'data-private': '' }, fmt.name(c)), h('div.text-xs.text-3', [c.phone, c.neighborhood_name].filter(Boolean).join(' · '))), h('span.palette__meta', `${c.purchases_count} compras`))) : h('div.text-sm.text-3', { style: { padding: '12px' } }, 'Sin resultados. Puedes crearlo abajo.'));
    }, 250);
    input.addEventListener('input', search);
    const m = openModal({ title: 'Cliente', sub: 'Opcional. Permite historial, RFM y análisis por colonia.', body: h('div.stack', h('div.search', icon('search'), input), list), footer: (ctx) => [customer ? h('button.btn.btn--ghost', { onclick: () => { customer = null; ctx.close(); renderCart(); } }, 'Venta sin cliente') : null, h('button.btn.btn--secondary', { onclick: () => { ctx.close(); openCustomerForm(null, (c) => { customer = c; renderCart(); }); } }, icon('plus'), 'Nuevo cliente')] });
  }

  // ── Cobro ────────────────────────────────────────────────────────────────
  async function checkout(total) {
    const methods = me.paymentMethods;
    if (!shift) { const cashMethod = methods.find(m => m.is_cash); if (cashMethod && me.settings?.sales?.require_shift_for_cash !== false) toast.warn('Sin turno de caja solo podrás cobrar con tarjeta o transferencia.', { timeout: 5000 }); }
    let method = methods.find(m => m.code === 'CASH' && shift) || methods.find(m => !m.is_cash) || methods[0];
    let received = total; let reference = '';
    const change = h('div.change-display', 'Cambio: $0.00');
    const recvInput = h('input.input', { type: 'number', step: '0.01', min: 0, value: '', placeholder: fmt.money(total), style: { fontSize: '1.3rem', textAlign: 'right' }, 'aria-label': 'Recibido' });
    const refInput = field({ label: 'Referencia / últimos 4 dígitos', name: 'reference', type: 'text', placeholder: 'Opcional' });
    const methodsBox = h('div.pos__pay');
    const numpad = h('div.numpad', ['50', '100', '200', '500', '1000', 'exacto'].map(v => h('button', { type: 'button', onclick: () => { recvInput.value = v === 'exacto' ? total.toFixed(2) : String(Number(recvInput.value || 0) + Number(v)); upd(); } }, v === 'exacto' ? 'Exacto' : `$${v}`)));
    const cashBox = h('div.stack', { hidden: !method?.is_cash }, h('div.field', h('label.field__label', 'Efectivo recibido'), recvInput), numpad, change);
    const upd = () => { received = method?.is_cash ? (Number(recvInput.value) || 0) : total; const ch = received - total; change.textContent = ch >= 0 ? `Cambio: ${fmt.money(ch)}` : `Faltan ${fmt.money(-ch)}`; change.className = 'change-display' + (ch < 0 ? ' down' : ''); };
    recvInput.addEventListener('input', upd);
    const renderMethods = () => replace(methodsBox, methods.map(mm => h('button.pay-btn', { type: 'button', 'aria-pressed': method?.code === mm.code ? 'true' : 'false', disabled: mm.is_cash && !shift, onclick: () => { method = mm; renderMethods(); cashBox.hidden = !mm.is_cash; refInput.hidden = mm.is_cash; upd(); if (mm.is_cash) setTimeout(() => recvInput.focus(), 30); } }, icon(mm.is_cash ? 'cash' : mm.code === 'CARD' ? 'wallet' : 'send'), mm.name, mm.is_cash && !shift ? h('span.text-xs.text-3', 'sin turno') : null)));
    renderMethods(); refInput.hidden = !!method?.is_cash; upd();
    const m = openModal({ title: `Cobrar ${fmt.money(total)}`, sub: customer ? `Cliente: ${fmt.name(customer)}` : 'Público en general', body: h('div.stack', methodsBox, cashBox, refInput), size: 'md',
      footer: (ctx) => [h('button.btn.btn--secondary', { onclick: () => ctx.close() }, 'Cancelar'), h('button.btn.btn--primary.btn--lg', { onclick: async (e) => {
        if (!method) return;
        if (method.is_cash && received < total - 0.001) { toast.warn('El efectivo recibido no cubre el total.'); recvInput.focus(); return; }
        setLoading(e.target.closest('button'), true); ctx.setBusy(true);
        try {
          const sale = await api.post('/sales', { branch_id: branchId, customer_id: customer?.id || null, cash_shift_id: shift?.id || null, seller_id: seller, notes: notes || null, client_ref: clientRef.v,
            discount_pct: discountPct || undefined, discount_reason: discountPct ? discountReason : undefined,
            items: cart.map(l => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity })),
            payments: [{ method_code: method.code, amount: method.is_cash ? received : total, reference: refInput.input.value || undefined }] });
          ctx.close();
          cart = []; saveCart(); customer = null; discountPct = 0; discountReason = ''; notes = ''; clientRef.v = uid(); quote = null; renderCart();
          toast(sale.change_amount > 0 ? `Entrega ${fmt.money(sale.change_amount)} de cambio.` : `Cobrado: ${fmt.money(sale.total)} con ${method.name}.`, { title: `Venta ${sale.folio} registrada`, timeout: 6000 });
          printTicket(sale.id, { auto: true });
          loadProducts(scan.value.trim(), activeCat);
        } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); ctx.setBusy(false); }
      } }, icon('check'), 'Confirmar cobro')] });
    if (method?.is_cash) setTimeout(() => recvInput.focus(), 60);
  }

  // ── Escáner / búsqueda ───────────────────────────────────────────────────
  const onSearch = debounce(() => loadProducts(scan.value.trim(), activeCat), 300);
  scan.addEventListener('input', onSearch);
  scan.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); const code = scan.value.trim(); if (!code) return;
    try {
      const r = await api.get('/products/lookup', { code, warehouse: whOf() });
      if (r.match === 'variant') add(r.product, r.variant);
      else if (r.match === 'product') { if (r.product.has_variants && r.variants?.length === 1) add(r.product, r.variants[0]); else add(r.product); }
      else {
        // sin coincidencia exacta: buscar por nombre y decidir con resultados frescos
        await loadProducts(code, activeCat);
        if (products.length === 1) add(products[0]);
        else if (products.length > 1) toast.info(`Hay ${products.length} productos que coinciden con “${code}”. Toca el correcto.`);
        else toast.warn(`No encontramos ningún producto con el código o nombre “${code}”.`);
      }
    } catch (err) { toast.error(friendlyError(err)); }
  });
  // F2 enfoca el escáner, F9 cobra
  const keys = (e) => { if (e.key === 'F2') { e.preventDefault(); scan.focus(); } if (e.key === 'F9' && cart.length) { e.preventDefault(); renderTotals(); totals.querySelector('.btn--primary')?.click(); } };
  document.addEventListener('keydown', keys);

  await Promise.all([loadShift(), loadProducts(), loadCategories()]);
  renderCart();
  return () => document.removeEventListener('keydown', keys);
}
