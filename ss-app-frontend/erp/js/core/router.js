// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — Router por hash con parámetros, query y guardas de permiso
// ═══════════════════════════════════════════════════════════════════════════
const routes = [];
let current = null;
let onChange = () => {};

export const router = {
  add(pattern, handler, meta = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^\\/?]+)'; }) + '\\/?$');
    routes.push({ pattern, re, keys, handler, meta });
  },
  parse(hash = location.hash) {
    const raw = hash.replace(/^#/, '') || '/';
    const [path, query = ''] = raw.split('?');
    const params = Object.fromEntries(new URLSearchParams(query));
    for (const r of routes) {
      const m = r.re.exec(path);
      if (m) { r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); return { route: r, path, params, query }; }
    }
    return null;
  },
  go(path, replaceState = false) { if (replaceState) location.replace('#' + path.replace(/^#/, '')); else location.hash = path.replace(/^#/, ''); },
  setQuery(obj) {
    const p = router.parse(); if (!p) return;
    const sp = new URLSearchParams(p.query);
    Object.entries(obj).forEach(([k, v]) => { if (v == null || v === '') sp.delete(k); else sp.set(k, v); });
    const q = sp.toString();
    history.replaceState(null, '', '#' + p.path + (q ? '?' + q : ''));
  },
  get current() { return current; },
  start(cb) {
    onChange = cb;
    window.addEventListener('hashchange', () => router.dispatch());
    router.dispatch();
  },
  dispatch() {
    const match = router.parse();
    current = match;
    onChange(match);
  },
  routes,
};
