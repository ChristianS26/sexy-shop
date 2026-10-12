// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — Cliente HTTP (auth, refresh, errores amables, descargas)
// ═══════════════════════════════════════════════════════════════════════════
import { CONFIG, ERP_API } from './config.js';
import { session } from './auth.js';
import { qs, downloadBlob } from './dom.js';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || body?.message || 'Ocurrió un error inesperado.');
    this.status = status; this.code = body?.code || `HTTP_${status}`; this.details = body?.details || null;
  }
}

let refreshing = null;
async function authHeaders() {
  const s = session.get();
  if (!s) return {};
  if (session.expiresSoon(s)) { refreshing ||= session.refresh().finally(() => { refreshing = null; }); await refreshing; }
  const t = session.get()?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function request(method, path, { body, params, raw = false, headers = {}, signal } = {}) {
  const url = (path.startsWith('http') ? path : ERP_API + path) + qs(params);
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method, signal,
    headers: { ...(isForm ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()), ...headers },
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { session.clear(); location.href = './login.html?expired=1'; throw new ApiError(401, { error: 'Sesión expirada' }); }
  if (raw) { if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({}))); return res; }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (p, params, o) => request('GET', p, { params, ...o }),
  post: (p, body, o) => request('POST', p, { body, ...o }),
  patch: (p, body, o) => request('PATCH', p, { body, ...o }),
  put: (p, body, o) => request('PUT', p, { body, ...o }),
  del: (p, o) => request('DELETE', p, o),
  upload: (p, formData) => request('POST', p, { body: formData }),
  /** Descarga un export (CSV/XLSX) con autenticación. */
  async download(p, params, filename) {
    const res = await request('GET', p, { params, raw: true });
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename="?([^";]+)"?/.exec(cd);
    downloadBlob(blob, filename || (m ? m[1] : 'export'));
  },
  legacy: (p, params, o) => request('GET', `${CONFIG.API_URL}${p}`, { params, ...o }),
  legacyUpload: (p, formData) => request('POST', `${CONFIG.API_URL}${p}`, { body: formData }),
  legacyDelete: (p) => request('DELETE', `${CONFIG.API_URL}${p}`),
  legacyPut: (p, body) => request('PUT', `${CONFIG.API_URL}${p}`, { body }),
};

/** Mensaje legible para la persona a partir de cualquier error. */
export function friendlyError(e) {
  if (e instanceof ApiError) {
    if (e.status === 403) return e.message || 'No tienes permiso para realizar esta acción.';
    if (e.status === 404) return e.message || 'No encontramos lo que buscas.';
    if (e.status === 429) return 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.';
    if (e.status >= 500) return 'Algo salió mal de nuestro lado. Intenta de nuevo en un momento.';
    return e.message;
  }
  if (e?.name === 'AbortError') return null;
  if (e instanceof TypeError) return 'No hay conexión con el servidor. Revisa tu internet.';
  // errores lanzados por la propia app con un mensaje pensado para la persona (new Error('…'))
  if (e && e.constructor === Error && e.message) return e.message;
  console.error(e);
  return 'Ocurrió un error inesperado.';
}
