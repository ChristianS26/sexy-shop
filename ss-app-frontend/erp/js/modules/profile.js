// ═══════════════════════════════════════════════════════════════════════════
// Perfil — contraseña y preferencias personales
// ═══════════════════════════════════════════════════════════════════════════
import { auth, me } from '../core/auth.js';
import { store } from '../core/store.js';
import { h, icon, fmt } from '../core/dom.js';
import { field, setLoading } from '../ui/widgets.js';
import { toast } from '../ui/overlay.js';

export const route = '/profile';
export const title = 'Mi perfil';
export const crumb = 'Cuenta';

export async function render(root) {
  const p1 = field({ label: 'Nueva contraseña', name: 'p1', type: 'password', autocomplete: 'new-password' });
  const p2 = field({ label: 'Confirmar', name: 'p2', type: 'password', autocomplete: 'new-password' });
  const discreet = field({ label: 'Modo discreto: ocultar nombres de clientes en pantalla', name: 'discreet', type: 'switch', value: document.body.classList.contains('discreet') });
  discreet.querySelector('input').addEventListener('change', (e) => { store.pref('discreet', e.target.checked); document.body.classList.toggle('discreet', e.target.checked); });
  root.append(h('div.page-head', h('div', h('h1.page-head__title', fmt.name(me.user)), h('p.page-head__sub', `${me.user?.email} · ${me.roleLabel} · ${me.org?.name}`))),
    h('div.grid.grid--2',
      h('div.card', h('div.card__head', h('div.card__title', 'Cambiar contraseña')), h('div.card__body', h('div.stack', p1, p2, h('div.row.row--end', h('button.btn.btn--primary', { onclick: async (e) => {
        if (p1.input.value.length < 8) return toast.warn('Mínimo 8 caracteres.');
        if (p1.input.value !== p2.input.value) return toast.warn('Las contraseñas no coinciden.');
        setLoading(e.target.closest('button'), true);
        try { await auth.updatePassword(p1.input.value); toast('Contraseña actualizada'); p1.input.value = p2.input.value = ''; } catch (err) { toast.error(err.message); }
        setLoading(e.target.closest('button'), false);
      } }, icon('key'), 'Actualizar'))))),
      h('div.card', h('div.card__head', h('div.card__title', 'Preferencias')), h('div.card__body', h('div.stack', discreet,
        h('div', h('div.eyebrow.mb-2', 'Sucursales'), h('p.text-sm', me.branches.map(b => b.name).join(', ') || '—')),
        h('div', h('div.eyebrow.mb-2', 'Permisos'), h('div.row.gap-1', (me.data?.permissions || []).map(p => h('span.badge', p)))))))));
}
