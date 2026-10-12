// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — Widgets: KPI, gráficas (Chart.js), heatmap, sparkline, empty,
// skeleton, tabs, date filter, form helpers, product quick view
// ═══════════════════════════════════════════════════════════════════════════
import { h, icon, fmt, clear, replace, $, $$, badge } from '../core/dom.js';
import { store } from '../core/store.js';
import { me } from '../core/auth.js';

export function emptyState({ icon: ic = 'inbox', title = 'Nada por aquí', text = '', action = null }) {
  return h('div.empty', h('div.empty__icon', icon(ic)), h('div.empty__title', title), text ? h('div.empty__text', text) : null, action ? h('button.btn.btn--primary', { type: 'button', onclick: action.onClick }, icon('plus'), action.label) : null);
}
export function skeletonRows(n = 5) { return h('div', { style: { padding: '12px 16px' } }, Array.from({ length: n }, () => h('div.skeleton.skeleton--row'))); }
export function skeletonCards(n = 4) { return h('div.grid.grid--kpi', Array.from({ length: n }, () => h('div.skeleton.skeleton--card'))); }
export function spinner() { return h('div.loading-center', h('div.spinner')); }

/** KPI card con comparación vs período anterior y sparkline opcional */
export function kpi({ label, value, prev, format = fmt.money, delta, foot, spark, hero = false, icon: ic = null, tone = '' }) {
  let d = delta;
  if (d == null && prev != null && prev !== 0 && value != null) d = (value - prev) / Math.abs(prev) * 100;
  const dir = d == null ? null : d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat';
  return h(`div.card.kpi${hero ? '.kpi--hero' : ''}${tone ? '.card--' + tone : ''}`,
    h('div.kpi__label', ic ? icon(ic) : null, label),
    h(`div.kpi__value${hero ? '' : ''}`, value == null ? '—' : format(value)),
    dir ? h(`span.kpi__delta.kpi__delta--${dir}`, icon(dir === 'up' ? 'arrowUp' : dir === 'down' ? 'arrowDown' : 'minus'), fmt.pct(d)) : null,
    foot ? h('div.kpi__foot', foot) : prev != null ? h('div.kpi__foot', `Anterior: ${format(prev)}`) : null,
    spark?.length ? sparkline(spark, { cls: 'kpi__spark' }) : null,
  );
}

