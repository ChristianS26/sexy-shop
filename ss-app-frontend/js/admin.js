// ═══════════════════════════════════════════
// AUTH GUARD
// ═══════════════════════════════════════════
const session = getSession();
if (!session || session.role !== 'admin' || isSessionExpired(session)) {
  clearSession();
  window.location.href = 'login.html';
}
// Check session expiration every 5 minutes
setInterval(() => {
  if (isSessionExpired(getSession())) {
    clearSession();
    window.location.href = 'login.html';
  }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const API_URL = APP_CONFIG.API_URL;

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let categories = [];
let products = [];
let orders = [];
let currentSection = 'dashboard';
let editingCategoryId = null;
let editingProductId = null;
let productFilters = {
  search: '',
  category: '',
  status: '',
  badge: '',
  sort: 'manual',
};
let productPage = 1;
const PRODUCTS_PER_PAGE = APP_CONFIG.PRODUCTS_PER_PAGE;

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
    // Load primary image for each product
    await Promise.all(products.map(async (p) => {
      try {
        const images = await api(`/products/${p.id}/images`);
        p.primaryImage = images[0] || null;
      } catch (e) {
        p.primaryImage = null;
      }
    }));
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
  if (section !== 'products') {
    window.location.hash = section;
  }

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

function getSectionFromHash() {
  const hash = window.location.hash.replace('#', '').split('?')[0];
  const valid = ['dashboard', 'categories', 'products', 'orders'];
  return valid.includes(hash) ? hash : 'dashboard';
}

function saveFiltersToHash() {
  const params = new URLSearchParams();
  if (productFilters.search) params.set('q', productFilters.search);
  if (productFilters.category) params.set('cat', productFilters.category);
  if (productFilters.status) params.set('st', productFilters.status);
  if (productFilters.badge) params.set('badge', productFilters.badge);
  if (productFilters.sort !== 'manual') params.set('sort', productFilters.sort);
  if (productPage > 1) params.set('p', productPage);

  const qs = params.toString();
  window.location.hash = currentSection + (qs ? '?' + qs : '');
}

function loadFiltersFromHash() {
  const hashParts = window.location.hash.replace('#', '').split('?');
  if (hashParts.length < 2) return;

  const params = new URLSearchParams(hashParts[1]);
  productFilters.search = params.get('q') || '';
  productFilters.category = params.get('cat') || '';
  productFilters.status = params.get('st') || '';
  productFilters.badge = params.get('badge') || '';
  productFilters.sort = params.get('sort') || 'manual';
  productPage = parseInt(params.get('p')) || 1;
}

function restoreFilterInputs() {
  const el = (id) => document.getElementById(id);
  if (el('productSearch')) el('productSearch').value = productFilters.search;
  if (el('productCategoryFilter')) el('productCategoryFilter').value = productFilters.category;
  if (el('productStatusFilter')) el('productStatusFilter').value = productFilters.status;
  if (el('productBadgeFilter')) el('productBadgeFilter').value = productFilters.badge;
  if (el('productSort')) el('productSort').value = productFilters.sort;
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
async function renderDashboard() {
  try {
    const stats = await api('/dashboard/stats');

    document.getElementById('statRevenue').textContent = formatCurrency(stats.total_revenue);
    document.getElementById('statOrdersMonth').textContent = stats.orders_this_month;
    document.getElementById('statProducts').textContent = stats.total_products;
    document.getElementById('statLowStock').textContent = stats.low_stock_alerts.length;

    // Top products
    const topBody = document.getElementById('topProductsBody');
    if (stats.top_products.length === 0) {
      topBody.innerHTML = '<tr><td colspan="3" class="table-empty">Sin ventas registradas</td></tr>';
    } else {
      topBody.innerHTML = stats.top_products.map(p => `
        <tr>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td>${p.total_sold}</td>
          <td>${formatCurrency(p.revenue)}</td>
        </tr>
      `).join('');
    }

    // Low stock alerts
    const lowBody = document.getElementById('lowStockBody');
    if (stats.low_stock_alerts.length === 0) {
      lowBody.innerHTML = '<tr><td colspan="3" class="table-empty">Todo el stock est&aacute; bien</td></tr>';
    } else {
      lowBody.innerHTML = stats.low_stock_alerts.map(p => `
        <tr>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td><span class="stock-badge ${p.stock <= 0 ? 'stock-out' : 'stock-low'}">${p.stock}</span></td>
          <td><button class="admin-btn admin-btn--sm admin-btn--secondary" onclick="showSection('products')">Ver</button></td>
        </tr>
      `).join('');
    }

    // Status distribution
    const distEl = document.getElementById('statusDistribution');
    const statusLabels = { pending: 'Pendiente', confirmed: 'Confirmado', shipped: 'Enviado', delivered: 'Entregado', cancelled: 'Cancelado' };
    const statusColors = { pending: '#f59e0b', confirmed: '#3b82f6', shipped: '#8b5cf6', delivered: '#10b981', cancelled: '#ef4444' };
    const totalOrders = Object.values(stats.status_distribution).reduce((a, b) => a + b, 0) || 1;

    let distHtml = '<div class="admin-status-bar">';
    for (const [status, count] of Object.entries(stats.status_distribution)) {
      const pct = ((count / totalOrders) * 100).toFixed(1);
      distHtml += `<div class="admin-status-segment" style="width:${pct}%;background:${statusColors[status] || '#999'}" title="${statusLabels[status] || status}: ${count} (${pct}%)"></div>`;
    }
    distHtml += '</div><div class="admin-status-legend">';
    for (const [status, count] of Object.entries(stats.status_distribution)) {
      distHtml += `<div class="admin-status-legend__item"><span class="admin-status-legend__dot" style="background:${statusColors[status] || '#999'}"></span>${statusLabels[status] || status}: ${count}</div>`;
    }
    distHtml += '</div>';
    distEl.innerHTML = distHtml;

    // Recent orders (last 5)
    const recent = orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    const recentBody = document.getElementById('recentOrdersTable');
    if (recent.length === 0) {
      recentBody.innerHTML = '<tr><td colspan="4" class="table-empty">No hay pedidos a&uacute;n</td></tr>';
    } else {
      recentBody.innerHTML = recent.map(order => `
        <tr style="cursor:pointer" onclick="showSection('orders')">
          <td><code>${order.id.slice(0, 8)}</code></td>
          <td>${escapeHtml(order.customer_name)}</td>
          <td>${formatCurrency(order.total)}</td>
          <td>${statusBadge(order.status)}</td>
        </tr>
      `).join('');
    }

  } catch (e) {
    console.error('Dashboard error:', e);
    // Fallback to basic stats from loaded data
    document.getElementById('statRevenue').textContent = formatCurrency(0);
    document.getElementById('statOrdersMonth').textContent = '0';
    document.getElementById('statProducts').textContent = products.length;
    document.getElementById('statLowStock').textContent = products.filter(p => p.stock <= 5 && p.is_active !== false).length;
  }
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
      <td><strong>${escapeHtml(cat.name)}</strong></td>
      <td><code>${escapeHtml(cat.slug)}</code></td>
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

  renderEmojiPicker();

  if (id) {
    const cat = categories.find(c => c.id === id);
    title.textContent = 'Editar Categoría';
    document.getElementById('categoryName').value = cat.name;
    document.getElementById('categorySlug').value = cat.slug;
    document.getElementById('categoryIcon').value = cat.icon;
    document.getElementById('categoryOrder').value = cat.display_order;
    syncEmojiPicker(cat.icon);
  } else {
    title.textContent = 'Nueva Categoría';
    document.getElementById('categoryOrder').value = categories.length + 1;
  }

  openModal(modal);
}

async function saveCategory(e) {
  e.preventDefault();
  const form = document.getElementById('categoryForm');
  const btn = form.querySelector('button[type="submit"]');
  clearFieldErrors(form);

  // Validation
  const nameErr = validateRequired(document.getElementById('categoryName').value, 'Nombre');
  const slugErr = validateSlug(document.getElementById('categorySlug').value);
  const iconErr = validateRequired(document.getElementById('categoryIcon').value, 'Icono');

  if (nameErr) { showFieldError(document.getElementById('categoryName'), nameErr); return; }
  if (slugErr) { showFieldError(document.getElementById('categorySlug'), slugErr); return; }
  if (iconErr) { showFieldError(document.getElementById('categoryIcon'), iconErr); return; }

  setButtonLoading(btn, true, 'Guardar');

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
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      showToast('Error: ese slug ya existe', true);
    } else {
      showToast('Error al guardar categoría', true);
    }
    console.error(e);
  } finally {
    setButtonLoading(btn, false);
    await loadCategories();
    renderCategories();
  }
}

async function deleteCategory(id) {
  const cat = categories.find(c => c.id === id);
  const ok = await showConfirm('Eliminar categoría', `¿Eliminar "${cat.name}"? Los productos asociados podrían verse afectados.`);
  if (!ok) return;

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
function getFilteredProducts() {
  let filtered = [...products];

  // Search
  if (productFilters.search) {
    const q = productFilters.search.toLowerCase();
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)
    );
  }

  // Category
  if (productFilters.category) {
    filtered = filtered.filter(p => p.category_id === productFilters.category);
  }

  // Status
  if (productFilters.status === 'active') filtered = filtered.filter(p => p.is_active !== false);
  else if (productFilters.status === 'inactive') filtered = filtered.filter(p => p.is_active === false);
  else if (productFilters.status === 'soldout') filtered = filtered.filter(p => p.stock <= 0);

  // Badge
  if (productFilters.badge) {
    filtered = filtered.filter(p => p.badge === productFilters.badge);
  }

  // Sort
  switch (productFilters.sort) {
    case 'manual': filtered.sort((a, b) => a.display_order - b.display_order); break;
    case 'name-asc': filtered.sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'name-desc': filtered.sort((a, b) => b.name.localeCompare(a.name)); break;
    case 'price-asc': filtered.sort((a, b) => a.price - b.price); break;
    case 'price-desc': filtered.sort((a, b) => b.price - a.price); break;
    case 'stock-asc': filtered.sort((a, b) => a.stock - b.stock); break;
    case 'stock-desc': filtered.sort((a, b) => b.stock - a.stock); break;
    case 'newest': filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); break;
  }

  return filtered;
}

