// ═══════════════════════════════════════════════════════════════════════════
// Analytics — overview, productos, clientes (RFM, cohortes), geografía, horarios,
// tendencias, inventario (ABC, rotación), finanzas. Todo reacciona al filtro global.
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { store, rangeParams } from '../core/store.js';
import { h, icon, fmt, replace, badge } from '../core/dom.js';
import { kpi, chart, heatmap, dateFilter, skeletonCards, emptyState, tabs, delta, spinner } from '../ui/widgets.js';
import { openProductQuickView } from './products.js';
import { openCustomer360 } from './customers.js';

export const routes = ['/analytics/:page'];
export const title = 'Analytics';
export const crumb = 'Inteligencia';
export const perms = ['analytics.read'];

const PAGES = {
  overview: { title: 'Overview', sub: 'Qué significa lo que está pasando: ingresos, tickets, margen y comparativos.' },
  products: { title: 'Productos', sub: 'Más vendidos, mayor margen, en crecimiento, en caída y lo que se compra junto.' },
  customers: { title: 'Clientes', sub: 'Nuevos vs recurrentes, segmentación RFM y cohortes de retención.' },
  geography: { title: 'Geografía', sub: 'De qué colonias vienen los clientes y dónde está el mayor ticket.' },
  time: { title: 'Horarios', sub: '¿A qué hora vende más SONROJA? Día de la semana × hora.' },
  trends: { title: 'Tendencias', sub: 'Detección automática: qué crece, qué cae y qué emerge en las últimas semanas.' },
  inventory: { title: 'Inventario', sub: 'Clasificación ABC, rotación, días de inventario y stock detenido.' },
  financial: { title: 'Finanzas', sub: 'Ingresos − costo de ventas = utilidad bruta; − gastos = utilidad operativa.' },
};
const canCost = () => me.can('products.cost.read');

export async function render(root, ctx) {
  const page = PAGES[ctx.params.page] ? ctx.params.page : 'overview';
  if (page === 'financial' && !me.can('analytics.financial')) { replace(root, emptyState({ icon: 'lock', title: 'Sin acceso a finanzas' })); return; }
  ctx.setTitle(`Analytics · ${PAGES[page].title}`, 'Inteligencia');
  const body = h('div.stack', { style: { gap: '20px' } });
  const noDate = page === 'trends' || page === 'inventory';
  root.append(h('div.page-head', h('div', h('h1.page-head__title', PAGES[page].title), h('p.page-head__sub', PAGES[page].sub)), noDate ? null : dateFilter(() => load())),
    h('div.tabs', Object.entries(PAGES).filter(([k]) => k !== 'financial' || me.can('analytics.financial')).map(([k, v]) => h('a.tabs__tab', { href: `#/analytics/${k}`, role: 'tab', 'aria-selected': k === page ? 'true' : 'false' }, v.label || v.title))), body);
  async function load() {
    replace(body, skeletonCards(4), h('div.skeleton.skeleton--card', { style: { height: '320px' } }));
    try { await ({ overview, products, customers, geography, time, trends, inventory, financial })[page](body); }
    catch (e) { replace(body, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar', text: friendlyError(e) })); }
  }
  await load();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const card = (title, sub, content, extra) => h('div.card', h('div.card__head', h('div', h('div.card__title', title), sub ? h('div.card__sub', sub) : null), extra || null), h('div.card__body', content));
const flush = (title, sub, content, extra) => h('div.card', h('div.card__head', h('div', h('div.card__title', title), sub ? h('div.card__sub', sub) : null), extra || null), h('div.card__body.card__body--flush', content));
const box = () => h('div');
const growth = (g) => g == null ? h('span.text-3', '—') : h('span', { class: g >= 0 ? 'up' : 'down' }, fmt.pct(g));
function labelFor(bucket, days) { const d = new Date(bucket); if (days <= 2) return `${String(d.getHours()).padStart(2, '0')}:00`; if (days <= 92) return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }); if (days <= 400) return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }); return d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }); }

