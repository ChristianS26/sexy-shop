// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — Estado global ligero y preferencias persistentes
// ═══════════════════════════════════════════════════════════════════════════
import { CONFIG } from './config.js';

function load() { try { return JSON.parse(localStorage.getItem(CONFIG.PREFS_KEY) || '{}'); } catch { return {}; } }

const listeners = new Map();
export const store = {
  state: {
    prefs: load(),            // { theme, collapsed, discreet, branch, range, filters: { module: {...} }, columns: { table: [...] } }
    branch: null,             // sucursal seleccionada globalmente (null = todas / por defecto)
    range: 'last30',          // preset de fechas global para analytics
    customRange: null,        // { from, to }
    unreadAlerts: 0,
  },
  get(k) { return store.state[k]; },
  set(k, v) { store.state[k] = v; (listeners.get(k) || []).forEach(fn => fn(v)); (listeners.get('*') || []).forEach(fn => fn(k, v)); },
  on(k, fn) { listeners.set(k, [...(listeners.get(k) || []), fn]); return () => listeners.set(k, (listeners.get(k) || []).filter(f => f !== fn)); },
  pref(k, v) {
    if (v === undefined) return store.state.prefs[k];
    store.state.prefs[k] = v; localStorage.setItem(CONFIG.PREFS_KEY, JSON.stringify(store.state.prefs)); return v;
  },
  /** Filtros persistentes por módulo (no se pierden al navegar). */
  filters(module, patch) {
    const all = store.state.prefs.filters || {};
    if (patch === undefined) return all[module] || {};
    all[module] = { ...(all[module] || {}), ...patch };
    Object.keys(all[module]).forEach(k => { if (all[module][k] === '' || all[module][k] == null) delete all[module][k]; });
    store.pref('filters', all);
    return all[module];
  },
  columns(table, cols) {
    const all = store.state.prefs.columns || {};
    if (cols === undefined) return all[table];
    all[table] = cols; store.pref('columns', all); return cols;
  },
};

// Restaurar preferencias
store.state.branch = store.state.prefs.branch || null;
store.state.range = store.state.prefs.range || 'last30';
store.state.customRange = store.state.prefs.customRange || null;

export function rangeParams() {
  const r = store.get('range');
  const p = { range: r };
  if (r === 'custom' && store.get('customRange')) Object.assign(p, store.get('customRange'));
  if (store.get('branch')) p.branch = store.get('branch');
  return p;
}