/** Sparkline SVG */
export function sparkline(values, { cls = '', w = 90, h: hh = 34, color = 'var(--brand-terracotta)' } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${hh}`); svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true');
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const pts = values.map((v, i) => [i / Math.max(values.length - 1, 1) * (w - 2) + 1, hh - 2 - (v - min) / (max - min || 1) * (hh - 6)]);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '));
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', color); path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  const area = document.createElementNS(ns, 'path');
  area.setAttribute('d', path.getAttribute('d') + ` L${pts[pts.length - 1][0].toFixed(1)} ${hh} L${pts[0][0].toFixed(1)} ${hh} Z`); area.setAttribute('fill', color); area.setAttribute('opacity', '0.12');
  svg.append(area, path); return svg;
}

// ── Chart.js wrapper (carga perezosa del CDN) ─────────────────────────────
let chartLib = null;
export async function loadChart() {
  if (chartLib) return chartLib;
  // copia local primero (no depende del CDN); el CDN queda como respaldo
  for (const src of ['./vendor/chart.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js']) {
    if (window.Chart) break;
    try { await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); } catch { /* siguiente fuente */ }
  }
  if (!window.Chart) throw new Error('No se pudieron cargar las gráficas. Revisa tu conexión y recarga la página.');
  chartLib = window.Chart;
  const css = getComputedStyle(document.documentElement);
  chartLib.defaults.font.family = css.getPropertyValue('--font-body').trim() || 'Montserrat';
  chartLib.defaults.font.size = 11;
  chartLib.defaults.color = css.getPropertyValue('--chart-text').trim() || '#6E555A';
  chartLib.defaults.plugins.legend.labels.boxWidth = 10; chartLib.defaults.plugins.legend.labels.boxHeight = 10; chartLib.defaults.plugins.legend.labels.usePointStyle = true;
  chartLib.defaults.plugins.tooltip.backgroundColor = '#2B1A1E'; chartLib.defaults.plugins.tooltip.padding = 10; chartLib.defaults.plugins.tooltip.cornerRadius = 8;
  chartLib.defaults.elements.line.tension = 0.35; chartLib.defaults.elements.point.radius = 2; chartLib.defaults.elements.bar.borderRadius = 6;
  return chartLib;
}
/** Ajusta los colores base de las gráficas al tema actual (claro u oscuro). */
export function refreshChartTheme() { if (!chartLib) return; const css = getComputedStyle(document.documentElement); chartLib.defaults.color = css.getPropertyValue('--chart-text').trim() || chartLib.defaults.color; }
export const palette = () => { const css = getComputedStyle(document.documentElement); return [1, 2, 3, 4, 5, 6, 7, 8].map(i => css.getPropertyValue(`--chart-${i}`).trim()); };
const gridColor = () => getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim();

/**
 * chart(container, { type, labels, datasets, money, stacked, horizontal, legend, height })
 * datasets: [{ label, data, color? }]
 */
export async function chart(container, { type = 'line', labels = [], datasets = [], money = true, stacked = false, horizontal = false, legend = null, size = '', donutCenter = null, yFormat = null, onClick = null }) {
  let Chart;
  try { Chart = await loadChart(); } catch (e) { replace(container, h('div.empty', { style: { padding: '24px' } }, h('div.empty__icon', icon('chart')), h('div.empty__text', e.message))); return null; }
  refreshChartTheme();
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Gráfica' });
  replace(container, h(`div.chart${size ? '.chart--' + size : ''}`, canvas));
  if (container._chart) { container._chart.destroy(); }
  const colors = palette();
  const fmtY = yFormat || (money ? (v) => fmt.money(v, true) : (v) => fmt.int(v));
  const isPie = type === 'doughnut' || type === 'pie';
  const ds = datasets.map((d, i) => {
    const c = d.color || colors[i % colors.length];
    const base = { label: d.label, data: d.data, borderColor: c, backgroundColor: isPie ? d.data.map((_, j) => colors[j % colors.length]) : type === 'line' ? c + '22' : c, fill: d.fill ?? (type === 'line' && datasets.length === 1), borderWidth: isPie ? 0 : 2, yAxisID: d.yAxisID, type: d.type };
    if (isPie) { base.hoverOffset = 6; base.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-elevated').trim(); base.borderWidth = 2; }
    return base;
  });
  const cfg = {
    type, data: { labels, datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x', animation: { duration: 350 },
      interaction: { mode: isPie ? 'nearest' : 'index', intersect: false },
      onClick: onClick ? (e, els) => { if (els.length) onClick(els[0].index, els[0].datasetIndex); } : undefined,
      plugins: {
        legend: { display: legend ?? (isPie || datasets.length > 1), position: isPie ? 'right' : 'top', align: 'end' },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${money ? fmt.money(horizontal ? c.parsed.x : (isPie ? c.parsed : c.parsed.y)) : fmt.num(horizontal ? c.parsed.x : (isPie ? c.parsed : c.parsed.y))}` } },
      },
      scales: isPie ? {} : {
        x: { stacked, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12, callback: function (v) { const l = this.getLabelForValue(v); return horizontal ? fmtY(v) : (l.length > 14 ? l.slice(0, 13) + '…' : l); } } },
        y: { stacked, grid: { color: gridColor() }, border: { display: false }, ticks: { callback: (v) => horizontal ? (labels[v]?.length > 18 ? labels[v].slice(0, 17) + '…' : labels[v]) : fmtY(v), maxTicksLimit: 6 }, beginAtZero: true },
      },
    },
  };
  if (isPie) cfg.options.cutout = type === 'doughnut' ? '68%' : 0;
  const inst = new Chart(canvas, cfg);
  container._chart = inst;
  if (donutCenter) container.firstChild.appendChild(h('div', { style: { position: 'absolute', left: '0', top: '50%', transform: 'translateY(-50%)', width: legend === false ? '100%' : '55%', textAlign: 'center', pointerEvents: 'none' } }, h('div.serif', { style: { fontSize: '1.4rem', fontWeight: '600' } }, donutCenter.value), h('div.text-xs.text-3', donutCenter.label)));
  return inst;
}