// ── Overview ────────────────────────────────────────────────────────────────
async function overview(body) {
  const d = await api.get('/analytics/sales', rangeParams());
  const cur = d.overview.current, prev = d.overview.previous, s = d.timeseries || [];
  const c1 = box(), c2 = box(), c3 = box();
  replace(body, h('div.grid.grid--kpi',
    kpi({ label: 'Ingresos', value: cur.revenue, prev: prev.revenue, hero: true, tone: 'accent', spark: s.map(x => x.revenue), foot: `${d.range.label} · anterior ${fmt.money(prev.revenue)}` }),
    kpi({ label: 'Tickets', value: cur.orders, prev: prev.orders, format: fmt.int }), kpi({ label: 'Ticket promedio', value: cur.avg_ticket, prev: prev.avg_ticket }), kpi({ label: 'Unidades', value: cur.units, prev: prev.units, format: fmt.int }),
    canCost() ? kpi({ label: 'Margen bruto', value: cur.gross_profit, prev: prev.gross_profit, foot: cur.net_revenue ? `${Math.round(cur.gross_profit / cur.net_revenue * 100)} % del ingreso neto` : null }) : kpi({ label: 'Clientes', value: cur.customers, prev: prev.customers, format: fmt.int }),
    kpi({ label: 'Descuentos', value: cur.discounts, prev: prev.discounts, foot: cur.revenue ? `${(cur.discounts / (cur.revenue + cur.discounts) * 100).toFixed(1)} % sobre bruto` : null }), kpi({ label: 'Cancelaciones', value: cur.cancelled, prev: prev.cancelled, format: fmt.int }), kpi({ label: 'Devoluciones', value: cur.refunds, prev: prev.refunds, foot: `${fmt.int(cur.returns)} operaciones` })),
    card('Ingresos y tickets en el tiempo', d.range.label, c1), h('div.grid.grid--2', card('Métodos de pago', 'Mezcla del periodo', c2), flush('Vendedores', 'Desempeño del periodo', c3)));
  await chart(c1, { type: 'bar', labels: s.map(x => labelFor(x.bucket, d.range.days)), datasets: [{ label: 'Ingresos', data: s.map(x => x.revenue), yAxisID: 'y' }, { label: 'Tickets', data: s.map(x => x.orders), type: 'line', yAxisID: 'y1', color: 'var(--chart-2)', fill: false }], money: true, size: 'lg' }).then(inst => { inst.options.scales.y1 = { position: 'right', grid: { display: false }, beginAtZero: true, ticks: { callback: v => fmt.int(v) } }; inst.update(); });
  const pm = d.payment_methods || [];
  chart(c2, { type: 'doughnut', labels: pm.map(p => p.name), datasets: [{ data: pm.map(p => p.amount) }], donutCenter: { value: fmt.money(cur.revenue, true), label: 'total' } });
  const sellers = d.sellers || [];
  replace(c3, sellers.length ? h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Vendedor'), h('th.num', 'Ventas'), h('th.num', 'Ingresos'), h('th.num', 'Ticket'), h('th.num', 'Desc. %'), h('th.num', 'Canc.'))), h('tbody', sellers.map(x => h('tr', h('td', x.name), h('td.num', x.sales), h('td.num.strong', fmt.money(x.revenue)), h('td.num', fmt.money(x.avg_ticket)), h('td.num', { class: x.discount_pct > 10 ? 'down' : '' }, `${x.discount_pct} %`), h('td.num', x.cancelled)))))) : h('div.card__body', emptyState({ icon: 'users', title: 'Sin ventas' })));
}

// ── Productos ───────────────────────────────────────────────────────────────
async function products(body) {
  const metricSel = h('select.select.select--sm', { style: { width: 'auto' } }, [['revenue', 'Mayor ingreso'], ['units', 'Más vendidos'], ['margin', 'Mayor margen'], ['growth', 'Mayor crecimiento'], ['decline', 'Mayor caída'], ['rotation', 'Mayor rotación']].filter(([k]) => canCost() || k !== 'margin').map(([v, l]) => h('option', { value: v }, l)));
  metricSel.value = store.pref('an_metric') || 'revenue';
  const d = await api.get('/analytics/products', { ...rangeParams(), metric: metricSel.value, limit: 20 });
  const c1 = box(), c2 = box(), topBox = box();
  metricSel.addEventListener('change', async () => { store.pref('an_metric', metricSel.value); const r = await api.get('/analytics/products', { ...rangeParams(), metric: metricSel.value, limit: 20 }); renderTop(r.top); });
  const renderTop = (top) => replace(topBox, top.length ? h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', '#'), h('th', 'Producto'), h('th.num', 'Unidades'), h('th.num', 'Ingresos'), canCost() ? h('th.num', 'Margen') : null, h('th.num', 'vs anterior'), h('th.num', 'Stock'), h('th.num', 'Días inv.'))), h('tbody', top.map((p, i) => h('tr.clickable', { onclick: () => openProductQuickView(p.product_id) }, h('td', h('div.rank__n', String(i + 1))), h('td', h('div.cell-main', p.name), h('div.cell-sub', [p.sku, p.category_name].filter(Boolean).join(' · '))), h('td.num', fmt.int(p.units)), h('td.num.strong', fmt.money(p.revenue)), canCost() ? h('td.num', fmt.money(p.margin)) : null, h('td.num', growth(p.growth_pct)), h('td.num', p.stock), h('td.num', p.days_of_stock ?? '—')))))) : emptyState({ icon: 'tag', title: 'Sin ventas en el periodo' }));
  replace(body, flush('Top productos', d.range.label, topBox, metricSel), h('div.grid.grid--2', card('Ventas por categoría', 'Participación e ingresos', c1), flush('Categorías: crecimiento', 'vs periodo anterior', c2)),
    h('div.grid.grid--2', flush('Crecen', 'Mayor crecimiento vs periodo anterior', miniList(d.growth, true)), flush('Caen', 'Mayor caída vs periodo anterior', miniList(d.decline, false))),
    flush('Se compran juntos', 'Market basket: pares con mayor frecuencia conjunta (lift > 1 = afinidad real)', basketTable(d.basket)));
  renderTop(d.top);
  const cats = d.categories || [];
  chart(c1, { type: 'bar', horizontal: true, labels: cats.slice(0, 10).map(c => c.name), datasets: [{ label: 'Ingresos', data: cats.slice(0, 10).map(c => c.revenue) }], legend: false, size: 'lg' });
  replace(c2, cats.length ? h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Categoría'), h('th.num', 'Ingresos'), h('th.num', '%'), canCost() ? h('th.num', 'Margen %') : null, h('th.num', 'Crecimiento'))), h('tbody', cats.map(c => h('tr', h('td', c.icon ? `${c.icon} ` : '', c.name), h('td.num', fmt.money(c.revenue)), h('td.num', `${c.share_pct} %`), canCost() ? h('td.num', `${c.margin_pct} %`) : null, h('td.num', growth(c.growth_pct))))))) : emptyState({ icon: 'grid', title: 'Sin datos' }));
  function miniList(list, up) { return (list || []).filter(p => p.growth_pct != null).length ? h('div.table-wrap', h('table.table.table--compact', h('tbody', list.filter(p => p.growth_pct != null).slice(0, 8).map(p => h('tr.clickable', { onclick: () => openProductQuickView(p.product_id) }, h('td', p.name), h('td.num', `${fmt.money(p.prev_revenue)} → ${fmt.money(p.revenue)}`), h('td.num', growth(p.growth_pct))))))) : h('div.card__body', h('p.text-sm.text-3', 'Sin comparativo: hace falta un periodo anterior con ventas.')); }
}
function basketTable(pairs) { return (pairs || []).length ? h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto A'), h('th', 'Producto B'), h('th.num', 'Juntos'), h('th.num', 'Soporte'), h('th.num', 'Confianza A→B'), h('th.num', 'Lift'))), h('tbody', pairs.map(p => h('tr', h('td', p.name_a), h('td', p.name_b), h('td.num', p.together), h('td.num', `${p.support_pct} %`), h('td.num', `${p.confidence_ab_pct} %`), h('td.num', h('b', { class: p.lift > 1.5 ? 'up' : '' }, p.lift))))))) : h('div.card__body', h('p.text-sm.text-3', 'Aún no hay suficientes tickets con dos o más productos.')); }

// ── Clientes ────────────────────────────────────────────────────────────────
async function customers(body) {
  const d = await api.get('/analytics/customers', rangeParams());
  const s = d.summary, seg = d.rfm?.segments || {}, list = d.rfm?.customers || [], coh = d.cohorts || [];
  const segOrder = ['CHAMPIONS', 'LOYAL', 'POTENTIAL', 'NEW', 'AT_RISK', 'CANT_LOSE', 'HIBERNATING', 'LOST'];
  const segDesc = { CHAMPIONS: 'Compran seguido, recientemente y gastan más. Cuídalos.', LOYAL: 'Compran con regularidad. Recompénsalos.', POTENTIAL: 'Recientes con potencial de volverse leales.', NEW: 'Primera compra reciente. Da seguimiento.', AT_RISK: 'Compraban bien y llevan tiempo sin volver.', CANT_LOSE: 'Fueron muy buenos clientes y se están alejando.', HIBERNATING: 'Baja actividad desde hace tiempo.', LOST: 'Inactivos desde hace mucho.' };
  const segBox = box(), listBox = box(), cohBox = box();
  let activeSeg = null;
  const renderList = () => replace(listBox, (activeSeg ? list.filter(c => c.segment === activeSeg) : list).slice(0, 50).map(c => h('tr.clickable', { onclick: () => openCustomer360(c.customer_id) }, h('td', { 'data-private': '' }, fmt.name(c)), h('td', badge('rfm', c.segment)), h('td.num', `${c.recency_days} d`), h('td.num', c.frequency), h('td.num', fmt.money(c.monetary)), h('td.num', fmt.money(c.avg_ticket)), h('td', fmt.date(c.last_purchase_at)))));
  replace(body, h('div.grid.grid--kpi', kpi({ label: 'Clientes con compras', value: s.with_purchases, format: fmt.int, foot: `${fmt.int(s.total)} registrados` }), kpi({ label: 'Nuevos en el periodo', value: s.new_in_period, format: fmt.int }), kpi({ label: 'Recurrentes en el periodo', value: s.returning_in_period, format: fmt.int }), kpi({ label: 'Tasa de recompra', value: s.repeat_rate_pct, format: v => fmt.pctPlain(v), foot: `${s.third_purchase_pct} % llega a 3.ª compra` }), kpi({ label: 'Lifetime value promedio', value: s.avg_ltv }), kpi({ label: 'Frecuencia', value: s.avg_frequency, format: v => `${fmt.num(v, 1)} compras`, foot: s.avg_days_between ? `cada ${s.avg_days_between} días` : null }), kpi({ label: 'Inactivos +90 días', value: s.inactive_90d, format: fmt.int })),
    card('Segmentación RFM', 'Recency · Frequency · Monetary sobre toda la base. Haz clic en un segmento para filtrar.', segBox),
    flush('Clientes por segmento', activeSeg ? segDesc[activeSeg] : 'Ordenados por gasto', h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Cliente'), h('th', 'Segmento'), h('th.num', 'Última compra'), h('th.num', 'Compras'), h('th.num', 'Gasto'), h('th.num', 'Ticket'), h('th', 'Fecha'))), h('tbody', listBox)))),
    flush('Cohortes de retención', '% de clientes de cada mes de primera compra que vuelven a comprar en los meses siguientes', cohBox));
  replace(segBox, h('div.grid.grid--4', { style: { gap: '10px' } }, segOrder.filter(k => seg[k]).map(k => h('button.card.card--soft', { type: 'button', style: { padding: '14px', textAlign: 'left', borderColor: activeSeg === k ? 'var(--color-primary)' : '' }, onclick: (e) => { activeSeg = activeSeg === k ? null : k; renderList(); segBox.querySelectorAll('.card--soft').forEach(b => { b.style.borderColor = ''; }); if (activeSeg) e.currentTarget.style.borderColor = 'var(--color-primary)'; } }, badge('rfm', k), h('div.serif.mt-2', { style: { fontSize: '1.5rem', fontWeight: '600' } }, fmt.int(seg[k].customers)), h('div.text-xs.text-2', `${fmt.money(seg[k].revenue, true)} · ticket ${fmt.money(seg[k].avg_ticket, true)}`), h('div.text-xs.text-3.mt-2', segDesc[k])))));
  renderList();
  if (coh.length) {
    const maxM = Math.max(...coh.map(c => Math.max(0, ...c.months.map(m => m.m))));
    replace(cohBox, h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Cohorte'), h('th.num', 'Clientes'), Array.from({ length: Math.min(maxM, 11) + 1 }, (_, i) => h('th.num', `M${i}`)))), h('tbody', coh.map(c => h('tr', h('td', c.cohort), h('td.num', c.size), Array.from({ length: Math.min(maxM, 11) + 1 }, (_, i) => { const m = c.months.find(x => x.m === i); const p = m ? m.retention_pct : null; return h('td.num', { style: p != null ? { background: `color-mix(in srgb, var(--brand-wine) ${Math.min(p, 100) * 0.6}%, transparent)`, color: p > 50 ? '#fff' : '' } : null, title: m ? `${m.active} clientes · ${fmt.money(m.revenue)}` : '' }, p != null ? `${p} %` : '—'); })))))));
  } else replace(cohBox, h('div.card__body', h('p.text-sm.text-3', 'Sin cohortes todavía.')));
}

// ── Geografía ───────────────────────────────────────────────────────────────
async function geography(body) {
  const d = await api.get('/analytics/geography', rangeParams());
  const rows = d.neighborhoods?.rows || [];
  const c1 = box(), prodBox = box(), tableBox = box();
  replace(body, h('div.grid.grid--kpi', kpi({ label: 'Colonias con ventas', value: rows.length, format: fmt.int }), kpi({ label: 'Ventas con colonia', value: d.neighborhoods?.total_sales, format: fmt.int, foot: `${fmt.int(d.neighborhoods?.unassigned?.sales)} sin colonia (${fmt.money(d.neighborhoods?.unassigned?.revenue, true)})` }), kpi({ label: 'Colonia líder', value: rows[0]?.revenue, foot: rows[0]?.name ? `${rows[0].name} · ${rows[0].share_pct} %` : '—' }), kpi({ label: 'Mayor ticket', value: rows.filter(r => r.sales >= 3).sort((a, b) => b.avg_ticket - a.avg_ticket)[0]?.avg_ticket, foot: rows.filter(r => r.sales >= 3).sort((a, b) => b.avg_ticket - a.avg_ticket)[0]?.name })),
    h('div.grid.grid--main-aside', card('Ranking por colonia', 'Ingresos del periodo', c1), flush('Productos por colonia', 'Elige una colonia en la tabla', prodBox)),
    flush('Detalle', 'Haz clic en una colonia para ver qué compra', tableBox),
    h('div.alert.alert--info', icon('map'), h('div', h('div.alert__title', 'Mapa'), h('div.alert__text', 'Las colonias guardan latitud/longitud para integrar un mapa (Mapbox/Google) más adelante sin cambiar el modelo.'))));
  chart(c1, { type: 'bar', horizontal: true, labels: rows.slice(0, 12).map(r => r.name), datasets: [{ label: 'Ingresos', data: rows.slice(0, 12).map(r => r.revenue) }], legend: false, size: 'lg', onClick: (i) => pick(rows[i]) });
  replace(tableBox, rows.length ? h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', '#'), h('th', 'Colonia'), h('th.num', 'Ventas'), h('th.num', 'Ingresos'), h('th.num', '%'), h('th.num', 'Clientes'), h('th.num', 'Ticket prom.'), h('th.num', 'Frecuencia'), h('th.num', 'Crecimiento'))), h('tbody', rows.map((r, i) => h('tr.clickable', { onclick: () => pick(r) }, h('td', i + 1), h('td', h('div.cell-main', r.name), h('div.cell-sub', [r.city, r.zip].filter(Boolean).join(' · '))), h('td.num', r.sales), h('td.num.strong', fmt.money(r.revenue)), h('td.num', `${r.share_pct} %`), h('td.num', r.customers), h('td.num', fmt.money(r.avg_ticket)), h('td.num', r.frequency), h('td.num', growth(r.growth_pct))))))) : emptyState({ icon: 'map', title: 'Sin colonias', text: 'Captura la colonia en la dirección de tus clientes.' }));
  async function pick(r) { replace(prodBox, spinner()); const p = await api.get('/analytics/geography', { ...rangeParams(), neighborhood: r.neighborhood_id }); replace(prodBox, h('div.card__body', h('div.eyebrow.mb-2', r.name)), (p.products || []).length ? h('div.table-wrap', h('table.table.table--compact', h('tbody', p.products.map(x => h('tr', h('td', x.name), h('td.num', `${x.units} uds`), h('td.num', fmt.money(x.revenue))))))) : h('div.card__body', h('p.text-sm.text-3', 'Sin productos.'))); }
}

// ── Horarios ────────────────────────────────────────────────────────────────
async function time(body) {
  const d = await api.get('/analytics/time', rangeParams());
  const cells = d.heatmap || [];
  const byDow = [0, 1, 2, 3, 4, 5, 6].map(dw => ({ dow: dw, revenue: cells.filter(c => c.dow === dw).reduce((a, c) => a + c.revenue, 0), sales: cells.filter(c => c.dow === dw).reduce((a, c) => a + c.sales, 0) }));
  const byHour = Array.from({ length: 24 }, (_, hh) => ({ hour: hh, revenue: cells.filter(c => c.hour === hh).reduce((a, c) => a + c.revenue, 0), sales: cells.filter(c => c.hour === hh).reduce((a, c) => a + c.sales, 0) })).filter(x => x.hour >= 8 && x.hour <= 22);
  const best = cells.slice().sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const metric = h('select.select.select--sm', { style: { width: 'auto' } }, [['revenue', 'Ingresos'], ['sales', 'Número de ventas'], ['avg_ticket', 'Ticket promedio']].map(([v, l]) => h('option', { value: v }, l)));
  const heat = box(), c1 = box(), c2 = box();
  metric.addEventListener('change', () => heatmap(heat, cells, { metric: metric.value }));
  replace(body, h('div.grid.grid--kpi', kpi({ label: 'Mejor día', value: byDow.slice().sort((a, b) => b.revenue - a.revenue)[0]?.revenue, foot: fmt.dowLong(byDow.slice().sort((a, b) => b.revenue - a.revenue)[0]?.dow) }), kpi({ label: 'Mejor hora', value: byHour.slice().sort((a, b) => b.revenue - a.revenue)[0]?.revenue, foot: fmt.hour(byHour.slice().sort((a, b) => b.revenue - a.revenue)[0]?.hour ?? 0) }), kpi({ label: 'Pico combinado', value: best[0]?.revenue, foot: best[0] ? `${fmt.dowLong(best[0].dow)} ${fmt.hour(best[0].hour)} · ${best[0].sales} ventas` : '—' }), kpi({ label: 'Horas con ventas', value: cells.length, format: fmt.int })),
    card('Mapa de calor', 'Día de la semana × hora', heat, metric), h('div.grid.grid--2', card('Por día de la semana', 'Ingresos', c1), card('Por hora', 'Ingresos 8 AM – 10 PM', c2)),
    flush('Top 5 franjas', 'Las combinaciones día/hora más fuertes', h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Día'), h('th', 'Hora'), h('th.num', 'Ventas'), h('th.num', 'Ingresos'), h('th.num', 'Ticket'))), h('tbody', best.map(b => h('tr', h('td', fmt.dowLong(b.dow)), h('td', fmt.hour(b.hour)), h('td.num', b.sales), h('td.num.strong', fmt.money(b.revenue)), h('td.num', fmt.money(b.avg_ticket)))))))));
  heatmap(heat, cells);
  chart(c1, { type: 'bar', labels: [1, 2, 3, 4, 5, 6, 0].map(fmt.dow), datasets: [{ label: 'Ingresos', data: [1, 2, 3, 4, 5, 6, 0].map(dw => byDow[dw].revenue) }], legend: false, size: 'sm' });
  chart(c2, { type: 'bar', labels: byHour.map(x => fmt.hour(x.hour)), datasets: [{ label: 'Ingresos', data: byHour.map(x => x.revenue), color: 'var(--chart-2)' }], legend: false, size: 'sm' });
}

// ── Tendencias ──────────────────────────────────────────────────────────────
async function trends(body) {
  const weeksSel = h('select.select.select--sm', { style: { width: 'auto' } }, [2, 4, 8, 12].map(w => h('option', { value: w, selected: w === 4 }, `Últimas ${w} semanas`)));
  const render = async () => {
    const d = await api.get('/analytics/trends', { weeks: weeksSel.value, branch: store.get('branch') || undefined });
    const o = d.overall || {};
    const list = (items, key, nameKey = 'name', link) => (items || []).length ? h('div.table-wrap', h('table.table.table--compact', h('tbody', items.map(p => h('tr', { class: link ? 'clickable' : '', onclick: link ? () => link(p) : null }, h('td', p[nameKey]), h('td.num', `${fmt.money(p.prev)} → ${fmt.money(p.cur)}`), h('td.num', growth(p.growth_pct))))))) : h('div.card__body', h('p.text-sm.text-3', 'Sin cambios detectados.'));
    replace(body, h('div.row.row--between', h('div.alert', { class: o.growth_pct >= 0 ? 'alert--success' : 'alert--warning', style: { flex: 1 } }, icon('trend'), h('div', h('div.alert__title', `Las ventas ${o.growth_pct == null ? 'no tienen comparativo' : o.growth_pct >= 0 ? 'aumentaron' : 'disminuyeron'} ${o.growth_pct != null ? fmt.pct(Math.abs(o.growth_pct)).replace('+', '') : ''} durante las últimas ${d.weeks} semanas`), h('div.alert__text', `${fmt.money(o.prev)} → ${fmt.money(o.cur)} frente a las ${d.weeks} semanas anteriores`))), weeksSel),
      h('div.grid.grid--2', flush('Productos creciendo', 'Mayor crecimiento en ingresos', list(d.products_rising, 'cur', 'name', p => openProductQuickView(p.product_id))), flush('Productos cayendo', 'Mayor caída en ingresos', list(d.products_falling, 'cur', 'name', p => openProductQuickView(p.product_id)))),
      h('div.grid.grid--2', flush('Categorías creciendo', '', list(d.categories_rising)), flush('Categorías cayendo', '', list(d.categories_falling))),
      h('div.grid.grid--3', flush('Colonias emergentes', 'Crecimiento en ingresos', list(d.neighborhoods_rising)), flush('Horarios fuertes', 'Franjas con más ingresos', (d.strong_hours || []).length ? h('div.table-wrap', h('table.table.table--compact', h('tbody', d.strong_hours.map(x => h('tr', h('td', `${fmt.dowLong(x.dow)} ${fmt.hour(x.hour)}`), h('td.num', `${x.sales} ventas`), h('td.num', fmt.money(x.revenue))))))) : h('div.card__body', h('p.text-sm.text-3', '—'))), flush('Clientes recurrentes', 'Dos o más compras en el periodo', (d.recurring_customers || []).length ? h('div.table-wrap', h('table.table.table--compact', h('tbody', d.recurring_customers.map(c => h('tr.clickable', { onclick: () => openCustomer360(c.customer_id) }, h('td', { 'data-private': '' }, fmt.name(c)), h('td.num', `${c.purchases} compras`), h('td.num', fmt.money(c.revenue))))))) : h('div.card__body', h('p.text-sm.text-3', '—')))),
      (d.products_new || []).length ? flush('Productos que empezaron a vender', 'Sin ventas en el periodo anterior', h('div.table-wrap', h('table.table.table--compact', h('tbody', d.products_new.map(p => h('tr', h('td', p.name), h('td.num', `${p.cur_units} uds`), h('td.num', fmt.money(p.cur)))))))) : null,
      flush('Se compran juntos', 'Pares frecuentes en el periodo', basketTable(d.baskets)));
  };
  weeksSel.addEventListener('change', render);
  await render();
}

// ── Inventario ──────────────────────────────────────────────────────────────
async function inventory(body) {
  const d = await api.get('/analytics/inventory', { range: 'last90', days: 90 });
  const abc = d.abc?.rows || [], sum = d.abc?.summary || {}, rot = d.rotation?.rows || [], rs = d.rotation?.summary || {};
  const c1 = box(), rotBox = box(), abcBox = box();
  let rotFilter = '';
  const renderRot = () => replace(rotBox, h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Producto'), h('th', 'Rotación'), h('th.num', 'Stock'), h('th.num', 'Vendidas 90 d'), h('th.num', 'Venta diaria'), h('th.num', 'Días de inventario'), h('th.num', 'Rotación'), canCost() ? h('th.num', 'Valor') : null, h('th', 'Última venta'))), h('tbody', rot.filter(r => !rotFilter || r.classification === rotFilter).slice(0, 100).map(r => h('tr.clickable', { onclick: () => openProductQuickView(r.product_id) }, h('td', h('div.cell-main', r.name), h('div.cell-sub', r.category_name)), h('td', badge('rotation', r.classification)), h('td.num', r.stock), h('td.num', r.units_sold), h('td.num', fmt.num(r.avg_daily_sales, 2)), h('td.num', r.days_of_inventory != null ? `${r.days_of_inventory} días` : '∞'), h('td.num', r.turnover ?? '—'), canCost() ? h('td.num', fmt.money(r.stock_value)) : null, h('td', r.last_sold ? fmt.date(r.last_sold) : h('span.text-3', 'Nunca'))))))));
  const rotTabs = tabs([{ key: '', label: 'Todos' }, { key: 'FAST', label: 'Rápida', badge: rs.fast_count }, { key: 'SLOW', label: 'Lenta', badge: rs.slow_count }, { key: 'DEAD', label: 'Sin movimiento', badge: rs.dead_count }], '', (k) => { rotFilter = k; renderRot(); }, { pills: true });
  replace(body, h('div.grid.grid--kpi', canCost() ? kpi({ label: 'Valor del inventario', value: rs.total_value }) : kpi({ label: 'Productos activos', value: rot.length, format: fmt.int }), kpi({ label: 'Rotación (90 d)', value: rs.turnover, format: v => `${fmt.num(v, 2)}×`, foot: 'COGS / valor de inventario' }), kpi({ label: 'Días de inventario prom.', value: rs.avg_days_of_inventory, format: v => `${fmt.int(v)} días` }), canCost() ? kpi({ label: 'Stock sin movimiento', value: rs.dead_value, foot: `${fmt.int(rs.dead_count)} productos · ${fmt.int(rs.slow_count)} lentos (${fmt.money(rs.slow_value, true)})` }) : kpi({ label: 'Sin movimiento', value: rs.dead_count, format: fmt.int, foot: `${rs.slow_count} lentos` })),
    h('div.grid.grid--main-aside', flush('Clasificación ABC', 'A = 80 % de las ventas · B = siguiente 15 % · C = resto (últimos 90 días)', abcBox), card('Resumen ABC', '', c1)),
    flush('Rotación de inventario', 'Ventas diarias, cobertura y clasificación', rotBox, rotTabs));
  replace(abcBox, h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Clase'), h('th', 'Producto'), h('th.num', 'Ingresos'), h('th.num', 'Unidades'), canCost() ? h('th.num', 'Margen') : null, h('th.num', '% acum.'), h('th.num', 'Stock'), h('th.num', 'Rotación'))), h('tbody', abc.slice(0, 100).map(r => h('tr.clickable', { onclick: () => openProductQuickView(r.product_id) }, h('td', badge('abc', r.class)), h('td', h('div.cell-main', r.name), h('div.cell-sub', r.category)), h('td.num', fmt.money(r.revenue)), h('td.num', r.units), canCost() ? h('td.num', fmt.money(r.margin)) : null, h('td.num', `${r.cum_pct} %`), h('td.num', r.stock), h('td.num', r.rotation ?? '—')))))));
  replace(c1, ['A', 'B', 'C'].map(k => h('div.stat-row', h('span.row.gap-2', badge('abc', k), `${fmt.int(sum[k]?.products)} productos`), h('b', fmt.money(sum[k]?.revenue, true)))), canCost() ? h('div.text-xs.text-3.mt-2', `Valor en stock: A ${fmt.money(sum.A?.stock_value, true)} · B ${fmt.money(sum.B?.stock_value, true)} · C ${fmt.money(sum.C?.stock_value, true)}`) : null);
  renderRot();
}

// ── Finanzas ────────────────────────────────────────────────────────────────
async function financial(body) {
  const d = await api.get('/analytics/financial', rangeParams());
  const f = d.financial, months = f.by_month || [];
  const c1 = box(), c2 = box();
  replace(body, h('div.grid.grid--kpi', kpi({ label: 'Ingresos', value: f.revenue, hero: true, tone: 'accent', foot: `Sin IVA: ${fmt.money(f.net_revenue)} · IVA cobrado ${fmt.money(f.tax_collected)}` }), kpi({ label: 'Costo de ventas (COGS)', value: f.cogs }), kpi({ label: 'Utilidad bruta', value: f.gross_profit, foot: `${f.gross_margin_pct} % margen bruto` }), kpi({ label: 'Gastos', value: f.expenses }), kpi({ label: 'Utilidad operativa', value: f.operating_profit, tone: f.operating_profit < 0 ? '' : '', foot: f.net_revenue ? `${Math.round(f.operating_profit / f.net_revenue * 100)} % sobre ingreso neto` : null })),
    card('Estado de resultados', 'Ingreso neto · costo · utilidad bruta · gastos · utilidad operativa', h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Mes'), h('th.num', 'Ingresos'), h('th.num', 'Sin IVA'), h('th.num', 'COGS'), h('th.num', 'Utilidad bruta'), h('th.num', 'Gastos'), h('th.num', 'Utilidad operativa'))), h('tbody', months.map(m => h('tr', h('td', m.month), h('td.num', fmt.money(m.revenue)), h('td.num', fmt.money(m.net_revenue)), h('td.num', fmt.money(m.cogs)), h('td.num', fmt.money(m.gross_profit)), h('td.num', fmt.money(m.expenses)), h('td.num', h('b', { class: m.operating_profit >= 0 ? 'up' : 'down' }, fmt.money(m.operating_profit))))))))),
    h('div.grid.grid--2', card('Utilidad por mes', '', c1), card('Gastos por categoría', d.range.label, c2)));
  chart(c1, { type: 'bar', labels: months.map(m => m.month), datasets: [{ label: 'Utilidad bruta', data: months.map(m => m.gross_profit) }, { label: 'Gastos', data: months.map(m => m.expenses), color: 'var(--chart-4)' }, { label: 'Utilidad operativa', data: months.map(m => m.operating_profit), type: 'line', color: 'var(--chart-3)', fill: false }], size: 'sm' });
  const ex = f.expenses_by_category || [];
  chart(c2, { type: 'doughnut', labels: ex.map(e => e.category), datasets: [{ data: ex.map(e => e.amount) }], donutCenter: { value: fmt.money(f.expenses, true), label: 'gastos' } });
}