function renderProducts() {
  const filtered = getFilteredProducts();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE));
  if (productPage > totalPages) productPage = totalPages;

  const start = (productPage - 1) * PRODUCTS_PER_PAGE;
  const pageProducts = filtered.slice(start, start + PRODUCTS_PER_PAGE);

  saveFiltersToHash();

  // Update count
  document.getElementById('productCount').textContent = `${filtered.length} producto${filtered.length !== 1 ? 's' : ''} encontrado${filtered.length !== 1 ? 's' : ''}`;

  // Populate category filter if not done
  const catFilter = document.getElementById('productCategoryFilter');
  if (catFilter && catFilter.options.length <= 1) {
    catFilter.innerHTML = '<option value="">Todas las categorías</option>' +
      categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  // Render table
  const tbody = document.getElementById('productsTable');
  if (pageProducts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No se encontraron productos</td></tr>';
  } else {
    tbody.innerHTML = pageProducts.map(p => {
      const cat = categories.find(c => c.id === p.category_id);
      const stockClass = p.stock <= 0 ? 'stock-out' : p.stock <= 5 ? 'stock-low' : 'stock-ok';
      const thumb = p.primaryImage
        ? `<img src="${p.primaryImage.image_url}" alt="" class="product-thumb">`
        : `<div class="product-thumb product-thumb--empty">&#128247;</div>`;
      return `
      <tr class="${p.is_active === false ? 'row-inactive' : ''}">
        <td>${thumb}</td>
        <td>
          <div class="product-cell">
            <strong>${escapeHtml(p.name)}</strong>
            <small class="product-cell__slug">${escapeHtml(p.slug)}</small>
          </div>
        </td>
        <td>${cat ? cat.name : '—'}</td>
        <td>
          <span class="price-current">$${p.price.toFixed(2)}</span>
          ${p.old_price ? `<span class="price-old">$${p.old_price.toFixed(2)}</span>` : ''}
        </td>
        <td><span class="stock-badge ${stockClass}">${p.stock}</span></td>
        <td>${p.badge ? badgeLabel(p.badge) : '—'}</td>
        <td>${p.is_active !== false ? '<span class="status-badge status-active">Activo</span>' : '<span class="status-badge status-inactive">Inactivo</span>'}</td>
        <td class="table-actions">
          ${productFilters.sort === 'manual' ? `
            <button class="btn-icon" onclick="moveProduct('${p.id}', -1)" title="Subir">&#9650;</button>
            <button class="btn-icon" onclick="moveProduct('${p.id}', 1)" title="Bajar">&#9660;</button>
          ` : ''}
          <button class="btn-icon btn-edit" onclick="openProductModal('${p.id}')" title="Editar">&#9998;</button>
          <button class="btn-icon btn-delete" onclick="deleteProduct('${p.id}')" title="Desactivar">&#128465;</button>
        </td>
      </tr>
    `;
    }).join('');
  }

  // Render pagination
  const pagEl = document.getElementById('productPagination');
  if (pagEl) {
    pagEl.innerHTML = `
      <button class="admin-btn admin-btn--secondary admin-btn--sm" onclick="changeProductPage(-1)" ${productPage <= 1 ? 'disabled' : ''}>&#8592; Anterior</button>
      <span class="admin-pagination__info">Página ${productPage} de ${totalPages}</span>
      <button class="admin-btn admin-btn--secondary admin-btn--sm" onclick="changeProductPage(1)" ${productPage >= totalPages ? 'disabled' : ''}>Siguiente &#8594;</button>
    `;
  }
}

