// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — DOM helpers, formato y utilidades
// ═══════════════════════════════════════════════════════════════════════════
import { CONFIG } from './config.js';

/** Hyperscript mínimo: h('div.card', { onclick }, [children]) — nunca innerHTML con datos. */
export function h(tag, props = {}, ...children) {
  if (Array.isArray(props) || typeof props === 'string' || typeof props === 'number' || props instanceof Node) { children.unshift(props); props = {}; }
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // solo para SVG/iconos estáticos propios
    else if (k in el && k !== 'list' && typeof v !== 'object') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const frag = (...children) => append(document.createDocumentFragment(), children);
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function replace(el, ...children) { clear(el); append(el, children); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Iconos (Lucide-like, trazos finos). Uso: icon('search') */
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 5 5L20 7"/>', chevronDown: '<path d="m6 9 6 6 6-6"/>', chevronRight: '<path d="m9 6 6 6-6 6"/>', chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>', arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>', arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  home: '<path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4h2l2.5 11h11l2-7H7"/>',
  receipt: '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 12h.01M17 12h.01"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V2h6v2M9 11h6M9 15h4"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M22 19c0-2.5-2-4.5-4.5-4.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-7 8-7s8 3 8 7"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  map: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2 2 0 0 0-4-4L4 16z"/><path d="m13 7 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.5 10.6A3 3 0 0 0 13.4 13.5M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4.3M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4.3-1"/>',
  download: '<path d="M12 3v12M6 11l6 6 6-6M4 21h16"/>', upload: '<path d="M12 21V9M6 13l6-6 6 6M4 3h16"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  more: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alertCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  alertTriangle: '<path d="m12 3 10 18H2z"/><path d="M12 10v4M12 18h.01"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 5-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 13A8 8 0 1 1 11 3a6.5 6.5 0 0 0 10 10z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
  sparkles: '<path d="m12 3 1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9z"/><path d="M19 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  barcode: '<path d="M4 5v14M8 5v14M11 5v14M14 5v14M18 5v14M21 5v14"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  inbox: '<path d="M3 13l2-8h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l2 3h4l2-3h5"/>',
  scan: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M3 12h18"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M15 8l3 3M18 5l2 2"/>',
  gift: '<rect x="3" y="8" width="18" height="4"/><path d="M5 12v9h14v-9M12 8v13M12 8a3 3 0 1 1 3-3c0 1.5-3 3-3 3zM12 8a3 3 0 1 0-3-3c0 1.5 3 3 3 3z"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  package: '<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10M8 5l8 4"/>',
  activity: '<path d="M22 12h-4l-3 8-6-16-3 8H2"/>',
  dollar: '<path d="M12 2v20M17 6.5c-1-1.5-3-2-5-2-3 0-5 1.5-5 3.5s2 3 5 3.5 5 1.5 5 3.5-2 3.5-5 3.5c-2 0-4-.5-5-2"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h14v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1"/>',
  store: '<path d="M3 9 5 3h14l2 6"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v9h14v-9M10 21v-6h4v6"/>',
  pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  externalLink: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>',
};
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
  svg.setAttribute('width', '1em'); svg.setAttribute('height', '1em');
  svg.innerHTML = ICONS[name] || ICONS.info;
  return svg;
}

