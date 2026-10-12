// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — DataTable server-side: búsqueda, filtros, orden, paginación,
// columnas configurables, exportación, selección múltiple, empty/skeleton
// ═══════════════════════════════════════════════════════════════════════════
import { h, icon, clear, replace, debounce, $$ } from '../core/dom.js';
import { api, friendlyError } from '../core/api.js';
import { store } from '../core/store.js';
import { dropdown, toast } from './overlay.js';
import { emptyState, skeletonRows } from './widgets.js';

/**
 * new DataTable({
 *   id, endpoint, columns: [{ key, label, render?, sortable?, num?, width?, hide?, hideSm? }],
 *   filters: [{ key, label, type: 'select'|'date'|'text', options: [{value,label}]|fn }],
 *   search: true, pageSize, defaultSort: '-sold_at', params: {} | () => {}, onRow(row), rowKey, selectable, bulkActions: [{label, onClick(rows)}],
 *   exportKey (report key) | exportUrl, emptyTitle, emptyText, emptyAction, toolbar: [Nodes]
 * }).mount(container)
 */
export class DataTable {
  constructor(opts) {
    this.o = { pageSize: 25, search: true, rowKey: 'id', columns: [], filters: [], ...opts };
    this.state = { page: 1, size: this.o.pageSize, sort: this.o.defaultSort || null, q: '', filters: {}, rows: [], total: 0, pages: 0, loading: false, selected: new Set() };
    if (this.o.id) {
      const saved = store.filters(this.o.id);
      this.state.q = saved.q || ''; this.state.filters = { ...saved }; delete this.state.filters.q; delete this.state.filters.sort; delete this.state.filters.size;
      if (saved.sort) this.state.sort = saved.sort; if (saved.size) this.state.size = saved.size;
      this.hiddenCols = new Set(store.columns(this.o.id) || this.o.columns.filter(c => c.hide).map(c => c.key));
    } else this.hiddenCols = new Set(this.o.columns.filter(c => c.hide).map(c => c.key));
    this.abort = null;
  }

  persist() { if (this.o.id) store.filters(this.o.id, { ...this.state.filters, q: this.state.q, sort: this.state.sort, size: this.state.size }); }

  mount(container) {
    this.root = h('div.card');
    this.tools = h('div.table-tools');
    this.bulk = h('div.bulk-bar', { hidden: true });
    this.wrap = h('div.table-wrap');
    this.foot = h('div.table-foot');
    this.root.append(this.tools, this.bulk, this.wrap, this.foot);
    container.appendChild(this.root);
    this.renderTools();
    this.load();
    return this;
  }