function changeProductPage(delta) {
  productPage += delta;
  renderProducts();
}

function handleProductFilter(field, value) {
  productFilters[field] = value;
  productPage = 1;
  renderProducts();
}

// Debounced search
let productSearchTimer;
function handleProductSearch(value) {
  clearTimeout(productSearchTimer);
  productSearchTimer = setTimeout(() => {
    productFilters.search = value;
    productPage = 1;
    renderProducts();
  }, 300);
}

async function moveProduct(productId, direction) {
  const sorted = getFilteredProducts();
  const ids = sorted.map(p => p.id);
  const currentIndex = ids.indexOf(productId);
  const newIndex = currentIndex + direction;
  if (newIndex < 0 || newIndex >= ids.length) return;

  [ids[currentIndex], ids[newIndex]] = [ids[newIndex], ids[currentIndex]];

  try {
    await api('/products/reorder', {
      method: 'PUT',
      body: JSON.stringify({ product_ids: ids }),
    });
    await loadProducts();
    renderProducts();
  } catch (e) {
    showToast('Error al reordenar', true);
    console.error(e);
  }
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

    document.getElementById('productImagesSection').style.display = 'block';
    loadProductImages(id);
  } else {
    title.textContent = 'Nuevo Producto';
    document.getElementById('productActive').checked = true;
    document.getElementById('productImagesSection').style.display = 'none';
    document.getElementById('productImagesGrid').innerHTML = '';
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
  const form = document.getElementById('productForm');
  const btn = form.querySelector('button[type="submit"]');
  clearFieldErrors(form);

  const nameErr = validateRequired(document.getElementById('productName').value, 'Nombre');
  const slugErr = validateSlug(document.getElementById('productSlug').value);
  const priceErr = validatePrice(document.getElementById('productPrice').value);
  const catErr = validateRequired(document.getElementById('productCategorySelect').value, 'Categoría');
  const stockErr = validateStock(document.getElementById('productStock').value);

  if (nameErr) { showFieldError(document.getElementById('productName'), nameErr); return; }
  if (slugErr) { showFieldError(document.getElementById('productSlug'), slugErr); return; }
  if (priceErr) { showFieldError(document.getElementById('productPrice'), priceErr); return; }
  if (catErr) { showFieldError(document.getElementById('productCategorySelect'), catErr); return; }
  if (stockErr) { showFieldError(document.getElementById('productStock'), stockErr); return; }

  setButtonLoading(btn, true, 'Guardar');

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
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      showToast('Error: ese slug ya existe', true);
    } else {
      showToast('Error al guardar producto', true);
    }
    console.error(e);
  } finally {
    setButtonLoading(btn, false);
    await loadProducts();
    renderProducts();
  }
}