// ── Formato ─────────────────────────────────────────────────────────────────
const nf = new Intl.NumberFormat(CONFIG.LOCALE, { style: 'currency', currency: CONFIG.CURRENCY, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat(CONFIG.LOCALE, { style: 'currency', currency: CONFIG.CURRENCY, maximumFractionDigits: 0 });
const nn = new Intl.NumberFormat(CONFIG.LOCALE, { maximumFractionDigits: 2 });
export const fmt = {
  money: (v, compact = false) => v == null || isNaN(v) ? '—' : compact && Math.abs(v) >= 100000 ? '$' + (v / 1000).toFixed(v >= 1e6 ? 0 : 1) + 'k' : nf.format(Number(v)),
  money0: (v) => v == null || isNaN(v) ? '—' : nf0.format(Number(v)),
  num: (v, d) => v == null || isNaN(v) ? '—' : d != null ? Number(v).toLocaleString(CONFIG.LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }) : nn.format(Number(v)),
  int: (v) => v == null || isNaN(v) ? '—' : Math.round(Number(v)).toLocaleString(CONFIG.LOCALE),
  pct: (v, d = 1) => v == null || isNaN(v) ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(d)} %`,
  pctPlain: (v, d = 1) => v == null || isNaN(v) ? '—' : `${Number(v).toFixed(d)} %`,
  date: (v) => v ? new Date(v).toLocaleDateString(CONFIG.LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: CONFIG.TIMEZONE }) : '—',
  dateShort: (v) => v ? new Date(v).toLocaleDateString(CONFIG.LOCALE, { day: 'numeric', month: 'short', timeZone: CONFIG.TIMEZONE }) : '—',
  time: (v) => v ? new Date(v).toLocaleTimeString(CONFIG.LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE }) : '—',
  datetime: (v) => v ? `${fmt.date(v)} · ${fmt.time(v)}` : '—',
  dateInput: (d = new Date()) => { const z = new Date(d.toLocaleString('en-US', { timeZone: CONFIG.TIMEZONE })); return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`; },
  relative: (v) => {
    if (!v) return '—';
    const diff = (Date.now() - new Date(v).getTime()) / 1000;
    if (diff < 60) return 'hace un momento'; if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`; if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    if (diff < 86400 * 30) return `hace ${Math.floor(diff / 86400)} d`; return fmt.date(v);
  },
  name: (o) => o ? [o.first_name, o.last_name].filter(Boolean).join(' ') || o.name || '—' : '—',
  initials: (o) => { const n = typeof o === 'string' ? o : fmt.name(o); return n.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '?'; },
  hour: (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`,
  dow: (d) => ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d] || '',
  dowLong: (d) => ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d] || '',
  plural: (n, s, p) => `${fmt.int(n)} ${n === 1 ? s : p}`,
  /** Fecha de calendario sin zona ("2026-09-13" o "2026-09-13T00:00:00"): se muestra tal cual, sin convertir de huso. */
  calendarDay: (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(CONFIG.LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; },
  calendarMonth: (v) => { const m = /^(\d{4})-(\d{2})/.exec(String(v || '')); return m ? new Date(+m[1], +m[2] - 1, 1).toLocaleDateString(CONFIG.LOCALE, { month: 'long', year: 'numeric' }) : '—'; },
};

export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
export const qs = (obj) => { const p = new URLSearchParams(); Object.entries(obj || {}).forEach(([k, v]) => { if (v != null && v !== '' && v !== false) p.set(k, v); }); const s = p.toString(); return s ? `?${s}` : ''; };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] ||= []).push(x); return m; }, {});
export function copyText(t) { return navigator.clipboard?.writeText(t); }
export function downloadBlob(blob, filename) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
export function onKey(el, map) { el.addEventListener('keydown', e => { const k = (e.ctrlKey || e.metaKey ? 'mod+' : '') + e.key.toLowerCase(); if (map[k]) { e.preventDefault(); map[k](e); } }); }

