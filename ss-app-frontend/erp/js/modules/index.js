// ═══════════════════════════════════════════════════════════════════════════
// SONROJA ERP — Registro de módulos y navegación (Operación · Inteligencia · Acción)
// ═══════════════════════════════════════════════════════════════════════════
import * as dashboard from './dashboard.js';
import * as executive from './executive.js';
import * as pos from './pos.js';
import * as sales from './sales.js';
import * as returns from './returns.js';
import * as cash from './cash.js';
import * as products from './products.js';
import * as stock from './stock.js';
import * as movements from './movements.js';
import * as inventoryAlerts from './inventory-alerts.js';
import * as transfers from './transfers.js';
import * as counts from './counts.js';
import * as suppliers from './suppliers.js';
import * as purchases from './purchases.js';
import * as customers from './customers.js';
import * as analytics from './analytics.js';
import * as reports from './reports.js';
import * as alerts from './alerts.js';
import * as settings from './settings.js';
import * as profile from './profile.js';

export const NAV = [
  { items: [{ label: 'Dashboard', icon: 'home', path: '/dashboard' }, { label: 'Modo ejecutivo', icon: 'sparkles', path: '/executive', perms: ['analytics.read'] }] },
  { label: 'Operación', items: [
    { label: 'Ventas', icon: 'cart', children: [
      { label: 'Punto de venta', icon: 'cart', path: '/pos', perms: ['sales.create'] },
      { label: 'Ventas', icon: 'receipt', path: '/sales', perms: ['sales.read', 'sales.read.own'] },
      { label: 'Devoluciones', icon: 'undo', path: '/returns', perms: ['sales.read', 'sales.refund'] },
      { label: 'Caja', icon: 'cash', path: '/cash', perms: ['cash.read', 'cash.open'] },
    ] },
    { label: 'Inventario', icon: 'box', children: [
      { label: 'Productos', icon: 'tag', path: '/products', perms: ['products.read'] },
      { label: 'Existencias', icon: 'layers', path: '/stock', perms: ['inventory.read', 'products.read'] },
      { label: 'Movimientos', icon: 'activity', path: '/movements', perms: ['inventory.read'] },
      { label: 'Alertas de stock', icon: 'alertTriangle', path: '/inventory-alerts', perms: ['inventory.read', 'alerts.read'] },
      { label: 'Transferencias', icon: 'shuffle', path: '/transfers', perms: ['inventory.read'] },
      { label: 'Conteos físicos', icon: 'clipboard', path: '/counts', perms: ['inventory.read'] },
    ] },
    { label: 'Compras', icon: 'truck', children: [
      { label: 'Proveedores', icon: 'building', path: '/suppliers', perms: ['suppliers.manage', 'purchases.read', 'products.read'] },
      { label: 'Órdenes de compra', icon: 'clipboard', path: '/purchases', perms: ['purchases.read'] },
      { label: 'Recepciones', icon: 'inbox', path: '/receipts', perms: ['purchases.read'] },
    ] },
    { label: 'Clientes', icon: 'users', path: '/customers', perms: ['customers.read'] },
  ] },
  { label: 'Inteligencia', items: [
    { label: 'Analytics', icon: 'chart', children: [
      { label: 'Overview', icon: 'chart', path: '/analytics/overview', perms: ['analytics.read'] },
      { label: 'Productos', icon: 'tag', path: '/analytics/products', perms: ['analytics.read'] },
      { label: 'Clientes', icon: 'users', path: '/analytics/customers', perms: ['analytics.read'] },
      { label: 'Geografía', icon: 'map', path: '/analytics/geography', perms: ['analytics.read'] },
      { label: 'Horarios', icon: 'clock', path: '/analytics/time', perms: ['analytics.read'] },
      { label: 'Tendencias', icon: 'trend', path: '/analytics/trends', perms: ['analytics.read'] },
      { label: 'Inventario', icon: 'rotate', path: '/analytics/inventory', perms: ['analytics.read'] },
      { label: 'Finanzas', icon: 'dollar', path: '/analytics/financial', perms: ['analytics.financial'] },
    ] },
    { label: 'Reportes', icon: 'file', path: '/reports', perms: ['reports.read'] },
  ] },
  { label: 'Acción', items: [
    { label: 'Centro de alertas', icon: 'bell', path: '/alerts', perms: ['alerts.read'], badge: 'alerts' },
  ] },
  { label: 'Configuración', items: [
    { label: 'Configuración', icon: 'settings', children: [
      { label: 'Usuarios', icon: 'user', path: '/settings/users', perms: ['users.read'] },
      { label: 'Roles y permisos', icon: 'shield', path: '/settings/roles', perms: ['roles.manage', 'users.read'] },
      { label: 'Sucursales y almacenes', icon: 'store', path: '/settings/branches', perms: ['branches.manage'] },
      { label: 'Categorías', icon: 'grid', path: '/settings/categories', perms: ['categories.manage', 'products.read'] },
      { label: 'Marcas', icon: 'star', path: '/settings/brands', perms: ['brands.manage', 'products.read'] },
      { label: 'Métodos de pago', icon: 'wallet', path: '/settings/payment-methods', perms: ['settings.manage'] },
      { label: 'Promociones', icon: 'gift', path: '/settings/promotions', perms: ['promotions.manage', 'sales.create'] },
      { label: 'Importar datos', icon: 'upload', path: '/settings/import', perms: ['products.import', 'customers.create', 'suppliers.manage', 'inventory.adjust'] },
      { label: 'Auditoría', icon: 'lock', path: '/settings/audit', perms: ['audit.read'] },
      { label: 'Sistema', icon: 'settings', path: '/settings/system', perms: ['settings.manage'] },
    ] },
  ] },
];

export const MODULES = {
  dashboard, executive, pos, sales, returns, cash, products, stock, movements, inventoryAlerts, transfers, counts, suppliers, purchases, customers, analytics, reports, alerts, settings, profile,
};