/** Heatmap día × hora (CSS grid) */
export function heatmap(container, cells, { metric = 'revenue', hours = null } = {}) {
  const hs = hours || Array.from({ length: 13 }, (_, i) => i + 9); // 9 AM – 9 PM
  const map = {}; cells.forEach(c => { map[`${c.dow}-${c.hour}`] = c; });
  const max = Math.max(...cells.map(c => c[metric] || 0), 1);
  const grid = h('div.heatmap', { style: { '--cols': hs.length } }, h('div'), hs.map(hh => h('div.heatmap__col', { title: fmt.hour(hh) }, `${hh % 12 === 0 ? 12 : hh % 12}${hh < 12 ? 'a' : 'p'}`)),
    [1, 2, 3, 4, 5, 6, 0].map(d => [h('div.heatmap__row', fmt.dow(d)), hs.map(hh => {
      const c = map[`${d}-${hh}`]; const v = c ? c[metric] || 0 : 0; const l = v <= 0 ? 0 : Math.min(5, Math.ceil(v / max * 5));
      return h('div.heatmap__cell', { 'data-l': l, title: c ? `${fmt.dowLong(d)} ${fmt.hour(hh)} · ${c.sales} ventas · ${fmt.money(c.revenue)} · ticket ${fmt.money(c.avg_ticket)}` : `${fmt.dowLong(d)} ${fmt.hour(hh)} · sin ventas` });
    })]));
  replace(container, grid, h('div.row.mt-2.text-xs.text-3', { style: { justifyContent: 'flex-end' } }, 'Menos', [0, 1, 2, 3, 4, 5].map(l => h('span.heatmap__cell', { 'data-l': l, style: { width: '14px', height: '14px', aspectRatio: 'auto' } })), 'Más'));
}

/** Tabs: tabs([{ key, label, badge? }], active, onChange) */
export function tabs(items, active, onChange, { pills = false } = {}) {
  const el = h(`div.tabs${pills ? '.tabs--pills' : ''}`, { role: 'tablist' });
  const render = (act) => replace(el, items.map(t => h('button.tabs__tab', { type: 'button', role: 'tab', 'aria-selected': t.key === act ? 'true' : 'false', onclick: () => { render(t.key); onChange(t.key); } }, t.icon ? icon(t.icon) : null, t.label, t.badge != null ? h('span.count', String(t.badge)) : null)));
  render(active); el.setActive = render; return el;
}

/** Selector global de rango de fechas (reacciona todo el dashboard) */
const PRESETS = [['today', 'Hoy'], ['yesterday', 'Ayer'], ['last7', 'Últimos 7 días'], ['last30', 'Últimos 30 días'], ['this_week', 'Esta semana'], ['last_week', 'Semana anterior'], ['this_month', 'Este mes'], ['last_month', 'Mes anterior'], ['last90', 'Últimos 90 días'], ['this_year', 'Este año'], ['last_year', 'Año anterior'], ['custom', 'Personalizado…']];
export function dateFilter(onChange, { withBranch = true } = {}) {
  const sel = h('select.select', { 'aria-label': 'Periodo', style: { width: 'auto', minWidth: '170px' } }, PRESETS.map(([v, l]) => h('option', { value: v, selected: store.get('range') === v }, l)));
  const cr = store.get('customRange') || {};
  const from = h('input.input', { type: 'date', value: cr.from || '', style: { width: 'auto' }, 'aria-label': 'Desde' });
  const to = h('input.input', { type: 'date', value: cr.to || '', style: { width: 'auto' }, 'aria-label': 'Hasta' });
  const custom = h('div.row.gap-1', { hidden: store.get('range') !== 'custom' }, from, h('span.text-3', '–'), to);
  const apply = () => { store.pref('range', sel.value); store.set('range', sel.value); if (sel.value === 'custom') { if (!from.value || !to.value) return; store.pref('customRange', { from: from.value, to: to.value }); store.set('customRange', { from: from.value, to: to.value }); } onChange(); };
  sel.addEventListener('change', () => { custom.hidden = sel.value !== 'custom'; if (sel.value !== 'custom') apply(); else from.focus(); });
  from.addEventListener('change', apply); to.addEventListener('change', apply);
  const wrap = h('div.toolbar', icon('calendar', ''), sel, custom);
  if (withBranch && me.branches.length > 1) {
    const b = h('select.select', { 'aria-label': 'Sucursal', style: { width: 'auto' } }, h('option', { value: '' }, 'Todas las sucursales'), me.branches.map(x => h('option', { value: x.id, selected: store.get('branch') === x.id }, x.name)));
    b.addEventListener('change', () => { store.pref('branch', b.value || null); store.set('branch', b.value || null); onChange(); });
    wrap.appendChild(b);
  }
  return wrap;
}

