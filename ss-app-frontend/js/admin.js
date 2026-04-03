// ═══════════════════════════════════════════
// AUTH GUARD
// ═══════════════════════════════════════════
const session = JSON.parse(localStorage.getItem('sb_session') || 'null');
if (!session || session.role !== 'admin') {
  window.location.href = 'login.html';
}

// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const API_URL = 'https://ss-app-backend-production.up.railway.app/api';

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let categories = [];
let products = [];
let orders = [];
let currentSection = 'dashboard';
let editingCategoryId = null;
let editingProductId = null;

// ═══════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════
async function api(endpoint, options = {}) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ═══════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════
async function loadCategories() {
  try {
    categories = await api('/categories');
  } catch (e) {
    console.error('Error loading categories:', e);
    showToast('Error al cargar categorías', true);
  }
}

async function loadProducts() {
  try {
    products = await api('/products?active=false');
  } catch (e) {
    console.error('Error loading products:', e);
    showToast('Error al cargar productos', true);
  }
}

async function loadOrders() {
  try {
    orders = await api('/orders');
  } catch (e) {
    console.error('Error loading orders:', e);
    showToast('Error al cargar pedidos', true);
  }
}

async function loadAll() {
  await Promise.all([loadCategories(), loadProducts(), loadOrders()]);
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function showSection(section) {
  currentSection = section;

  document.querySelectorAll('.admin-section').forEach(el => el.classList.add('admin-section--hidden'));
  document.getElementById(section + 'Section').classList.remove('admin-section--hidden');

  document.querySelectorAll('.admin-sidebar__link').forEach(el => el.classList.remove('admin-sidebar__link--active'));
  const activeLink = document.querySelector(`.admin-sidebar__link[data-section="${section}"]`);
  if (activeLink) activeLink.classList.add('admin-sidebar__link--active');

  const titles = { dashboard: 'Dashboard', categories: 'Categorías', products: 'Productos', orders: 'Pedidos' };
  document.getElementById('sectionTitle').textContent = titles[section] || '';

  document.getElementById('adminSidebar').classList.remove('open');

  renderSection(section);
}

function renderSection(section) {
  switch (section) {
    case 'dashboard': renderDashboard(); break;
    case 'categories': renderCategories(); break;
    case 'products': renderProducts(); break;
    case 'orders': renderOrders(); break;
  }
}

function toggleSidebar() {
  document.getElementById('adminSidebar').classList.toggle('open');
}

// ═══════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════
function renderDashboard() {
  document.getElementById('statProducts').textContent = products.length;
  document.getElementById('statCategories').textContent = categories.length;
  const pending = orders.filter(o => o.status === 'pending').length;
  document.getElementById('statPendingOrders').textContent = pending;
  document.getElementById('statTotalOrders').textContent = orders.length;

  const recent = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  const tbody = document.getElementById('recentOrdersTable');
  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No hay pedidos aún</td></tr>';
    return;
  }
  tbody.innerHTML = recent.map(order => `
    <tr>
      <td><code>${order.id.slice(0, 8)}</code></td>
      <td>${order.customer_name}</td>
      <td>$${order.total.toFixed(2)}</td>
      <td>${statusBadge(order.status)}</td>
      <td>${formatDate(order.created_at)}</td>
    </tr>
  `).join('');
}

// ═══════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════
function renderCategories() {
  const tbody = document.getElementById('categoriesTable');
  if (categories.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No hay categorías</td></tr>';
    return;
  }
  tbody.innerHTML = categories
    .sort((a, b) => a.display_order - b.display_order)
    .map(cat => `
    <tr>
      <td style="font-size:1.5rem">${cat.icon}</td>
      <td><strong>${cat.name}</strong></td>
      <td><code>${cat.slug}</code></td>
      <td>${cat.display_order}</td>
      <td class="table-actions">
        <button class="btn-icon btn-edit" onclick="openCategoryModal('${cat.id}')" title="Editar">&#9998;</button>
        <button class="btn-icon btn-delete" onclick="deleteCategory('${cat.id}')" title="Eliminar">&#128465;</button>
      </td>
    </tr>
  `).join('');
}

function openCategoryModal(id) {
  editingCategoryId = id || null;
  const modal = document.getElementById('categoryModal');
  const title = document.getElementById('categoryModalTitle');
  const form = document.getElementById('categoryForm');

  form.reset();

  if (id) {
    const cat = categories.find(c => c.id === id);
    title.textContent = 'Editar Categoría';
    document.getElementById('categoryName').value = cat.name;
    document.getElementById('categorySlug').value = cat.slug;
    document.getElementById('categoryIcon').value = cat.icon;
    document.getElementById('categoryOrder').value = cat.display_order;
  } else {
    title.textContent = 'Nueva Categoría';
    document.getElementById('categoryOrder').value = categories.length + 1;
  }

  openModal(modal);
}

