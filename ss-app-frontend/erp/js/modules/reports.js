// ═══════════════════════════════════════════════════════════════════════════
// Report Center — catálogo de reportes con filtros y exportación CSV / Excel / impresión
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { store, rangeParams } from '../core/store.js';
import { h, icon, fmt, replace } from '../core/dom.js';
import { dateFilter, spinner, emptyState } from '../ui/widgets.js';
import { toast } from '../ui/overlay.js';

export const routes = ['/reports', '/reports/:key'];
export const title = 'Reportes';
export const crumb = 'Inteligencia';
export const perms = ['reports.read'];

const GROUPS = { VENTAS: 'Ventas', INVENTARIO: 'Inventario', COMPRAS: 'Compras', CLIENTES: 'Clientes', FINANZAS: 'Finanzas' };

export async function render(root, ctx) {
  const reports = await api.get('/reports');
  const list = h('div.stack', { style: { gap: '6px' } });
  const view = h('div');
  const byGroup = reports.reduce((m, r) => { (m[r.group] ||= []).push(r); return m; }, {});
  let current = ctx.params.key || store.pref('report_last') || reports[0]?.key;
  const renderList = () => replace(list, Object.entries(byGroup).map(([g, items]) => [h('div.sidebar__section', { style: { color: 'var(--color-text-3)', padding: '12px 10px 4px' } }, GROUPS[g] || g), items.map(r => h('button.menu__item', { type: 'button', disabled: !r.allowed, style: { background: r.key === current ? 'var(--color-primary-soft)' : '', color: r.key === current ? 'var(--color-primary)' : '' }, onclick: () => { current = r.key; store.pref('report_last', r.key); location.hash = `#/reports/${r.key}`; renderList(); run(); } }, icon('file'), h('div', h('div', r.name), h('div.text-xs.text-3', r.description))))]));
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Reportes'), h('p.page-head__sub', 'Filtra por periodo y sucursal, revisa en pantalla y exporta a Excel o CSV. Para PDF usa Imprimir.')), dateFilter(run)),
    h('div.grid', { style: { gridTemplateColumns: '300px minmax(0, 1fr)', gap: '20px' } }, h('div.card', { style: { padding: '8px', alignSelf: 'start', position: 'sticky', top: 'calc(var(--header-h) + 16px)' } }, list), view));
  renderList();
  async function run() {
    const def = reports.find(r => r.key === current); if (!def) return;
    replace(view, spinner());
    try {
      const data = await api.get(`/reports/${current}`, rangeParams());
      const cols = data.columns;
      const head = h('div.card__head', h('div', h('div.card__title', def.name), h('div.card__sub', `${def.description} · ${fmt.int(data.total)} filas`)), h('div.row.gap-2', h('button.btn.btn--ghost.btn--sm', { onclick: () => { document.body.classList.add('print-report'); window.print(); setTimeout(() => document.body.classList.remove('print-report'), 500); } }, icon('print'), 'Imprimir / PDF'), me.can('reports.export') ? [h('button.btn.btn--secondary.btn--sm', { onclick: () => api.download(`/reports/${current}`, { ...rangeParams(), format: 'csv' }).catch(e => toast.error(friendlyError(e))) }, icon('download'), 'CSV'), h('button.btn.btn--primary.btn--sm', { onclick: () => api.download(`/reports/${current}`, { ...rangeParams(), format: 'xlsx' }).catch(e => toast.error(friendlyError(e))) }, icon('download'), 'Excel')] : null));
      let sortKey = null, desc = true;
      const tbody = h('tbody');
      const renderRows = () => { const rows = data.rows.slice(); if (sortKey) rows.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'es'); return desc ? -r : r; }); replace(tbody, rows.slice(0, 500).map(r => h('tr', cols.map(c => h(`td${c.numeric ? '.num' : ''}`, format(r[c.key], c)))))); };
      const format = (v, c) => v == null ? '—' : c.numeric ? (/pct|%/.test(c.label) ? `${fmt.num(v, 1)} %` : /Unidades|Ventas|Clientes|Compras|Órdenes|Mes|Día|Activos|Stock|Mínimo|Cantidad|Antes|Después|R$|F$|M$|Rotación|Venta diaria|Tickets/.test(c.label) ? fmt.num(v) : fmt.money(v)) : /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? fmt.datetime(v) : String(v);
      replace(view, h('div.card', head, data.rows.length ? h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', cols.map(c => h(`th.sortable${c.numeric ? '.num' : ''}`, { onclick: () => { desc = sortKey === c.key ? !desc : true; sortKey = c.key; renderRows(); } }, c.label)))), tbody)) : h('div.card__body', emptyState({ icon: 'file', title: 'Sin datos para este periodo' })), data.rows.length > 500 ? h('div.table-foot', `Mostrando 500 de ${fmt.int(data.total)} filas. Exporta para ver todo.`) : null));
      renderRows();
    } catch (e) { replace(view, emptyState({ icon: 'alertCircle', title: 'No se pudo generar el reporte', text: friendlyError(e) })); }
  }
  await run();
}
