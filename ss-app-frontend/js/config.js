// ═══════════════════════════════════════════
// APP CONFIG — Centralized constants & utilities
// ═══════════════════════════════════════════
const APP_CONFIG = Object.freeze({
  API_URL: 'https://ss-app-backend-production.up.railway.app/api',
  SUPABASE_URL: 'https://litzzmjoiujifddkrryp.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpdHp6bWpvaXVqaWZkZGtycnlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDU4NTQsImV4cCI6MjA5MDgyMTg1NH0.d2jUA16jXjxTOlYswSmw1lqJt-3_o6CwJdpaMixhPYo',
  WHATSAPP_NUMBER: '526221254659',
  SHIPPING_COST: 99,
  PRODUCTS_PER_PAGE: 10,
});

// ═══════════════════════════════════════════
// HTML ESCAPE — Prevent XSS in innerHTML
// ═══════════════════════════════════════════
const _escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => _escapeMap[c]);
}

// ═══════════════════════════════════════════
// SESSION HELPERS
// ═══════════════════════════════════════════
function getSession() {
  try {
    return JSON.parse(localStorage.getItem('sb_session') || 'null');
  } catch { return null; }
}

function isSessionExpired(session) {
  if (!session || !session.access_token) return true;
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
    return payload.exp < Date.now() / 1000;
  } catch { return true; }
}

function isSessionExpiringSoon(session) {
  if (!session || !session.access_token) return true;
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
    // Expiring within 1 hour
    return payload.exp < (Date.now() / 1000) + 3600;
  } catch { return true; }
}

async function refreshSession(refreshToken) {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${APP_CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': APP_CONFIG.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;

    const data = await res.json();
    const currentSession = getSession();
    if (currentSession) {
      currentSession.access_token = data.access_token;
      currentSession.refresh_token = data.refresh_token;
      localStorage.setItem('sb_session', JSON.stringify(currentSession));
    }
    return true;
  } catch { return false; }
}

function clearSession() {
  localStorage.removeItem('sb_session');
}

// ═══════════════════════════════════════════
// LOADING STATE HELPER
// ═══════════════════════════════════════════
function setButtonLoading(btn, loading, originalText) {
  if (!btn) return;
  if (loading) {
    btn._originalText = btn._originalText || originalText || btn.textContent;
    btn.disabled = true;
    btn.classList.add('admin-btn--loading');
    btn.textContent = 'Procesando...';
  } else {
    btn.disabled = false;
    btn.classList.remove('admin-btn--loading');
    btn.textContent = btn._originalText || originalText || 'Guardar';
    delete btn._originalText;
  }
}

// ═══════════════════════════════════════════
// FORM VALIDATION
// ═══════════════════════════════════════════
function validateRequired(value, fieldName) {
  if (!value || !value.trim()) return `${fieldName} es requerido`;
  return null;
}

function validateSlug(value) {
  if (!value || !value.trim()) return 'Slug es requerido';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) return 'Slug debe ser letras minúsculas, números y guiones';
  if (value.length < 2) return 'Slug debe tener al menos 2 caracteres';
  return null;
}

function validatePrice(value) {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 'Precio debe ser mayor a 0';
  return null;
}

function validateStock(value) {
  const num = parseInt(value);
  if (isNaN(num) || num < 0) return 'Stock debe ser 0 o mayor';
  return null;
}

function showFieldError(inputEl, message) {
  if (!inputEl) return;
  inputEl.classList.add('admin-form-group__input--error');
  const existing = inputEl.parentElement.querySelector('.admin-form-group__error');
  if (existing) existing.remove();
  const span = document.createElement('span');
  span.className = 'admin-form-group__error';
  span.textContent = message;
  inputEl.insertAdjacentElement('afterend', span);
}

function clearFieldErrors(formEl) {
  if (!formEl) return;
  formEl.querySelectorAll('.admin-form-group__input--error').forEach(el => el.classList.remove('admin-form-group__input--error'));
  formEl.querySelectorAll('.admin-form-group__error').forEach(el => el.remove());
}

// ═══════════════════════════════════════════
// CURRENCY FORMATTING
// ═══════════════════════════════════════════
function formatCurrency(amount) {
  return '$' + Number(amount || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