async function deleteProduct(id) {
  const p = products.find(pr => pr.id === id);
  const ok = await showConfirm('Desactivar producto', `¿Desactivar "${p.name}"? No se mostrará en la tienda.`, 'Desactivar');
  if (!ok) return;

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
// PRODUCT IMAGES
// ═══════════════════════════════════════════
async function loadProductImages(productId) {
  const grid = document.getElementById('productImagesGrid');
  grid.innerHTML = '<span style="color:#999;font-size:0.85rem">Cargando imágenes...</span>';

  try {
    const images = await api(`/products/${productId}/images`);
    if (images.length === 0) {
      grid.innerHTML = '<span style="color:#999;font-size:0.85rem">Sin imágenes. Sube la primera.</span>';
      return;
    }
    grid.innerHTML = images.map((img, i) => `
      <div class="product-image-card ${i === 0 ? 'primary' : ''}" data-image-id="${img.id}">
        <img src="${img.image_url}" alt="Producto">
        <div class="product-image-card__actions">
          ${i > 0 ? `<button type="button" class="product-image-card__btn" onclick="moveImage('${img.id}', '${productId}', -1)" title="Mover izquierda">&#9664;</button>` : ''}
          ${i < images.length - 1 ? `<button type="button" class="product-image-card__btn" onclick="moveImage('${img.id}', '${productId}', 1)" title="Mover derecha">&#9654;</button>` : ''}
          <button type="button" class="product-image-card__btn product-image-card__btn--delete" onclick="deleteProductImage('${img.id}', '${productId}')" title="Eliminar">&#10005;</button>
        </div>
        ${i === 0 ? '<div class="product-image-card__primary-label">Principal</div>' : ''}
      </div>
    `).join('');
  } catch (e) {
    grid.innerHTML = '<span style="color:#b91c1c;font-size:0.85rem">Error al cargar imágenes</span>';
    console.error(e);
  }
}

async function uploadProductImages() {
  const fileInput = document.getElementById('productImageFile');
  const files = Array.from(fileInput.files);
  if (files.length === 0 || !editingProductId) return;

  const oversized = files.filter(f => f.size > 5 * 1024 * 1024);
  if (oversized.length > 0) {
    showToast(`${oversized.length} imagen(es) superan 5MB`, true);
    fileInput.value = '';
    return;
  }

  showToast(`Subiendo ${files.length} imagen(es)...`);
  const uploadBtn = document.querySelector('#productImagesSection .admin-btn--secondary');
  if (uploadBtn) uploadBtn.disabled = true;
  let uploaded = 0;
  let errors = 0;

  try {
    for (const file of files) {
      const formData = new FormData();
      formData.append('productId', editingProductId);
      formData.append('file', file);
      formData.append('isPrimary', 'false');

      try {
        const res = await fetch(`${API_URL}/images/upload`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error();
        uploaded++;
      } catch (e) {
        errors++;
        console.error('Error uploading', file.name, e);
      }
    }

    if (errors > 0) {
      showToast(`${uploaded} subidas, ${errors} fallidas`, true);
    } else {
      showToast(`${uploaded} imagen(es) subidas`);
    }
  } finally {
    if (uploadBtn) uploadBtn.disabled = false;
  }

  fileInput.value = '';
  loadProductImages(editingProductId);
}

async function deleteProductImage(imageId, productId) {
  const ok = await showConfirm('Eliminar imagen', '¿Eliminar esta imagen del producto?');
  if (!ok) return;

  try {
    await api(`/images/${imageId}`, { method: 'DELETE' });
    showToast('Imagen eliminada');
    loadProductImages(productId);
  } catch (e) {
    showToast('Error al eliminar imagen', true);
    console.error(e);
  }
}

async function moveImage(imageId, productId, direction) {
  try {
    const grid = document.getElementById('productImagesGrid');
    const cards = Array.from(grid.querySelectorAll('.product-image-card'));
    const ids = cards.map(c => c.dataset.imageId);

    const currentIndex = ids.indexOf(imageId);
    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= ids.length) return;

    // Swap in array
    [ids[currentIndex], ids[newIndex]] = [ids[newIndex], ids[currentIndex]];

    // Send full reorder
    await api('/images/reorder', {
      method: 'PUT',
      body: JSON.stringify({ image_ids: ids }),
    });

    loadProductImages(productId);
  } catch (e) {
    showToast('Error al reordenar', true);
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
      <td>${escapeHtml(order.customer_name)}</td>
      <td>${escapeHtml(order.customer_phone)}</td>
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
  const btn = document.querySelector('.admin-order-status-update__controls .admin-btn');
  setButtonLoading(btn, true, 'Actualizar');

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
  } finally {
    setButtonLoading(btn, false, 'Actualizar');
  }
}

// ═══════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════
let confirmResolve = null;

function showConfirm(title, message, btnText = 'Eliminar') {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    document.getElementById('confirmDialogTitle').textContent = title;
    document.getElementById('confirmDialogMessage').textContent = message;
    const btn = document.getElementById('confirmDialogBtn');
    btn.textContent = btnText;
    btn.onclick = () => { closeConfirmDialog(true); };
    document.getElementById('confirmOverlay').classList.add('open');
    document.getElementById('confirmDialog').classList.add('open');
  });
}

function closeConfirmDialog(result = false) {
  document.getElementById('confirmDialog').classList.remove('open');
  document.getElementById('confirmOverlay').classList.remove('open');
  if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(result); }
}

// ═══════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════
function openModal(modal) {
  document.getElementById('modalOverlay').classList.add('open');
  modal.classList.add('open');
}

async function closeModals() {
  const wasEditingProduct = editingProductId != null;
  document.getElementById('modalOverlay').classList.remove('open');
  document.querySelectorAll('.admin-modal').forEach(m => m.classList.remove('open'));
  editingCategoryId = null;
  editingProductId = null;

  if (wasEditingProduct) {
    await loadProducts();
    renderProducts();
  }
}

// ═══════════════════════════════════════════
// EMOJI PICKER
// ═══════════════════════════════════════════
const EMOJI_OPTIONS = [
  '💃','💧','✨','🎗','🔥','🎁','❤️','💋','🌹','💜',
  '💖','💕','🖤','💎','👙','👗','🩱','🧴','💦','🫧',
  '🍓','🍒','🍑','🌶️','⚡','🎀','🎯','🏷️','🛒','📦',
  '🔒','💪','⭐','🌟','✅','🆕','🎉','👑','🧸','🕯️',
  '🫦','👠','🥂','💝','🎭','🪄','🌙','☁️','🍫','🧲',
];

function renderEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  picker.innerHTML = EMOJI_OPTIONS.map(emoji =>
    `<button type="button" class="emoji-picker__btn" data-emoji="${emoji}">${emoji}</button>`
  ).join('');
}

function syncEmojiPicker(value) {
  const picker = document.getElementById('emojiPicker');
  picker.querySelectorAll('.emoji-picker__btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.emoji === value);
  });
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

  // Emoji picker - single delegated listener
  document.getElementById('emojiPicker').addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-picker__btn');
    if (!btn) return;
    document.getElementById('categoryIcon').value = btn.dataset.emoji;
    document.querySelectorAll('.emoji-picker__btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  loadFiltersFromHash();
  await loadAll();
  showSection(getSectionFromHash());
  restoreFilterInputs();
  document.querySelector('.admin-content').classList.add('ready');
}

init();