/** Semántica de estados para badges */
export const STATUS = {
  sale: { COMPLETED: ['Completada', 'success'], CANCELLED: ['Cancelada', 'danger'], REFUNDED: ['Devuelta', 'warning'], PARTIALLY_REFUNDED: ['Dev. parcial', 'warning'] },
  stock: { OUT: ['Agotado', 'danger'], CRITICAL: ['Crítico', 'danger'], LOW: ['Bajo', 'warning'], HEALTHY: ['Saludable', 'success'], EXCESS: ['Exceso', 'info'] },
  product: { ACTIVE: ['Activo', 'success'], INACTIVE: ['Inactivo', ''], DISCONTINUED: ['Descontinuado', 'danger'], DRAFT: ['Borrador', 'info'] },
  purchase: { DRAFT: ['Borrador', ''], SENT: ['Enviada', 'info'], PARTIAL: ['Parcial', 'warning'], RECEIVED: ['Recibida', 'success'], COMPLETED: ['Completada', 'success'], CANCELLED: ['Cancelada', 'danger'] },
  transfer: { DRAFT: ['Borrador', ''], IN_TRANSIT: ['En tránsito', 'info'], RECEIVED: ['Recibida', 'success'], CANCELLED: ['Cancelada', 'danger'] },
  count: { OPEN: ['Abierto', 'info'], FINALIZED: ['Finalizado', 'success'], CANCELLED: ['Cancelado', 'danger'] },
  shift: { OPEN: ['Abierto', 'success'], CLOSED: ['Cerrado', ''] },
  user: { ACTIVE: ['Activo', 'success'], INACTIVE: ['Inactivo', ''], SUSPENDED: ['Suspendido', 'danger'] },
  generic: { ACTIVE: ['Activo', 'success'], INACTIVE: ['Inactivo', ''], EXPIRED: ['Vencida', 'danger'] },
  alert: { UNREAD: ['Nueva', 'primary'], READ: ['Leída', ''], RESOLVED: ['Resuelta', 'success'] },
  severity: { INFO: ['Info', 'info'], SUCCESS: ['Bien', 'success'], WARNING: ['Atención', 'warning'], CRITICAL: ['Crítico', 'danger'] },
  movement: { PURCHASE: ['Compra', 'success'], SALE: ['Venta', 'primary'], SALE_RETURN: ['Devolución', 'info'], PURCHASE_RETURN: ['Dev. a proveedor', 'warning'], TRANSFER_IN: ['Entrada transf.', 'info'], TRANSFER_OUT: ['Salida transf.', 'info'], ADJUSTMENT_IN: ['Ajuste +', 'success'], ADJUSTMENT_OUT: ['Ajuste −', 'warning'], DAMAGE: ['Merma', 'danger'], LOSS: ['Pérdida', 'danger'], INITIAL_STOCK: ['Inicial', ''], INVENTORY_COUNT: ['Conteo', 'info'] },
  channel: { POS: ['Tienda', 'primary'], ONLINE: ['En línea', 'info'], WHATSAPP: ['WhatsApp', 'success'], MARKETPLACE: ['Marketplace', 'warning'], OTHER: ['Otro', ''] },
  rfm: { CHAMPIONS: ['Champions', 'success'], LOYAL: ['Leales', 'primary'], NEW: ['Nuevos', 'info'], POTENTIAL: ['Potenciales', 'info'], AT_RISK: ['En riesgo', 'warning'], CANT_LOSE: ['No perder', 'warning'], HIBERNATING: ['Dormidos', ''], LOST: ['Perdidos', 'danger'] },
  rotation: { FAST: ['Rápida', 'success'], NORMAL: ['Normal', ''], SLOW: ['Lenta', 'warning'], DEAD: ['Sin movimiento', 'danger'] },
  abc: { A: ['A', 'success'], B: ['B', 'warning'], C: ['C', ''] },
};
/** Texto en español para cualquier código interno conocido (COMPLETED → Completada). */
export function codeLabel(v) {
  if (typeof v !== 'string' || !/^[A-Z][A-Z_]+$/.test(v)) return null;
  for (const k of ['sale', 'purchase', 'transfer', 'stock', 'movement', 'channel', 'rfm', 'rotation', 'shift', 'count', 'generic', 'alert', 'severity']) { const hit = STATUS[k][v]; if (hit) return hit[0]; }
  return ({ CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', MERCADO_PAGO: 'Mercado Pago', OTHER: 'Otro', IMPORT: 'Importado' })[v] || null;
}
export function badge(kind, value, extra = '') {
  const [label, tone] = (STATUS[kind] || {})[value] || [value || '—', ''];
  return h(`span.badge${tone ? '.badge--' + tone : ''}${extra ? '.' + extra : ''}`, label);
}
