// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — Arranque: sesión, navegación, header, búsqueda global, router
// ═══════════════════════════════════════════════════════════════════════════
import { CONFIG } from './core/config.js';
import { api, friendlyError } from './core/api.js';
import { auth, session, me } from './core/auth.js';
import { store } from './core/store.js';
import { router } from './core/router.js';
import { h, icon, replace, clear, $, $$, fmt } from './core/dom.js';
import { toast, openPalette, dropdown } from './ui/overlay.js';
import { NAV, MODULES } from './modules/index.js';
import { openProductQuickView } from './modules/products.js';

const app = $('#app'), sidebar = $('#sidebar'), header = $('#header'), content = $('#content');

// ── Tema / preferencias ─────────────────────────────────────────────────────
function applyTheme(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
function toggleTheme() { const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const next = cur === 'dark' ? 'light' : 'dark'; store.pref('theme', next); applyTheme(next); toast.info(next === 'dark' ? 'Modo oscuro activado' : 'Modo claro activado', { timeout: 1500 }); }
function applyDiscreet(on) { document.body.classList.toggle('discreet', !!on); }

// ── Sidebar ─────────────────────────────────────────────────────────────────
function renderSidebar() {
  const logoBox = h('div.sidebar__logo', h('span', 'S'));
  const img = new Image(); img.src = 'img/logo.svg'; img.alt = 'SONROJA'; img.onload = () => replace(logoBox, img);
  const brand = h('a.sidebar__brand', { href: '#/dashboard', 'aria-label': 'Inicio' }, logoBox, h('div', h('div.sidebar__wordmark', 'SONROJA'), h('div.sidebar__tagline', 'Centro de control')));
  const nav = h('nav.sidebar__nav');
  const hash = location.hash.replace(/^#/, '').split('?')[0];
  for (const section of NAV) {
    const items = section.items.filter(it => me.can(...(it.perms || [])));
    if (!items.length) continue;
    if (section.label) nav.appendChild(h('div.sidebar__section', section.label));
    for (const it of items) {
      if (it.children) {
        const kids = it.children.filter(k => me.can(...(k.perms || [])));
        if (!kids.length) continue;
        const open = kids.some(k => hash.startsWith(k.path)) || store.pref('nav_' + it.label) === true;
        const details = h('details.sidebar__group', { open }, h('summary', icon(it.icon), h('span', it.label), icon('chevronDown', 'chev')), kids.map(k => link(k, hash)));
        details.addEventListener('toggle', () => store.pref('nav_' + it.label, details.open));
        nav.appendChild(details);
      } else nav.appendChild(link(it, hash));
    }
  }
  const userMenu = dropdown(h('button.sidebar__user.w-full', { type: 'button', 'aria-label': 'Menú de usuario' }, h('div.avatar', fmt.initials(me.user)), h('div.flex-1', { style: { textAlign: 'left', minWidth: 0 } }, h('div.sidebar__user-name', fmt.name(me.user)), h('div.sidebar__user-role', me.roleLabel))),
    () => [
      { header: me.org?.name || 'SONROJA' },
      { label: document.documentElement.getAttribute('data-theme') === 'dark' ? 'Modo claro' : 'Modo oscuro', icon: document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon', onClick: toggleTheme },
      { label: document.body.classList.contains('discreet') ? 'Desactivar modo discreto' : 'Modo discreto (ocultar nombres)', icon: document.body.classList.contains('discreet') ? 'eye' : 'eyeOff', onClick: () => { const on = !document.body.classList.contains('discreet'); store.pref('discreet', on); applyDiscreet(on); } },
      { label: 'Mi perfil', icon: 'user', onClick: () => router.go('/profile') },
      { sep: true },
      { label: 'Cerrar sesión', icon: 'logout', danger: true, onClick: () => auth.logout() },
    ], { align: 'left' });
  replace(sidebar, brand, nav, h('div.sidebar__footer', userMenu));
}
function link(it, hash) {
  const active = hash === it.path || (it.path !== '/dashboard' && hash.startsWith(it.path + '/')) || (it.match && it.match.some(m => hash.startsWith(m)));
  const a = h('a.sidebar__link', { href: '#' + it.path, 'aria-current': active ? 'page' : null, onclick: () => app.removeAttribute('data-drawer') }, icon(it.icon), h('span', it.label));
  if (it.badge === 'alerts') { const b = h('span.badge.badge--primary', { hidden: true }); a.appendChild(b); store.on('unreadAlerts', n => { b.hidden = !n; b.textContent = n; }); if (store.get('unreadAlerts')) { b.hidden = false; b.textContent = store.get('unreadAlerts'); } }
  return a;
}
function updateActive() { const hash = location.hash.replace(/^#/, '').split('?')[0]; $$('.sidebar__link', sidebar).forEach(a => { const p = a.getAttribute('href').slice(1); const active = hash === p || (p !== '/dashboard' && hash.startsWith(p + '/')); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); }

// ── Header ──────────────────────────────────────────────────────────────────
let titleEl, crumbEl;
function renderHeader() {
  titleEl = h('div.header__title', 'SONROJA'); crumbEl = h('div.header__crumb', '');
  const menuBtn = h('button.btn.btn--ghost.btn--icon.only-mobile', { type: 'button', 'aria-label': 'Menú', onclick: () => app.toggleAttribute('data-drawer') }, icon('menu'));
  const collapseBtn = h('button.btn.btn--ghost.btn--icon.hide-mobile', { type: 'button', 'aria-label': 'Contraer menú', onclick: () => { const c = app.toggleAttribute('data-collapsed'); store.pref('collapsed', c); } }, icon('menu'));
  const search = h('button.header__search.hide-mobile', { type: 'button', onclick: openSearch }, icon('search'), h('span', 'Buscar…'), h('kbd', navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K'));
  const searchMobile = h('button.btn.btn--ghost.btn--icon.only-mobile', { type: 'button', 'aria-label': 'Buscar', onclick: openSearch }, icon('search'));
  const alertsBtn = h('a.btn.btn--ghost.btn--icon', { href: '#/alerts', 'aria-label': 'Alertas', style: { position: 'relative' } }, icon('bell'), h('span.count.topbar__count', { id: 'alertCount', hidden: true }));
  store.on('unreadAlerts', n => { const c = $('#alertCount'); if (c) { c.hidden = !n; c.textContent = n > 99 ? '99+' : n; } });
  const posBtn = me.can('sales.create') ? h('a.btn.btn--primary.btn--sm.hide-mobile', { href: '#/pos' }, icon('cart'), 'Vender') : null;
  replace(header, menuBtn, collapseBtn, h('div', { style: { minWidth: 0 } }, crumbEl, titleEl), h('div.header__spacer'), search, searchMobile, posBtn, alertsBtn);
}
function setTitle(title, crumb = '') { if (titleEl) titleEl.textContent = title; if (crumbEl) crumbEl.textContent = crumb; document.title = `${title} · SONROJA`; }

// ── Búsqueda global (Ctrl/Cmd + K) ──────────────────────────────────────────
function openSearch() {
  const shortcuts = NAV.flatMap(s => s.items).flatMap(it => it.children ? it.children : [it]).filter(it => me.can(...(it.perms || []))).map(it => ({ title: it.label, icon: it.icon, path: it.path }));
  openPalette({
    shortcuts: shortcuts.slice(0, 12),
    search: async (q) => {
      const r = await api.get('/search', { q }).catch(() => ({}));
      return [
        { label: 'Ir a', items: shortcuts.filter(s => s.title.toLowerCase().includes(q.toLowerCase())).slice(0, 4) },
        { label: 'Productos', items: (r.products || []).map(p => ({ title: p.name, sub: [p.sku, p.barcode].filter(Boolean).join(' · '), meta: `${fmt.money(p.price)} · ${p.stock} en stock`, icon: 'box', image: p.image_url, product: p })) },
        { label: 'Clientes', items: (r.customers || []).map(c => ({ title: fmt.name(c), sub: c.phone || c.email || '', meta: `${c.purchases} compras`, icon: 'user', path: `/customers/${c.id}` })) },
        { label: 'Ventas', items: (r.sales || []).map(s => ({ title: s.folio, sub: fmt.datetime(s.sold_at), meta: fmt.money(s.total), icon: 'receipt', path: `/sales/${s.id}` })) },
        { label: 'Proveedores', items: (r.suppliers || []).map(s => ({ title: s.name, sub: s.contact_name || s.phone || '', icon: 'truck', path: `/suppliers/${s.id}` })) },
        { label: 'Órdenes de compra', items: (r.purchases || []).map(p => ({ title: p.folio, sub: p.status, meta: fmt.money(p.total), icon: 'clipboard', path: `/purchases/${p.id}` })) },
      ];
    },
    onPick: (it) => { if (it.product) openProductQuickView(it.product.id); else if (it.path) router.go(it.path); },
  });
}
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } });

// ── Router ──────────────────────────────────────────────────────────────────
let currentCleanup = null;
async function navigate(match) {
  if (!match) { router.go('/dashboard', true); return; }
  const mod = MODULES[match.route.meta.module];
  if (!mod) { router.go('/dashboard', true); return; }
  if (mod.perms && !me.can(...mod.perms)) { content.replaceChildren(h('div.empty', h('div.empty__icon', icon('lock')), h('div.empty__title', 'Sin acceso'), h('div.empty__text', 'Tu rol no tiene permiso para ver esta sección.'))); setTitle('Sin acceso'); return; }
  currentCleanup?.(); currentCleanup = null;
  updateActive(); app.removeAttribute('data-drawer');
  setTitle(mod.title, mod.crumb || '');
  content.scrollTop = 0; window.scrollTo({ top: 0 });
  clear(content);
  try {
    const result = await mod.render(content, { params: match.params, setTitle, navigate: router.go, me, query: match.params });
    if (typeof result === 'function') currentCleanup = result;
  } catch (e) {
    console.error(e);
    replace(content, h('div.empty', h('div.empty__icon', icon('alertCircle')), h('div.empty__title', 'No se pudo cargar esta sección'), h('div.empty__text', friendlyError(e) || 'Intenta de nuevo.'), h('button.btn.btn--secondary', { onclick: () => router.dispatch() }, 'Reintentar')));
  }
}

// ── Alertas no leídas (polling suave) ───────────────────────────────────────
async function pollAlerts() {
  try { const s = await api.get('/alerts/summary'); store.set('unreadAlerts', s.unread || 0); } catch { /* silencioso */ }
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  if (!session.get()) { location.replace('login.html'); return; }
  if (session.expired() && !(await session.refresh())) { location.replace('login.html?expired=1'); return; }
  applyTheme(store.pref('theme')); applyDiscreet(store.pref('discreet'));
  if (store.pref('collapsed')) app.setAttribute('data-collapsed', '1');
  $('#scrim').addEventListener('click', () => app.removeAttribute('data-drawer'));
  const isLogin = location.hash.includes('login=1');
  try {
    me.set(await api.get('/auth/me', isLogin ? { login: 'true' } : {}));
  } catch (e) {
    if (e.status === 403) { content.replaceChildren(h('div.empty', h('div.empty__icon', icon('lock')), h('div.empty__title', 'Cuenta sin acceso'), h('div.empty__text', e.message), h('button.btn.btn--secondary', { onclick: () => auth.logout() }, 'Cerrar sesión'))); app.removeAttribute('aria-busy'); return; }
    if (e.status === 404 || e.status === 500) { content.replaceChildren(h('div.empty', h('div.empty__icon', icon('user')), h('div.empty__title', 'Tu usuario no está dado de alta en el ERP'), h('div.empty__text', 'Pide a un administrador que te registre como usuario del sistema.'), h('button.btn.btn--secondary', { onclick: () => auth.logout() }, 'Cerrar sesión'))); app.removeAttribute('aria-busy'); return; }
    throw e;
  }
  if (isLogin) history.replaceState(null, '', location.hash.replace(/[?&]login=1/, ''));
  if (me.settings?.security?.discreet_mode_default && store.pref('discreet') == null) applyDiscreet(true);
  store.set('unreadAlerts', me.data.unread_alerts || 0);
  renderSidebar(); renderHeader();
  for (const [key, mod] of Object.entries(MODULES)) (mod.routes || [mod.route]).forEach(r => router.add(r, null, { module: key }));
  router.start(navigate);
  app.removeAttribute('aria-busy');
  setInterval(pollAlerts, 90_000);
  window.addEventListener('hashchange', updateActive);
}
boot().catch(e => { console.error(e); content.replaceChildren(h('div.empty', h('div.empty__title', 'No se pudo iniciar'), h('div.empty__text', friendlyError(e) || 'Revisa tu conexión.'), h('button.btn.btn--secondary', { onclick: () => location.reload() }, 'Reintentar'))); });