async function saveCategory(e) {
  e.preventDefault();
  const data = {
    name: document.getElementById('categoryName').value.trim(),
    slug: document.getElementById('categorySlug').value.trim(),
    icon: document.getElementById('categoryIcon').value.trim(),
    display_order: parseInt(document.getElementById('categoryOrder').value) || 0,
  };

  try {
    if (editingCategoryId) {
      await api(`/categories/${editingCategoryId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Categoría actualizada');
    } else {
      await api('/categories', { method: 'POST', body: JSON.stringify(data) });
      showToast('Categoría creada');
    }
    closeModals();
    await loadCategories();
    renderCategories();
  } catch (e) {
    showToast('Error al guardar categoría', true);
    console.error(e);
  }
}

async function deleteCategory(id) {
  const cat = categories.find(c => c.id === id);
  if (!confirm(`¿Eliminar la categoría "${cat.name}"? Los productos asociados podrían verse afectados.`)) return;

  try {
    await api(`/categories/${id}`, { method: 'DELETE' });
    showToast('Categoría eliminada');
    await loadCategories();
    renderCategories();
  } catch (e) {
    showToast('Error al eliminar categoría', true);
    console.error(e);
  }
}

// ═══════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════
function renderProducts() {
  const tbody = document.getElementById('productsTable');
  if (products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No hay productos</td></tr>';
    return;
  }
  tbody.innerHTML = products.map(p => {
    const cat = categories.find(c => c.id === p.category_id);
    return `
    <tr>
      <td><strong>${p.name}</strong></td>
      <td>${cat ? cat.name : '—'}</td>
      <td>$${p.price.toFixed(2)}${p.old_price ? ` <s style="color:#999">$${p.old_price.toFixed(2)}</s>` : ''}</td>
      <td><span class="stock-badge ${p.stock <= 3 ? 'stock-low' : ''}">${p.stock}</span></td>
      <td>${p.badge ? badgeLabel(p.badge) : '—'}</td>
      <td>${p.is_active !== false ? '<span class="status-badge status-active">Activo</span>' : '<span class="status-badge status-inactive">Inactivo</span>'}</td>
      <td class="table-actions">
        <button class="btn-icon btn-edit" onclick="openProductModal('${p.id}')" title="Editar">&#9998;</button>
        <button class="btn-icon btn-delete" onclick="deleteProduct('${p.id}')" title="Desactivar">&#128465;</button>
      </td>
    </tr>
  `;
  }).join('');
}

function openProductModal(id) {
  editingProductId = id || null;
  const modal = document.getElementById('productModal');
  const title = document.getElementById('productModalTitle');
  const form = document.getElementById('productForm');

  form.reset();
  populateCategorySelect();

  if (id) {
    const p = products.find(pr => pr.id === id);
    title.textContent = 'Editar Producto';
    document.getElementById('productName').value = p.name;
    document.getElementById('productSlug').value = p.slug;
    document.getElementById('productDescription').value = p.description || '';
    document.getElementById('productPrice').value = p.price;
    document.getElementById('productOldPrice').value = p.old_price || '';
    document.getElementById('productCategorySelect').value = p.category_id;
    document.getElementById('productStock').value = p.stock;
    document.getElementById('productBadge').value = p.badge || '';
    document.getElementById('productActive').checked = p.is_active !== false;
  } else {
    title.textContent = 'Nuevo Producto';
    document.getElementById('productActive').checked = true;
  }

  openModal(modal);
}

function populateCategorySelect() {
  const select = document.getElementById('productCategorySelect');
  select.innerHTML = '<option value="">Seleccionar categoría...</option>' +
    categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

async function saveProduct(e) {
  e.preventDefault();
  const oldPriceVal = document.getElementById('productOldPrice').value;
  const data = {
    name: document.getElementById('productName').value.trim(),
    slug: document.getElementById('productSlug').value.trim(),
    description: document.getElementById('productDescription').value.trim(),
    price: parseFloat(document.getElementById('productPrice').value),
    old_price: oldPriceVal ? parseFloat(oldPriceVal) : null,
    category_id: document.getElementById('productCategorySelect').value,
    stock: parseInt(document.getElementById('productStock').value) || 0,
    badge: document.getElementById('productBadge').value || null,
    is_active: document.getElementById('productActive').checked,
  };

  try {
    if (editingProductId) {
      await api(`/products/${editingProductId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Producto actualizado');
    } else {
      await api('/products', { method: 'POST', body: JSON.stringify(data) });
      showToast('Producto creado');
    }
    closeModals();
    await loadProducts();
    renderProducts();
  } catch (e) {
    showToast('Error al guardar producto', true);
    console.error(e);
  }
}

async function deleteProduct(id) {
  const p = products.find(pr => pr.id === id);
  if (!confirm(`¿Desactivar el producto "${p.name}"?`)) return;

  try {
    await api(`/products/${id}`, { method: 'DELETE' });
    showToast('Producto desactivado');
    await loadProducts();
    renderProducts();
  } catch (e) {
    showToast('Error al desactivar producto', true);
    console.error(e);
  }
}

// ═══════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════
function renderOrders() {
  const filterValue = document.getElementById('orderStatusFilter')?.value || 'all';
  const filtered = filterValue === 'all' ? orders : orders.filter(o => o.status === filterValue);
  const sorted = [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const tbody = document.getElementById('ordersTable');
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No hay pedidos</td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(order => `
    <tr>
      <td><code>${order.id.slice(0, 8)}</code></td>
      <td>${order.customer_name}</td>
      <td>${order.customer_phone}</td>
      <td>$${order.total.toFixed(2)}</td>
      <td>${statusBadge(order.status)}</td>
      <td>${formatDate(order.created_at)}</td>
      <td class="table-actions">
        <button class="btn-icon btn-view" onclick="viewOrder('${order.id}')" title="Ver detalle">&#128065;</button>
      </td>
    </tr>
  `).join('');
}

function filterOrders() {
  renderOrders();
}

async function viewOrder(id) {
  try {
    const data = await api(`/orders/${id}`);
    const order = data.order;
    const items = data.items;

    document.getElementById('orderDetailId').textContent = order.id.slice(0, 8);
    document.getElementById('orderDetailName').textContent = order.customer_name;
    document.getElementById('orderDetailPhone').textContent = order.customer_phone;
    document.getElementById('orderDetailAddress').textContent = order.customer_address || 'No especificada';
    document.getElementById('orderDetailNotes').textContent = order.notes || 'Sin notas';
    document.getElementById('orderDetailTotal').textContent = `$${order.total.toFixed(2)} MXN`;
    document.getElementById('orderDetailDate').textContent = formatDate(order.created_at);

    const select = document.getElementById('orderStatusSelect');
    select.value = order.status;
    select.dataset.orderId = order.id;

    const tbody = document.getElementById('orderDetailItems');
    tbody.innerHTML = items.map(item => `
      <tr>
        <td>${item.product_name}</td>
        <td>${item.quantity}</td>
        <td>$${item.unit_price.toFixed(2)}</td>
        <td>$${item.subtotal.toFixed(2)}</td>
      </tr>
    `).join('');

    openModal(document.getElementById('orderDetailModal'));
  } catch (e) {
    showToast('Error al cargar detalle del pedido', true);
    console.error(e);
  }
}

async function updateOrderStatus() {
  const select = document.getElementById('orderStatusSelect');
  const orderId = select.dataset.orderId;
  const status = select.value;

  try {
    await api(`/orders/${orderId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    showToast('Estado del pedido actualizado');
    closeModals();
    await loadOrders();
    renderOrders();
  } catch (e) {
    showToast('Error al actualizar estado', true);
    console.error(e);
  }
}

// ═══════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════
function openModal(modal) {
  document.getElementById('modalOverlay').classList.add('open');
  modal.classList.add('open');
}

function closeModals() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.querySelectorAll('.admin-modal').forEach(m => m.classList.remove('open'));
  editingCategoryId = null;
  editingProductId = null;
}

// ═══════════════════════════════════════════
// SLUG GENERATION
// ═══════════════════════════════════════════
function generateSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function setupSlugGeneration(nameId, slugId) {
  const nameInput = document.getElementById(nameId);
  const slugInput = document.getElementById(slugId);
  nameInput.addEventListener('input', () => {
    if (!editingCategoryId && !editingProductId) {
      slugInput.value = generateSlug(nameInput.value);
    }
  });
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function statusBadge(status) {
  const labels = {
    pending: 'Pendiente',
    confirmed: 'Confirmado',
    shipped: 'Enviado',
    delivered: 'Entregado',
    cancelled: 'Cancelado',
  };
  return `<span class="status-badge status-${status}">${labels[status] || status}</span>`;
}

function badgeLabel(badge) {
  const labels = { new: 'Nuevo', hot: 'Popular', sale: 'Oferta' };
  return `<span class="product-badge-admin badge-${badge}">${labels[badge] || badge}</span>`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
let toastTimer;
function showToast(msg, isError) {
  const toast = document.getElementById('adminToast');
  toast.textContent = msg;
  toast.className = 'admin-toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
function logout() {
  localStorage.removeItem('sb_session');
  window.location.href = 'login.html';
}

async function init() {
  // Show admin user info
  const userEl = document.getElementById('adminUser');
  if (session) {
    userEl.textContent = session.email;
  }

  document.getElementById('categoryForm').addEventListener('submit', saveCategory);
  document.getElementById('productForm').addEventListener('submit', saveProduct);

  setupSlugGeneration('categoryName', 'categorySlug');
  setupSlugGeneration('productName', 'productSlug');

  document.getElementById('modalOverlay').addEventListener('click', closeModals);

  await loadAll();
  showSection('dashboard');
}

init();