  renderTools() {
    clear(this.tools);
    if (this.o.search) {
      const input = h('input.input', { type: 'search', placeholder: this.o.searchPlaceholder || 'Buscar…', value: this.state.q, 'aria-label': 'Buscar' });
      input.addEventListener('input', debounce(() => { this.state.q = input.value.trim(); this.state.page = 1; this.persist(); this.load(); }, 350));
      this.tools.appendChild(h('div.search', icon('search'), input));
    }
    for (const f of this.o.filters) {
      const val = this.state.filters[f.key] ?? '';
      if (f.type === 'select') {
        const opts = typeof f.options === 'function' ? f.options() : f.options;
        const sel = h('select.select.select--sm', { 'aria-label': f.label, style: { width: 'auto', minWidth: '140px' } }, h('option', { value: '' }, f.label), opts.map(o => h('option', { value: o.value, selected: String(o.value) === String(val) }, o.label)));
        sel.addEventListener('change', () => this.setFilter(f.key, sel.value));
        this.tools.appendChild(sel);
      } else if (f.type === 'date') {
        const inp = h('input.input.input--sm', { type: 'date', value: val, 'aria-label': f.label, title: f.label, style: { width: 'auto' } });
        inp.addEventListener('change', () => this.setFilter(f.key, inp.value));
        this.tools.appendChild(h('div.row.gap-1', h('span.text-xs.text-3', f.label), inp));
      } else if (f.type === 'daterange') {
        const from = h('input.input.input--sm', { type: 'date', value: this.state.filters[f.key + '_from'] || '', 'aria-label': 'Desde', style: { width: 'auto' } });
        const to = h('input.input.input--sm', { type: 'date', value: this.state.filters[f.key + '_to'] || '', 'aria-label': 'Hasta', style: { width: 'auto' } });
        from.addEventListener('change', () => this.setFilter(f.key + '_from', from.value)); to.addEventListener('change', () => this.setFilter(f.key + '_to', to.value));
        this.tools.appendChild(h('div.row.gap-1', h('span.text-xs.text-3', f.label), from, h('span.text-3', '–'), to));
      }
    }
    if (Object.keys(this.state.filters).length || this.state.q) this.tools.appendChild(h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => { this.state.filters = {}; this.state.q = ''; this.state.page = 1; this.persist(); this.renderTools(); this.load(); } }, icon('x'), 'Limpiar'));
    this.tools.appendChild(h('div.toolbar__spacer'));
    (this.o.toolbar || []).forEach(n => this.tools.appendChild(n));
    // Columnas configurables
    const colBtn = h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', 'aria-label': 'Columnas', 'data-tip': 'Columnas' }, icon('columns'));
    this.tools.appendChild(dropdown(colBtn, () => [{ header: 'Columnas' }, ...this.o.columns.filter(c => c.key !== '_actions').map(c => ({ label: (this.hiddenCols.has(c.key) ? '○ ' : '● ') + c.label, onClick: () => { this.hiddenCols.has(c.key) ? this.hiddenCols.delete(c.key) : this.hiddenCols.add(c.key); if (this.o.id) store.columns(this.o.id, [...this.hiddenCols]); this.renderTable(); } }))]));
    if (this.o.exportKey || this.o.exportUrl) {
      const exBtn = h('button.btn.btn--secondary.btn--sm', { type: 'button' }, icon('download'), h('span.hide-mobile', 'Exportar'));
      this.tools.appendChild(dropdown(exBtn, [
        { label: 'Excel (.xlsx)', icon: 'file', onClick: () => this.export('xlsx') }, { label: 'CSV', icon: 'file', onClick: () => this.export('csv') },
      ]));
    }
    const refresh = h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', 'aria-label': 'Actualizar', 'data-tip': 'Actualizar', onclick: () => this.load() }, icon('refresh'));
    this.tools.appendChild(refresh);
  }

  setFilter(key, value) { if (value) this.state.filters[key] = value; else delete this.state.filters[key]; this.state.page = 1; this.persist(); this.renderTools(); this.load(); }
  setParams(patch) { this.o.params = { ...(typeof this.o.params === 'function' ? this.o.params() : this.o.params), ...patch }; this.state.page = 1; this.load(); }

  params() {
    const base = typeof this.o.params === 'function' ? this.o.params() : (this.o.params || {});
    const f = {};
    for (const [k, v] of Object.entries(this.state.filters)) { if (k.endsWith('_from')) f.from = v; else if (k.endsWith('_to')) f.to = v + 'T23:59:59'; else f[k] = v; }
    return { ...base, ...f, page: this.state.page, size: this.state.size, sort: this.state.sort || undefined, q: this.state.q || undefined };
  }

  async export(format) {
    try {
      toast.info('Preparando exportación…', { timeout: 2000 });
      if (this.o.exportUrl) await api.download(this.o.exportUrl, { ...this.params(), format, size: 5000, page: 1 });
      else await api.download(`/reports/${this.o.exportKey}`, { ...this.params(), format });
    } catch (e) { toast.error(friendlyError(e)); }
  }

  async load() {
    this.abort?.abort(); this.abort = new AbortController();
    this.state.loading = true; this.renderTable();
    try {
      const data = await api.get(this.o.endpoint, this.params(), { signal: this.abort.signal });
      const rows = Array.isArray(data) ? data : (data.data || data.rows || []);
      this.state.rows = this.o.transform ? this.o.transform(rows, data) : rows;
      this.state.total = data.total ?? rows.length; this.state.pages = data.pages ?? 1;
      this.state.loading = false;
      this.renderTable();
      this.o.onLoad?.(data);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      this.state.loading = false;
      replace(this.wrap, h('div.empty', h('div.empty__icon', icon('alertCircle')), h('div.empty__title', 'No se pudo cargar'), h('div.empty__text', friendlyError(e)), h('button.btn.btn--secondary.btn--sm', { onclick: () => this.load() }, 'Reintentar')));
      clear(this.foot);
    }
  }

  visibleCols() { return this.o.columns.filter(c => !this.hiddenCols.has(c.key)); }

  renderTable() {
    const cols = this.visibleCols();
    if (this.state.loading && !this.state.rows.length) { replace(this.wrap, skeletonRows(6)); return; }
    if (!this.state.loading && !this.state.rows.length) {
      replace(this.wrap, emptyState({ icon: this.o.emptyIcon || 'inbox', title: this.o.emptyTitle || 'Sin resultados', text: this.state.q || Object.keys(this.state.filters).length ? 'Prueba con otros filtros o términos.' : (this.o.emptyText || ''), action: this.o.emptyAction }));
      replace(this.foot, h('span', '0 registros'));
      return;
    }
    const thead = h('thead', h('tr', this.o.selectable ? h('th', { style: { width: '36px' } }, h('input', { type: 'checkbox', 'aria-label': 'Seleccionar todo', onchange: e => { this.state.rows.forEach(r => e.target.checked ? this.state.selected.add(r[this.o.rowKey]) : this.state.selected.delete(r[this.o.rowKey])); this.renderTable(); } })) : null,
      cols.map(c => {
        const sortKey = c.sortKey || c.key; const active = this.state.sort && this.state.sort.replace('-', '') === sortKey;
        const th = h(`th${c.num ? '.num' : ''}${c.sortable !== false && c.key !== '_actions' ? '.sortable' : ''}${c.hideSm ? '.hide-sm' : ''}`, { style: c.width ? { width: c.width } : null, 'aria-sort': active ? (this.state.sort.startsWith('-') ? 'descending' : 'ascending') : null }, c.label,
          c.sortable !== false && c.key !== '_actions' ? h('span.sort-ind', active ? (this.state.sort.startsWith('-') ? '▼' : '▲') : '⇅') : null);
        if (c.sortable !== false && c.key !== '_actions') th.addEventListener('click', () => { this.state.sort = active && !this.state.sort.startsWith('-') ? '-' + sortKey : sortKey; this.persist(); this.load(); });
        return th;
      })));
    const tbody = h('tbody', this.state.rows.map(row => {
      const key = row[this.o.rowKey];
      const tr = h(`tr${this.o.onRow ? '.clickable' : ''}`, { 'aria-selected': this.state.selected.has(key) ? 'true' : null });
      if (this.o.selectable) tr.appendChild(h('td', h('input', { type: 'checkbox', checked: this.state.selected.has(key), 'aria-label': 'Seleccionar', onclick: e => e.stopPropagation(), onchange: e => { e.target.checked ? this.state.selected.add(key) : this.state.selected.delete(key); this.renderBulk(); tr.setAttribute('aria-selected', e.target.checked); } })));
      for (const c of cols) {
        const v = c.render ? c.render(row, this) : row[c.key];
        tr.appendChild(h(`td${c.num ? '.num' : ''}${c.key === '_actions' ? '.actions' : ''}${c.hideSm ? '.hide-sm' : ''}${c.cls ? '.' + c.cls : ''}`, v == null ? '—' : v));
      }
      if (this.o.onRow) tr.addEventListener('click', (e) => { if (e.target.closest('button, a, input, .dropdown')) return; this.o.onRow(row, tr); });
      return tr;
    }));
    replace(this.wrap, h(`table.table${this.o.compact ? '.table--compact' : ''}`, thead, tbody));
    if (this.state.loading) this.wrap.style.opacity = '0.5'; else this.wrap.style.opacity = '';
    this.renderFoot(); this.renderBulk();
  }

  renderFoot() {
    const { page, pages, total, size } = this.state;
    const from = (page - 1) * size + 1, to = Math.min(total, page * size);
    const sizes = h('select.select.select--sm', { 'aria-label': 'Por página', style: { width: 'auto' } }, [10, 25, 50, 100].map(n => h('option', { value: n, selected: n === size }, `${n} / pág.`)));
    sizes.addEventListener('change', () => { this.state.size = +sizes.value; this.state.page = 1; this.persist(); this.load(); });
    const btn = (lbl, p, dis) => h('button.btn.btn--ghost.btn--sm', { type: 'button', disabled: dis, onclick: () => { this.state.page = p; this.load(); this.root.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, lbl);
    const pagesEls = [];
    const win = [...new Set([1, page - 1, page, page + 1, pages].filter(p => p >= 1 && p <= pages))].sort((a, b) => a - b);
    let last = 0; for (const p of win) { if (p - last > 1) pagesEls.push(h('span.text-3', '…')); pagesEls.push(h(`button.btn.btn--sm${p === page ? '.btn--soft' : '.btn--ghost'}`, { type: 'button', onclick: () => { this.state.page = p; this.load(); } }, String(p))); last = p; }
    replace(this.foot, h('span', total ? `${from}–${to} de ${total.toLocaleString('es-MX')}` : '0 registros'), h('div.row.gap-2', sizes, h('div.pager', btn(icon('chevronLeft'), page - 1, page <= 1), ...pagesEls, btn(icon('chevronRight'), page + 1, page >= pages))));
  }

  renderBulk() {
    const n = this.state.selected.size;
    if (!this.o.selectable || !n) { this.bulk.hidden = true; return; }
    this.bulk.hidden = false;
    replace(this.bulk, h('span', `${n} seleccionados`), ...(this.o.bulkActions || []).map(a => h(`button.btn.btn--sm.${a.danger ? 'btn--danger-soft' : 'btn--secondary'}`, { type: 'button', onclick: () => a.onClick(this.selectedRows(), this) }, a.label)),
      h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => { this.state.selected.clear(); this.renderTable(); } }, 'Quitar selección'));
  }
  selectedRows() { return this.state.rows.filter(r => this.state.selected.has(r[this.o.rowKey])); }
  clearSelection() { this.state.selected.clear(); this.renderBulk(); }
  reload() { return this.load(); }
}
