// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — Sesión (Supabase Auth) y contexto del usuario
// ═══════════════════════════════════════════════════════════════════════════
import { CONFIG, ERP_API } from './config.js';

export const session = {
  get() { try { return JSON.parse(localStorage.getItem(CONFIG.SESSION_KEY) || 'null'); } catch { return null; } },
  set(s) { localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(s)); },
  clear() { localStorage.removeItem(CONFIG.SESSION_KEY); },
  payload(s = session.get()) { try { return JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } },
  expired(s = session.get()) { const p = s && session.payload(s); return !p || p.exp * 1000 < Date.now(); },
  expiresSoon(s = session.get()) { const p = s && session.payload(s); return !p || p.exp * 1000 - Date.now() < 90_000; },
  async refresh() {
    const s = session.get();
    if (!s?.refresh_token) return false;
    const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY }, body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!res.ok) { session.clear(); return false; }
    const data = await res.json();
    session.set({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
    return true;
  },
};

/** Traduce los errores de Supabase Auth al cambiar contraseña. */
function passwordError(d, status) {
  const code = d.error_code || d.code || ''; const m = String(d.msg || d.error_description || d.message || '');
  if (code === 'same_password' || /different from the old/i.test(m)) return 'La nueva contraseña debe ser distinta a la actual.';
  if (code === 'weak_password' || /at least|weak|characters/i.test(m)) return 'La contraseña es muy débil. Usa al menos 8 caracteres combinando letras y números.';
  if (code === 'reauthentication_needed') return 'Por seguridad, vuelve a iniciar sesión y repite el cambio.';
  if (status === 401 || /expired|invalid jwt|not authenticated/i.test(m)) return 'El enlace o la sesión expiró. Solicita un nuevo correo de recuperación.';
  if (status === 429) return 'Demasiados intentos. Espera un minuto.';
  return 'No se pudo cambiar la contraseña. Intenta de nuevo.';
}

export const auth = {
  async login(email, password) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY }, body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error_description || data.msg || data.error || '';
      if (/invalid login|invalid_credentials|credentials/i.test(msg)) throw new Error('Correo o contraseña incorrectos.');
      if (/banned|disabled/i.test(msg)) throw new Error('Tu cuenta está desactivada. Contacta a un administrador.');
      if (/rate|too many/i.test(msg)) throw new Error('Demasiados intentos. Espera un minuto.');
      throw new Error('No se pudo iniciar sesión. Intenta de nuevo.');
    }
    session.set({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
    return data;
  },
  async recover(email) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, redirect_to: location.origin + location.pathname.replace(/[^/]*$/, '') + 'reset.html' }),
    });
    if (res.status === 429) throw new Error('Ya pediste varios correos de recuperación. Espera unos minutos antes de intentar otra vez.');
    if (!res.ok) throw new Error('No se pudo enviar el correo de recuperación. Revisa que el correo esté bien escrito e intenta de nuevo.');
  },
  async updatePassword(newPassword) {
    const s = session.get();
    const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${s?.access_token}` }, body: JSON.stringify({ password: newPassword }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(passwordError(d, res.status)); }
  },
  async logout() {
    const s = session.get();
    try { if (s?.access_token) await fetch(`${ERP_API}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${s.access_token}` } }); } catch { /* sin red */ }
    try { if (s?.access_token) await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` } }); } catch { /* idem */ }
    session.clear();
    location.href = './login.html';
  },
};

/** Contexto actual (usuario, permisos, sucursales, settings). Lo llena app.js al arrancar. */
export const me = {
  data: null,
  set(d) { me.data = d; },
  can(...perms) { const p = me.data?.permissions || []; return perms.length === 0 || perms.some(x => p.includes(x)); },
  canAll(...perms) { const p = me.data?.permissions || []; return perms.every(x => p.includes(x)); },
  get user() { return me.data?.user; },
  get org() { return me.data?.organization; },
  get settings() { return me.data?.settings || {}; },
  get branches() { return me.data?.branches || []; },
  get warehouses() { return me.data?.warehouses || []; },
  get registers() { return me.data?.cash_registers || []; },
  get paymentMethods() { return me.data?.payment_methods || []; },
  get maxDiscount() { return me.data?.max_discount_pct; },
  get roleLabel() { return (me.data?.roles || []).map(r => r.name).join(', '); },
  get isSuperAdmin() { return (me.data?.roles || []).some(r => r.code === 'SUPER_ADMIN'); },
  warehousesOf(branchId) { return me.warehouses.filter(w => w.branch_id === branchId); },
  registersOf(branchId) { return me.registers.filter(r => r.branch_id === branchId); },
  branchName(id) { return (me.data?.all_branches || []).find(b => b.id === id)?.name || '—'; },
};
