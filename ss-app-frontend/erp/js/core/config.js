// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — Configuración de entorno (único lugar)
// ═══════════════════════════════════════════════════════════════════════════
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

export const CONFIG = Object.freeze({
  APP_NAME: 'SONROJA',
  TAGLINE: 'Sensual. Confiada. Libre.',
  API_URL: LOCAL && location.port !== '8080'
    ? 'http://localhost:8080/api'
    : 'https://ss-app-backend-production.up.railway.app/api',
  ERP_API: null, // se calcula abajo
  SUPABASE_URL: 'https://litzzmjoiujifddkrryp.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpdHp6bWpvaXVqaWZkZGtycnlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDU4NTQsImV4cCI6MjA5MDgyMTg1NH0.d2jUA16jXjxTOlYswSmw1lqJt-3_o6CwJdpaMixhPYo',
  SESSION_KEY: 'sonroja_erp_session',
  PREFS_KEY: 'sonroja_erp_prefs',
  LOCALE: 'es-MX',
  CURRENCY: 'MXN',
  TIMEZONE: 'America/Hermosillo',
  PAGE_SIZE: 25,
  VERSION: '1.0.0',
});

export const ERP_API = `${CONFIG.API_URL}/erp`;