/** Delta inline (↑ 18.4 %) */
export function delta(cur, prev) {
  if (prev == null || prev === 0 || cur == null) return h('span.text-3.text-xs', '—');
  const d = (cur - prev) / Math.abs(prev) * 100; const dir = d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat';
  return h(`span.text-xs.strong.${dir}`, dir === 'up' ? '▲ ' : dir === 'down' ? '▼ ' : '', fmt.pct(Math.abs(d)).replace('+', ''));
}

// ── Form helpers ─────────────────────────────────────────────────────────────
/** field({ label, name, type, value, options, required, hint, placeholder, span, ...attrs }) */
export function field(o) {
  const id = `f-${o.name}-${Math.random().toString(36).slice(2, 6)}`;
  let input;
  const common = { id, name: o.name, placeholder: o.placeholder || '', required: !!o.required, disabled: !!o.disabled, autocomplete: o.autocomplete || 'off' };
  if (o.type === 'select') input = h('select.select', common, o.placeholder != null ? h('option', { value: '' }, o.placeholder) : null, (o.options || []).map(op => h('option', { value: op.value ?? op.id, selected: String(op.value ?? op.id) === String(o.value ?? '') }, op.label ?? op.name)));
  else if (o.type === 'textarea') input = h('textarea.textarea', { ...common, rows: o.rows || 3 }, o.value ?? '');
  else if (o.type === 'checkbox') return h('label.check', { style: o.span ? { gridColumn: `span ${o.span}` } : null }, h('input', { type: 'checkbox', name: o.name, checked: !!o.value, disabled: !!o.disabled }), o.label);
  else if (o.type === 'switch') return h('label.switch', { style: o.span ? { gridColumn: `span ${o.span}` } : null }, h('input', { type: 'checkbox', name: o.name, checked: !!o.value, disabled: !!o.disabled }), h('span.switch__track'), h('span', o.label));
  else input = h('input.input', { ...common, type: o.type || 'text', value: o.type === 'file' ? undefined : (o.value ?? ''), step: o.step, min: o.min, max: o.max, accept: o.accept, multiple: o.multiple, inputmode: o.type === 'number' ? 'decimal' : undefined, list: o.list });
  if (o.onChange) input.addEventListener('change', () => o.onChange(input.value, input));
  if (o.onInput) input.addEventListener('input', () => o.onInput(input.value, input));
  let control = input;
  if (o.prefix || o.suffix) control = h(`div.input-group${o.prefix ? '.input-group--prefix' : ''}`, o.prefix ? h('span.input-group__addon', o.prefix) : null, input, o.suffix ? h('span.input-group__addon', o.suffix) : null);
  const wrap = h('div.field', { style: o.span ? { gridColumn: `span ${o.span}` } : null, 'data-field': o.name }, h('label.field__label', { for: id }, o.label, o.required ? h('span.req', '*') : null), control, o.hint ? h('div.field__hint', o.hint) : null, h('div.field__error', { hidden: true }));
  wrap.input = input; return wrap;
}
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value === '' ? null : el.value;
  }
  return out;
}
export function showErrors(form, err) {
  $$('.field__error', form).forEach(e => { e.hidden = true; e.textContent = ''; });
  $$('[aria-invalid]', form).forEach(e => e.removeAttribute('aria-invalid'));
  const details = err?.details && typeof err.details === 'object' ? err.details : null;
  if (details) {
    let first = null;
    for (const [k, msg] of Object.entries(details)) {
      const f = $(`[data-field="${k}"]`, form); if (!f) continue;
      $('.field__error', f).textContent = msg; $('.field__error', f).hidden = false; f.input?.setAttribute('aria-invalid', 'true'); first ||= f.input;
    }
    first?.focus();
    return true;
  }
  return false;
}
export function setLoading(btn, loading) { if (!btn) return; btn.classList.toggle('btn--loading', loading); btn.disabled = loading; }

/** Semáforo de stock con etiqueta */
export function stockBadge(status, qty) { return h('span.row.gap-1.nowrap', h(`span.dot.dot--${status || 'HEALTHY'}`), badge('stock', status), qty != null ? h('span.text-xs.text-3', `(${fmt.int(qty)})`) : null); }
