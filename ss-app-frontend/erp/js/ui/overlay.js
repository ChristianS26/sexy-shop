// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — Overlays: modal, drawer, confirm, toast, dropdown, command palette
// ═══════════════════════════════════════════════════════════════════════════
import { h, icon, clear, $, $$ } from '../core/dom.js';

const stack = [];
function trapFocus(el) {
  const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', el).filter(x => !x.disabled && x.offsetParent !== null);
  if (f.length) f[0].focus();
  el.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const items = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', el).filter(x => !x.disabled && x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) { const top = stack[stack.length - 1]; if (top.closeOnEsc !== false) top.close(); } });

/**
 * openModal({ title, sub, body, footer, size, onClose }) → { el, close, setBusy }
 * body/footer: Node | Node[] | (ctx) => Node
 */
export function openModal({ title, sub, body, footer, size = '', drawer = false, closeOnEsc = true, onClose, cls = '', print = false }) {
  const ctx = {};
  const panel = h(drawer ? `div.drawer${size ? '.drawer--' + size : ''}` : `div.modal${size ? '.modal--' + size : ''}${cls ? '.' + cls : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : 'Diálogo' });
  const overlay = h(`div.overlay${drawer ? '.overlay--drawer' : ''}${print ? '.overlay--print' : ''}`, { onclick: e => { if (e.target === overlay && closeOnEsc) ctx.close(); } }, panel);
  const headCls = drawer ? 'drawer__head' : 'modal__head';
  const closeBtn = h('button.btn.btn--ghost.btn--icon', { type: 'button', 'aria-label': 'Cerrar', onclick: () => ctx.close() }, icon('x'));
  if (title) panel.appendChild(h(`div.${headCls}`, h('div', h(drawer ? 'h2.modal__title' : 'h2.modal__title', title), sub ? h('p.modal__sub', sub) : null), closeBtn));
  const bodyEl = h(drawer ? 'div.drawer__body' : 'div.modal__body');
  const resolvedBody = typeof body === 'function' ? body(ctx) : body;
  if (resolvedBody) bodyEl.append(...[resolvedBody].flat().filter(Boolean));
  panel.appendChild(bodyEl);
  const footEl = footer ? h(drawer ? 'div.drawer__foot' : 'div.modal__foot', ...[typeof footer === 'function' ? footer(ctx) : footer].flat().filter(Boolean)) : null;
  if (footEl) panel.appendChild(footEl);
  const prevFocus = document.activeElement;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  ctx.el = panel; ctx.body = bodyEl; ctx.overlay = overlay; ctx.closeOnEsc = closeOnEsc;
  ctx.close = (result) => {
    if (!overlay.isConnected) return;
    overlay.remove(); stack.splice(stack.indexOf(ctx), 1);
    if (!stack.length) document.body.style.overflow = '';
    prevFocus?.focus?.(); onClose?.(result);
  };
  ctx.setBusy = (busy) => { $$('.btn', footEl || panel).forEach(b => { b.disabled = busy; }); };
  ctx.setTitle = (t) => { const el = $('.modal__title', panel); if (el) el.textContent = t; };
  stack.push(ctx);
  requestAnimationFrame(() => trapFocus(panel));
  return ctx;
}
export const openDrawer = (opts) => openModal({ ...opts, drawer: true });

/** confirm({ title, text, confirmText, danger }) → Promise<boolean> */
export function confirm({ title = '¿Confirmar?', text = '', confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false, input = null }) {
  return new Promise(resolve => {
    let inputEl = null;
    if (input) inputEl = h(input.multiline ? 'textarea.textarea' : 'input.input', { placeholder: input.placeholder || '', required: !!input.required, rows: 3 });
    const m = openModal({
      title, body: [text ? h('p.text-2', text) : null, inputEl ? h('div.field.mt-4', h('label.field__label', input.label || ''), inputEl) : null],
      footer: (ctx) => [
        h('button.btn.btn--secondary', { type: 'button', onclick: () => ctx.close(false) }, cancelText),
        h(`button.btn.${danger ? 'btn--danger' : 'btn--primary'}`, { type: 'button', onclick: () => {
          if (inputEl && input.required && !inputEl.value.trim()) { inputEl.setAttribute('aria-invalid', 'true'); inputEl.focus(); return; }
          ctx.close(inputEl ? inputEl.value.trim() : true);
        } }, confirmText),
      ],
      onClose: (r) => resolve(r === undefined ? false : r),
    });
    if (inputEl) setTimeout(() => inputEl.focus(), 50);
    return m;
  });
}

/** Toasts */
let toastRoot = null;
export function toast(message, { type = 'success', title = null, timeout = 4200 } = {}) {
  if (!toastRoot) { toastRoot = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastRoot); }
  const ic = { success: 'checkCircle', error: 'alertCircle', warning: 'alertTriangle', info: 'info' }[type] || 'info';
  const t = h(`div.toast.toast--${type}`, icon(ic, 'toast__icon'), h('div', title ? h('div.toast__title', title) : null, h('div', { class: title ? 'toast__text' : '' }, message)),
    h('button.toast__close', { 'aria-label': 'Cerrar', onclick: () => t.remove() }, icon('x')));
  toastRoot.appendChild(t);
  if (timeout) setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, timeout);
  return t;
}
toast.error = (m, o) => toast(m, { type: 'error', timeout: 6000, ...o });
toast.info = (m, o) => toast(m, { type: 'info', ...o });
toast.warn = (m, o) => toast(m, { type: 'warning', ...o });

/** Dropdown menu: dropdown(triggerEl, [{ label, icon, onClick, danger, sep, header }]) */
export function dropdown(trigger, items, { align = 'right' } = {}) {
  const wrap = h('div.dropdown', trigger);
  let menu = null;
  const close = () => { menu?.remove(); menu = null; document.removeEventListener('click', onDoc, true); };
  const onDoc = (e) => { if (!wrap.contains(e.target)) close(); };
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) return close();
    const list = typeof items === 'function' ? items() : items;
    menu = h(`div.menu${align === 'left' ? '.menu--left' : ''}`, { role: 'menu' }, list.filter(Boolean).map(it => it.sep ? h('div.menu__sep') : it.header ? h('div.menu__label', it.header)
      : h(`button.menu__item${it.danger ? '.menu__item--danger' : ''}`, { type: 'button', role: 'menuitem', disabled: it.disabled, onclick: () => { close(); it.onClick?.(); } }, it.icon ? icon(it.icon) : null, it.label)));
    wrap.appendChild(menu);
    setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  });
  return wrap;
}

/** Paleta de comandos (Ctrl/Cmd+K) */
export function openPalette({ placeholder = 'Buscar productos, clientes, ventas, folios…', search, onPick, shortcuts = [] }) {
  const input = h('input.palette__input', { placeholder, autocomplete: 'off', spellcheck: false });
  const results = h('div.palette__results');
  const panel = h('div.palette', { role: 'dialog', 'aria-label': 'Búsqueda global' }, input, results);
  const overlay = h('div.overlay', { onclick: e => { if (e.target === overlay) ctx.close(); } }, panel);
  const ctx = { close: () => { overlay.remove(); stack.splice(stack.indexOf(ctx), 1); document.body.style.overflow = ''; }, closeOnEsc: true };
  stack.push(ctx); document.body.appendChild(overlay); document.body.style.overflow = 'hidden';
  let items = []; let sel = 0; let seq = 0;
  const render = (groups) => {
    clear(results); items = []; sel = 0;
    for (const g of groups) {
      if (!g.items?.length) continue;
      results.appendChild(h('div.palette__group', g.label));
      g.items.forEach(it => {
        const el = h('div.palette__item', { role: 'option', onclick: () => { ctx.close(); onPick(it); } }, it.icon ? h('span.thumb', it.image ? h('img', { src: it.image, alt: '' }) : icon(it.icon)) : null,
          h('div.flex-1', h('div.strong', it.title), it.sub ? h('div.text-xs.text-3', it.sub) : null), it.meta ? h('span.palette__meta', it.meta) : null);
        items.push({ el, it }); results.appendChild(el);
      });
    }
    if (!items.length) results.appendChild(h('div.empty', { style: { padding: '28px' } }, h('div.empty__text', input.value ? 'Sin resultados.' : 'Escribe para buscar o elige un atajo.')));
    highlight();
  };
  const highlight = () => items.forEach((x, i) => x.el.setAttribute('aria-selected', i === sel ? 'true' : 'false'));
  const showShortcuts = () => render([{ label: 'Ir a', items: shortcuts }]);
  showShortcuts();
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return showShortcuts();
    const my = ++seq;
    timer = setTimeout(async () => { const groups = await search(q); if (my === seq) render(groups); }, 220);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); highlight(); items[sel]?.el.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); highlight(); }
    if (e.key === 'Enter' && items[sel]) { e.preventDefault(); ctx.close(); onPick(items[sel].it); }
  });
  setTimeout(() => input.focus(), 30);
  return ctx;
}
