// ═══════════════════════════════════════════
// AUTH GUARD
// ═══════════════════════════════════════════
const session = getSession();
if (!session || session.role !== 'admin' || isSessionExpired(session)) {
  // Try refresh before kicking out
  if (session && session.refresh_token) {
    refreshSession(session.refresh_token).then(ok => {
      if (!ok) { clearSession(); window.location.href = 'login.html'; }
    });
  } else {
    clearSession();
    window.location.href = 'login.html';
  }
}
// Auto-refresh session every 30 minutes
setInterval(async () => {
  const s = getSession();
  if (!s) { window.location.href = 'login.html'; return; }
  if (isSessionExpired(s) || isSessionExpiringSoon(s)) {
    const ok = await refreshSession(s.refresh_token);
    if (!ok) { clearSession(); window.location.href = 'login.html'; }
  }
}, 30 * 60 * 1000);

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
  sort: 'newest',
};
let productPage = 1;
const PRODUCTS_PER_PAGE = APP_CONFIG.PRODUCTS_PER_PAGE;
let selectedProducts = new Set();
let selectedOrders = new Set();
let expenses = [];
let financeMonth = '';

// ═══════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════
async function api(endpoint, options = {}) {
  const session = getSession();
  const authHeaders = { 'Content-Type': 'application/json' };
  if (session && session.access_token) {
    authHeaders['Authorization'] = `Bearer ${session.access_token}`;
  }
  const res = await fetch(`${API_URL}${endpoint}`, {
    headers: { ...authHeaders, ...options.headers },
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

  const titles = { dashboard: 'Dashboard', categories: 'Categorías', products: 'Productos', orders: 'Pedidos', finances: 'Finanzas' };
  document.getElementById('sectionTitle').textContent = titles[section] || '';

  document.getElementById('adminSidebar').classList.remove('open');

  renderSection(section);
}

function getSectionFromHash() {
  const hash = window.location.hash.replace('#', '').split('?')[0];
  const valid = ['dashboard', 'categories', 'products', 'orders', 'finances'];
  return valid.includes(hash) ? hash : 'dashboard';
}

function saveFiltersToHash() {
  const params = new URLSearchParams();
  if (productFilters.search) params.set('q', productFilters.search);
  if (productFilters.category) params.set('cat', productFilters.category);
  if (productFilters.status) params.set('st', productFilters.status);
  if (productFilters.badge) params.set('badge', productFilters.badge);
  if (productFilters.sort !== 'newest') params.set('sort', productFilters.sort);
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
  productFilters.sort = params.get('sort') || 'newest';
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
    case 'finances': renderFinances(); break;
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
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty"><div class="admin-empty-state"><div class="admin-empty-state__icon">&#9776;</div><div class="admin-empty-state__title">No hay categor\u00edas</div><div class="admin-empty-state__subtitle">Crea tu primera categor\u00eda para organizar productos.</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = categories
    .sort((a, b) => a.display_order - b.display_order)
    .map(cat => {
      const productCount = products.filter(p => p.category_id === cat.id).length;
      return `
    <tr>
      <td style="font-size:1.5rem">${cat.icon}</td>
      <td><strong>${escapeHtml(cat.name)}</strong></td>
      <td><code>${escapeHtml(cat.slug)}</code></td>
      <td>${productCount}</td>
      <td>${cat.display_order}</td>
      <td class="table-actions">
        <button class="btn-icon" onclick="openCategoryProductOrder('${cat.id}')" title="Ordenar productos">&#9776;</button>
        <button class="btn-icon btn-edit" onclick="openCategoryModal('${cat.id}')" title="Editar">&#9998;</button>
        <button class="btn-icon btn-delete" onclick="deleteCategory('${cat.id}')" title="Eliminar">&#128465;</button>
      </td>
    </tr>
  `;
    }).join('');
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
// CATEGORY PRODUCT ORDER
// ═══════════════════════════════════════════
let categoryOrderIds = [];
let categoryOrderCatId = null;

function openCategoryProductOrder(catId) {
  const cat = categories.find(c => c.id === catId);
  if (!cat) return;

  categoryOrderCatId = catId;
  document.getElementById('categoryOrderTitle').textContent = `Ordenar: ${cat.name}`;

  const catProducts = products
    .filter(p => p.category_id === catId && p.is_active !== false)
    .sort((a, b) => a.display_order - b.display_order);

  categoryOrderIds = catProducts.map(p => p.id);
  renderCategoryOrderGrid(catProducts);

  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('categoryOrderModal').classList.add('open');
}

function renderCategoryOrderGrid(orderedProducts) {
  const grid = document.getElementById('categoryOrderGrid');

  if (orderedProducts.length === 0) {
    grid.innerHTML = '<div class="admin-empty-state"><div class="admin-empty-state__icon">&#9733;</div><div class="admin-empty-state__title">Sin productos</div><div class="admin-empty-state__subtitle">Esta categoría no tiene productos activos.</div></div>';
    return;
  }

  grid.innerHTML = orderedProducts.map((p, i) => {
    const thumb = p.primaryImage
      ? `<img src="${p.primaryImage.image_url}" alt="" class="category-order-card__img">`
      : `<div class="category-order-card__placeholder">&#128247;</div>`;

    return `
    <div class="category-order-card" draggable="true" data-product-id="${p.id}" data-index="${i}">
      <div class="category-order-card__handle" title="Arrastra para mover">&#9776;</div>
      <div class="category-order-card__position">${i + 1}</div>
      ${thumb}
      <div class="category-order-card__info">
        <strong>${escapeHtml(p.name)}</strong>
        <span>${formatCurrency(p.price)}</span>
      </div>
    </div>`;
  }).join('');

  // Setup drag & drop
  setupDragAndDrop(grid);
}

function setupDragAndDrop(grid) {
  let dragIndex = null;

  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.category-order-card');
    if (!card) return;
    dragIndex = parseInt(card.dataset.index);
    card.classList.add('category-order-card--dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  grid.addEventListener('dragend', (e) => {
    const card = e.target.closest('.category-order-card');
    if (card) card.classList.remove('category-order-card--dragging');
    grid.querySelectorAll('.category-order-card--over').forEach(el => el.classList.remove('category-order-card--over'));
    dragIndex = null;
  });

  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.category-order-card');
    if (card && parseInt(card.dataset.index) !== dragIndex) {
      grid.querySelectorAll('.category-order-card--over').forEach(el => el.classList.remove('category-order-card--over'));
      card.classList.add('category-order-card--over');
    }
  });

  grid.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.category-order-card');
    if (card) card.classList.remove('category-order-card--over');
  });

  grid.addEventListener('drop', (e) => {
    e.preventDefault();
    const card = e.target.closest('.category-order-card');
    if (!card || dragIndex === null) return;

    const dropIndex = parseInt(card.dataset.index);
    if (dropIndex === dragIndex) return;

    // Reorder the array
    const [moved] = categoryOrderIds.splice(dragIndex, 1);
    categoryOrderIds.splice(dropIndex, 0, moved);

    const orderedProducts = categoryOrderIds.map(id => products.find(p => p.id === id)).filter(Boolean);
    renderCategoryOrderGrid(orderedProducts);
  });
}

async function saveCategoryOrder() {
  const btn = document.getElementById('saveCategoryOrderBtn');
  setButtonLoading(btn, true, 'Guardar orden');

  try {
    await api('/products/reorder', {
      method: 'PUT',
      body: JSON.stringify({ product_ids: categoryOrderIds }),
    });
    showToast('Orden guardado');
    closeCategoryOrder();
    await loadProducts();
    renderCategories();
  } catch (e) {
    showToast('Error al guardar orden', true);
    console.error(e);
  } finally {
    setButtonLoading(btn, false, 'Guardar orden');
  }
}

function closeCategoryOrder() {
  document.getElementById('categoryOrderModal').classList.remove('open');
  document.getElementById('modalOverlay').classList.remove('open');
  categoryOrderIds = [];
  categoryOrderCatId = null;
}

// ═══════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════
function getFilteredProducts() {
  let filtered = [...products];

  // Search (min 2 chars, match by word start)
  if (productFilters.search && productFilters.search.length >= 2) {
    const q = productFilters.search.toLowerCase();
    filtered = filtered.filter(p => {
      const name = p.name.toLowerCase();
      const slug = p.slug.toLowerCase();
      // Match if name contains the query
      if (name.includes(q)) return true;
      // Match description only for 3+ char queries
      if (q.length >= 3 && (p.description || '').toLowerCase().includes(q)) return true;
      return false;
    });
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
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><div class="admin-empty-state"><div class="admin-empty-state__icon">&#9733;</div><div class="admin-empty-state__title">No se encontraron productos</div><div class="admin-empty-state__subtitle">Intenta cambiar los filtros o crea un nuevo producto.</div></div></td></tr>';
  } else {
    tbody.innerHTML = pageProducts.map(p => {
      const cat = categories.find(c => c.id === p.category_id);
      const threshold = p.low_stock_threshold;
      const stockClass = p.stock <= 0 ? 'stock-out' : (threshold != null && p.stock <= threshold) ? 'stock-low' : 'stock-ok';
      const thumb = p.primaryImage
        ? `<img src="${p.primaryImage.image_url}" alt="" class="product-thumb">`
        : `<div class="product-thumb product-thumb--empty">&#128247;</div>`;
      return `
      <tr class="${p.is_active !== true ? 'row-inactive' : ''}">
        <td><input type="checkbox" class="product-checkbox" data-id="${p.id}" onchange="toggleProductSelect('${p.id}', this.checked)" ${selectedProducts.has(p.id) ? 'checked' : ''}></td>
        <td>${thumb}</td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${cat ? cat.name : '—'}</td>
        <td class="inline-editable" onclick="startInlineEdit('${p.id}', 'price', ${p.price}, this)">
          <span class="price-current">$${p.price.toFixed(2)}</span>
          ${p.old_price ? `<span class="price-old">$${p.old_price.toFixed(2)}</span>` : ''}
        </td>
        <td class="inline-editable" onclick="startInlineEdit('${p.id}', 'stock', ${p.stock}, this)">
          <span class="stock-badge ${stockClass}">${p.stock}</span>
        </td>
        <td>${p.badge ? badgeLabel(p.badge) : '—'}</td>
        <td>
          <button class="status-toggle ${p.is_active === true ? 'status-toggle--active' : ''}" onclick="toggleProductActive('${p.id}')" title="${p.is_active === true ? 'Desactivar' : 'Activar'}">
            <span class="status-toggle__dot"></span>
            <span class="status-toggle__label">${p.is_active === true ? 'Activo' : 'Inactivo'}</span>
          </button>
        </td>
        <td class="table-actions">
          <button class="btn-icon btn-edit" onclick="openProductModal('${p.id}')" title="Editar">&#9998;</button>
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
  const clearBtn = document.getElementById('productSearchClear');
  if (clearBtn) clearBtn.style.display = value ? 'flex' : 'none';
  productSearchTimer = setTimeout(() => {
    productFilters.search = value;
    productPage = 1;
    renderProducts();
  }, 300);
}

function clearProductSearch() {
  const input = document.getElementById('productSearch');
  input.value = '';
  document.getElementById('productSearchClear').style.display = 'none';
  productFilters.search = '';
  productPage = 1;
  renderProducts();
  input.focus();
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
    document.getElementById('productCostPrice').value = p.cost_price || 0;
    document.getElementById('productOldPrice').value = p.old_price || '';
    document.getElementById('productCategorySelect').value = p.category_id;
    document.getElementById('productStock').value = p.stock;
    document.getElementById('productLowStock').value = p.low_stock_threshold ?? '';
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
  const priceErr = validatePrice(document.getElementById('productPrice').value);
  const catErr = validateRequired(document.getElementById('productCategorySelect').value, 'Categoría');
  const stockErr = validateStock(document.getElementById('productStock').value);

  // Auto-generate slug from name
  document.getElementById('productSlug').value = generateSlug(document.getElementById('productName').value);

  if (nameErr) { showFieldError(document.getElementById('productName'), nameErr); return; }
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
    cost_price: parseFloat(document.getElementById('productCostPrice').value) || 0,
    low_stock_threshold: document.getElementById('productLowStock').value ? parseInt(document.getElementById('productLowStock').value) : null,
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

async function toggleProductActive(id) {
  const p = products.find(pr => pr.id === id);
  if (!p) return;

  const isActive = p.is_active === true;
  const action = isActive ? 'desactivar' : 'activar';
  const msg = isActive
    ? `¿Desactivar "${p.name}"? No se mostrará en la tienda.`
    : `¿Activar "${p.name}"? Volverá a mostrarse en la tienda.`;

  const ok = await showConfirm(isActive ? 'Desactivar producto' : 'Activar producto', msg, isActive ? 'Desactivar' : 'Activar');
  if (!ok) return;

  try {
    const result = await api(`/products/${id}/toggle-active`, { method: 'PUT' });
    showToast(result.is_active ? 'Producto activado' : 'Producto desactivado');
    await loadProducts();
    renderProducts();
  } catch (e) {
    showToast(`Error al ${action} producto`, true);
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
    // Hide upload button if at limit
    const uploadArea = document.getElementById('productImageUploadArea');
    if (uploadArea) uploadArea.style.display = images.length >= 5 ? 'none' : 'flex';
  } catch (e) {
    grid.innerHTML = '<span style="color:#b91c1c;font-size:0.85rem">Error al cargar imágenes</span>';
    console.error(e);
  }
}

async function uploadProductImages() {
  const fileInput = document.getElementById('productImageFile');
  const files = Array.from(fileInput.files);
  if (files.length === 0 || !editingProductId) return;

  // Check current image count
  let currentImages = [];
  try { currentImages = await api(`/products/${editingProductId}/images`); } catch (e) {}
  const remaining = 5 - currentImages.length;
  if (remaining <= 0) {
    showToast('Máximo 5 imágenes por producto', true);
    fileInput.value = '';
    return;
  }
  if (files.length > remaining) {
    showToast(`Solo puedes subir ${remaining} imagen(es) más (máx. 5)`, true);
    fileInput.value = '';
    return;
  }

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
        const uploadHeaders = {};
        const sess = getSession();
        if (sess && sess.access_token) {
          uploadHeaders['Authorization'] = `Bearer ${sess.access_token}`;
        }
        const res = await fetch(`${API_URL}/images/upload`, {
          method: 'POST',
          headers: uploadHeaders,
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
// INLINE EDITING
// ═══════════════════════════════════════════
function startInlineEdit(productId, field, currentValue, cell) {
  if (cell.querySelector('.inline-edit-input')) return; // Already editing

  const original = cell.innerHTML;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'inline-edit-input';
  input.value = currentValue;
  input.step = field === 'price' ? '0.01' : '1';
  input.min = field === 'price' ? '0.01' : '0';

  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  const save = async () => {
    const newValue = field === 'price' ? parseFloat(input.value) : parseInt(input.value);
    if (isNaN(newValue) || (field === 'price' && newValue <= 0) || (field === 'stock' && newValue < 0)) {
      cell.innerHTML = original;
      return;
    }

    if (newValue === currentValue) {
      cell.innerHTML = original;
      return;
    }

    try {
      const p = products.find(pr => pr.id === productId);
      if (!p) return;
      const updateData = {
        name: p.name, slug: p.slug, description: p.description,
        price: field === 'price' ? newValue : p.price,
        old_price: p.old_price, category_id: p.category_id,
        stock: field === 'stock' ? newValue : p.stock,
        badge: p.badge, is_active: p.is_active, display_order: p.display_order,
      };
      await api(`/products/${productId}`, { method: 'PUT', body: JSON.stringify(updateData) });
      showToast(`${field === 'price' ? 'Precio' : 'Stock'} actualizado`);
      await loadProducts();
      renderProducts();
    } catch (e) {
      cell.innerHTML = original;
      showToast('Error al actualizar', true);
    }
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { cell.innerHTML = original; }
  });
}

// ═══════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════
let orderSearchQuery = '';

function renderOrders() {
  const filterValue = document.getElementById('orderStatusFilter')?.value || 'all';
  let filtered = filterValue === 'all' ? orders : orders.filter(o => o.status === filterValue);

  if (orderSearchQuery) {
    const q = orderSearchQuery.toLowerCase();
    filtered = filtered.filter(o =>
      o.customer_name.toLowerCase().includes(q) ||
      o.customer_phone.includes(q) ||
      o.id.toLowerCase().startsWith(q)
    );
  }

  const sorted = [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const countEl = document.getElementById('orderCount');
  if (countEl) countEl.textContent = `${sorted.length} pedido${sorted.length !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('ordersTable');
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><div class="admin-empty-state"><div class="admin-empty-state__icon">&#128230;</div><div class="admin-empty-state__title">No hay pedidos</div><div class="admin-empty-state__subtitle">Los pedidos aparecer\u00e1n aqu\u00ed cuando los clientes compren.</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(order => `
    <tr>
      <td><input type="checkbox" class="order-checkbox" data-id="${order.id}" onchange="toggleOrderSelect('${order.id}', this.checked)" ${selectedOrders.has(order.id) ? 'checked' : ''}></td>
      <td><code>${order.id.slice(0, 8)}</code></td>
      <td>${escapeHtml(order.customer_name)}</td>
      <td>${escapeHtml(order.customer_phone)}</td>
      <td>${escapeHtml(order.customer_city || order.customer_address || '—')}</td>
      <td>${formatCurrency(order.total)}</td>
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

let orderSearchTimer;
function handleOrderSearch(value) {
  clearTimeout(orderSearchTimer);
  const clearBtn = document.getElementById('orderSearchClear');
  if (clearBtn) clearBtn.style.display = value ? 'flex' : 'none';
  orderSearchTimer = setTimeout(() => {
    orderSearchQuery = value;
    renderOrders();
  }, 300);
}

function clearOrderSearch() {
  const input = document.getElementById('orderSearch');
  input.value = '';
  document.getElementById('orderSearchClear').style.display = 'none';
  orderSearchQuery = '';
  renderOrders();
  input.focus();
}

async function viewOrder(id) {
  try {
    const data = await api(`/orders/${id}`);

    // Handle both formats: {order, items} or direct order object
    const order = data.order || data;
    const items = data.items || [];

    document.getElementById('orderDetailId').textContent = order.id.slice(0, 8);
    document.getElementById('orderDetailName').textContent = order.customer_name;

    const phoneEl = document.getElementById('orderDetailPhone');
    const phoneClean = (order.customer_phone || '').replace(/\D/g, '');
    phoneEl.innerHTML = `${escapeHtml(order.customer_phone)} <a href="https://wa.me/52${phoneClean}" target="_blank" class="order-wa-link" title="Contactar por WhatsApp">&#128172;</a>`;

    const emailField = document.getElementById('orderDetailEmailField');
    if (order.customer_email) {
      emailField.style.display = 'flex';
      document.getElementById('orderDetailEmail').textContent = order.customer_email;
    } else {
      emailField.style.display = 'none';
    }

    // Build address block
    const addrParts = [];
    if (order.customer_street) addrParts.push(order.customer_street);
    if (order.customer_neighborhood) addrParts.push(`Col. ${order.customer_neighborhood}`);
    const cityLine = [order.customer_city, order.customer_state].filter(Boolean).join(', ');
    if (cityLine) addrParts.push(cityLine);
    if (order.customer_zip) addrParts.push(`C.P. ${order.customer_zip}`);
    if (order.customer_references) addrParts.push(`Ref: ${order.customer_references}`);
    document.getElementById('orderDetailAddress').textContent = addrParts.length > 0 ? addrParts.join('\n') : (order.customer_address || '—');

    document.getElementById('orderDetailNotes').value = order.notes || '';
    document.getElementById('orderDetailTotal').textContent = formatCurrency(order.total);
    document.getElementById('orderDetailDate').textContent = formatDate(order.created_at);

    const select = document.getElementById('orderStatusSelect');
    select.value = order.status;
    select.dataset.orderId = order.id;

    // Items table
    const tbody = document.getElementById('orderDetailItems');
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px">Sin detalle de productos</td></tr>';
    } else {
      tbody.innerHTML = items.map(item => `
        <tr>
          <td>${escapeHtml(item.product_name)}</td>
          <td>${item.quantity}</td>
          <td>${formatCurrency(item.unit_price)}</td>
          <td>${formatCurrency(item.subtotal)}</td>
        </tr>
      `).join('');
    }

    // Open modal first, then render dynamic content
    const orderModal = document.getElementById('orderDetailModal');
    console.log('Order modal element:', orderModal, 'classList:', orderModal?.classList?.toString());
    if (orderModal) {
      openModal(orderModal);
    } else {
      console.error('orderDetailModal NOT FOUND in DOM');
      showToast('Error: modal no encontrado', true);
    }

    // Quick actions based on current status
    try { renderQuickActions(order); } catch (_) {}

    // Load timeline (non-blocking)
    loadOrderTimeline(order.id);

  } catch (e) {
    showToast('Error al cargar pedido', true);
    console.error(e);
  }
}

function renderQuickActions(order) {
  const el = document.getElementById('orderQuickActions');
  const transitions = {
    pending: { next: 'confirmed', label: 'Confirmar pedido', color: '#3b82f6' },
    confirmed: { next: 'shipped', label: 'Marcar como enviado', color: '#8b5cf6' },
    shipped: { next: 'delivered', label: 'Marcar como entregado', color: '#10b981' },
  };

  const t = transitions[order.status];
  let html = '';

  if (t) {
    html += `<button class="admin-btn" style="background:${t.color};color:#fff" onclick="quickStatusChange('${order.id}', '${t.next}')">${t.label}</button>`;
  }

  if (order.status !== 'cancelled' && order.status !== 'delivered') {
    html += `<button class="admin-btn admin-btn--secondary" style="color:#ef4444;border-color:#ef4444" onclick="quickStatusChange('${order.id}', 'cancelled')">Cancelar pedido</button>`;
  }

  el.innerHTML = html || '<span style="color:var(--text-secondary);font-size:0.85rem">Pedido finalizado</span>';
}

async function quickStatusChange(orderId, newStatus) {
  const labels = { confirmed: 'confirmar', shipped: 'enviar', delivered: 'entregar', cancelled: 'cancelar' };
  const ok = await showConfirm('Cambiar estado', `¿Deseas ${labels[newStatus] || 'cambiar'} este pedido?`, labels[newStatus] === 'cancelar' ? 'Cancelar pedido' : 'Confirmar');
  if (!ok) return;

  try {
    await api(`/orders/${orderId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus }),
    });
    showToast('Estado actualizado');
    closeModals();
    await loadOrders();
    renderOrders();
  } catch (e) {
    showToast('Error al actualizar estado', true);
    console.error(e);
  }
}

async function loadOrderTimeline(orderId) {
  const el = document.getElementById('orderTimeline');
  el.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem">Cargando...</span>';

  try {
    const events = await api(`/orders/${orderId}/timeline`);
    if (events.length === 0) {
      el.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem">Sin historial</span>';
      return;
    }

    const eventIcons = { created: '🆕', status_change: '🔄', note_added: '📝' };
    el.innerHTML = events.map(ev => `
      <div class="admin-timeline-item">
        <div class="admin-timeline-dot">${eventIcons[ev.event_type] || '•'}</div>
        <div class="admin-timeline-content">
          <div class="admin-timeline-desc">${escapeHtml(ev.description || ev.event_type)}</div>
          <div class="admin-timeline-time">${formatDate(ev.created_at)}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem">Error al cargar historial</span>';
  }
}

async function saveOrderNotes() {
  const select = document.getElementById('orderStatusSelect');
  const orderId = select.dataset.orderId;
  const notes = document.getElementById('orderDetailNotes').value;
  const btn = document.querySelector('.admin-order-notes .admin-btn');

  if (btn) setButtonLoading(btn, true, 'Guardar notas');

  try {
    await api(`/orders/${orderId}/notes`, {
      method: 'PUT',
      body: JSON.stringify({ notes }),
    });
    showToast('Notas guardadas');
    loadOrderTimeline(orderId);
    await loadOrders();
  } catch (e) {
    showToast('Error al guardar notas', true);
    console.error(e);
  } finally {
    if (btn) setButtonLoading(btn, false, 'Guardar notas');
  }
}

function printOrder() {
  window.print();
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
// FINANCES
// ═══════════════════════════════════════════
function renderFinances() {
  // Set default month to current
  const monthInput = document.getElementById('financeMonth');
  if (!financeMonth) {
    const now = new Date();
    financeMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  monthInput.value = financeMonth;
  loadFinanceData();
}

async function loadFinanceData() {
  const monthInput = document.getElementById('financeMonth');
  financeMonth = monthInput.value;
  if (!financeMonth) return;

  // Show loader
  const section = document.getElementById('financesSection');
  let overlay = section.querySelector('.finance-loader');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'finance-loader';
    overlay.innerHTML = '<div class="finance-loader__spinner"></div><span>Calculando reportes</span>';
    section.style.position = 'relative';
    section.appendChild(overlay);
  }
  overlay.classList.add('active');

  const [year, month] = financeMonth.split('-').map(Number);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

  // Load expenses for the month
  try {
    expenses = await api(`/expenses?from=${from}&to=${to}`);
  } catch (e) {
    expenses = [];
  }


  // Filter orders for this month (non-cancelled)
  const monthOrders = orders.filter(o => {
    if (o.status === 'cancelled') return false;
    if (!o.created_at) return false;
    const d = o.created_at.slice(0, 10);
    return d >= from && d <= to;
  });

  // Calculate revenue
  const revenue = monthOrders.reduce((sum, o) => sum + o.total, 0);

  // Calculate cost and product breakdown
  // We need order items — load them for each order
  const productSales = {};
  for (const order of monthOrders) {
    try {
      const detail = await api(`/orders/${order.id}`);
      const items = detail.items || [];
      items.forEach(item => {
        const product = products.find(p => p.id === item.product_id);
        const costPrice = product ? (product.cost_price || 0) : 0;
        const key = item.product_name;
        if (!productSales[key]) {
          productSales[key] = { name: key, qty: 0, revenue: 0, cost: 0 };
        }
        productSales[key].qty += item.quantity;
        productSales[key].revenue += item.subtotal;
        productSales[key].cost += costPrice * item.quantity;
      });
    } catch (e) { /* skip */ }
  }

  const totalCost = Object.values(productSales).reduce((sum, p) => sum + p.cost, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = revenue - totalCost - totalExpenses;
  const commission25 = Math.max(0, netProfit * 0.25);
  const commission75 = Math.max(0, netProfit * 0.75);
  const totalInvestor = totalCost + commission25;
  const totalPartner = commission75;

  // Summary cards
  document.getElementById('finVentas').textContent = formatCurrency(revenue);
  document.getElementById('finCosto').textContent = formatCurrency(totalCost);
  document.getElementById('finGastos').textContent = formatCurrency(totalExpenses);
  document.getElementById('finGanancia').textContent = formatCurrency(netProfit);

  // Split cards
  document.getElementById('finInvRecuperada').textContent = formatCurrency(totalCost);
  document.getElementById('finComision25').textContent = formatCurrency(commission25);
  document.getElementById('finTotalInv').textContent = formatCurrency(totalInvestor);
  document.getElementById('finComision75').textContent = formatCurrency(commission75);
  document.getElementById('finTotalSocia').textContent = formatCurrency(totalPartner);

  // Cash balance: initial balance + all-time revenue - all-time expenses
  try {
    const settingRes = await api('/settings/initial_balance');
    const initialBalance = parseFloat(settingRes.value) || 0;
    const allNonCancelled = orders.filter(o => o.status !== 'cancelled');
    const allTimeRevenue = allNonCancelled.reduce((sum, o) => sum + o.total, 0);
    let allExpenses = [];
    try { allExpenses = await api('/expenses'); } catch(e) {}
    const allTimeExpenses = allExpenses.reduce((sum, e) => sum + e.amount, 0);
    const cashBalance = initialBalance + allTimeRevenue - allTimeExpenses;
    document.getElementById('finSaldoCaja').textContent = formatCurrency(cashBalance);
    document.getElementById('finSaldoSub').textContent = `${formatCurrency(initialBalance)} inicial + ${formatCurrency(allTimeRevenue)} ventas - ${formatCurrency(allTimeExpenses)} gastos`;
  } catch (e) {
    document.getElementById('finSaldoCaja').textContent = '$0';
  }

  // Products sold table
  const prodBody = document.getElementById('finProductsBody');
  const sortedProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue);
  if (sortedProducts.length === 0) {
    prodBody.innerHTML = '<tr><td colspan="5" class="table-empty">Sin ventas este mes</td></tr>';
  } else {
    prodBody.innerHTML = sortedProducts.map(p => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${p.qty}</td>
        <td>${formatCurrency(p.revenue)}</td>
        <td>${formatCurrency(p.cost)}</td>
        <td>${formatCurrency(p.revenue - p.cost)}</td>
      </tr>
    `).join('');
  }

  // Expenses table
  const expBody = document.getElementById('finExpensesBody');
  if (expenses.length === 0) {
    expBody.innerHTML = '<tr><td colspan="4" class="table-empty">Sin gastos registrados</td></tr>';
  } else {
    expBody.innerHTML = expenses.map(e => `
      <tr>
        <td>${escapeHtml(e.description)}</td>
        <td>${formatCurrency(e.amount)}</td>
        <td>${e.expense_date}</td>
        <td><button class="btn-icon btn-delete" onclick="deleteExpense('${e.id}')" title="Eliminar">&#128465;</button></td>
      </tr>
    `).join('');
  }

  // Hide loader
  overlay.classList.remove('active');
}

async function editInitialBalance() {
  const currentEl = document.getElementById('finSaldoCaja');
  const input = prompt('Saldo inicial en caja:', '10000');
  if (input === null) return;
  const value = parseFloat(input);
  if (isNaN(value) || value < 0) {
    showToast('Ingresa un monto válido', true);
    return;
  }
  try {
    await api('/settings/initial_balance', {
      method: 'PUT',
      body: JSON.stringify({ value: String(value) }),
    });
    showToast('Saldo inicial actualizado');
    loadFinanceData();
  } catch (e) {
    showToast('Error al actualizar', true);
  }
}

function openExpenseModal() {
  const form = document.getElementById('expenseForm');
  form.reset();
  // Default date to today
  document.getElementById('expenseDate').value = new Date().toISOString().slice(0, 10);
  openModal(document.getElementById('expenseModal'));
}

async function saveExpense(e) {
  e.preventDefault();
  const desc = document.getElementById('expenseDesc').value.trim();
  const amount = parseFloat(document.getElementById('expenseAmount').value);
  const date = document.getElementById('expenseDate').value;
  const category = document.getElementById('expenseCategory').value;

  if (!desc || !amount || !date) {
    showToast('Completa todos los campos', true);
    return;
  }

  const btn = document.querySelector('#expenseForm button[type="submit"]');
  setButtonLoading(btn, true, 'Guardar');

  try {
    await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({
        description: desc,
        amount: amount,
        category: category,
        expense_date: date,
      }),
    });
    showToast('Gasto registrado');
    closeModals();
    loadFinanceData();
  } catch (err) {
    showToast('Error al registrar gasto', true);
    console.error(err);
  } finally {
    setButtonLoading(btn, false, 'Guardar');
  }
}

async function deleteExpense(id) {
  const ok = await showConfirm('Eliminar gasto', '¿Eliminar este gasto?');
  if (!ok) return;

  try {
    await api(`/expenses/${id}`, { method: 'DELETE' });
    showToast('Gasto eliminado');
    loadFinanceData();
  } catch (e) {
    showToast('Error al eliminar', true);
  }
}

// ═══════════════════════════════════════════
// WITHDRAWALS
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// BULK OPERATIONS
// ═══════════════════════════════════════════
function toggleProductSelect(id, checked) {
  if (checked) selectedProducts.add(id); else selectedProducts.delete(id);
  updateProductBulkBar();
}

function toggleSelectAllProducts(checked) {
  const checkboxes = document.querySelectorAll('.product-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = checked;
    if (checked) selectedProducts.add(cb.dataset.id); else selectedProducts.delete(cb.dataset.id);
  });
  updateProductBulkBar();
}

function updateProductBulkBar() {
  const bar = document.getElementById('productBulkBar');
  const count = selectedProducts.size;
  bar.style.display = count > 0 ? 'flex' : 'none';
  document.getElementById('productBulkCount').textContent = `${count} seleccionado${count !== 1 ? 's' : ''}`;
}

function clearProductSelection() {
  selectedProducts.clear();
  document.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = false);
  document.getElementById('productSelectAll').checked = false;
  updateProductBulkBar();
}

async function bulkProductAction(action) {
  const count = selectedProducts.size;
  if (count === 0) return;

  const labels = { activate: 'activar', deactivate: 'desactivar', delete: 'eliminar' };
  const ok = await showConfirm('Acción masiva', `¿${labels[action]} ${count} producto${count !== 1 ? 's' : ''}?`, labels[action]);
  if (!ok) return;

  showToast(`Procesando ${count} productos...`);
  let success = 0;

  for (const id of selectedProducts) {
    try {
      if (action === 'delete' || action === 'deactivate') {
        await api(`/products/${id}`, { method: 'DELETE' });
      } else if (action === 'activate') {
        const p = products.find(pr => pr.id === id);
        if (p) await api(`/products/${id}`, { method: 'PUT', body: JSON.stringify({ ...p, is_active: true }) });
      }
      success++;
    } catch (e) { console.error(e); }
  }

  showToast(`${success} de ${count} productos procesados`);
  clearProductSelection();
  await loadProducts();
  renderProducts();
}

function toggleOrderSelect(id, checked) {
  if (checked) selectedOrders.add(id); else selectedOrders.delete(id);
  updateOrderBulkBar();
}

function toggleSelectAllOrders(checked) {
  const checkboxes = document.querySelectorAll('.order-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = checked;
    if (checked) selectedOrders.add(cb.dataset.id); else selectedOrders.delete(cb.dataset.id);
  });
  updateOrderBulkBar();
}

function updateOrderBulkBar() {
  const bar = document.getElementById('orderBulkBar');
  const count = selectedOrders.size;
  bar.style.display = count > 0 ? 'flex' : 'none';
  document.getElementById('orderBulkCount').textContent = `${count} seleccionado${count !== 1 ? 's' : ''}`;
}

function clearOrderSelection() {
  selectedOrders.clear();
  document.querySelectorAll('.order-checkbox').forEach(cb => cb.checked = false);
  document.getElementById('orderSelectAll').checked = false;
  updateOrderBulkBar();
}

async function bulkOrderAction(status) {
  const count = selectedOrders.size;
  if (count === 0) return;

  const labels = { confirmed: 'confirmar', shipped: 'enviar', delivered: 'entregar', cancelled: 'cancelar' };
  const ok = await showConfirm('Acción masiva', `¿${labels[status]} ${count} pedido${count !== 1 ? 's' : ''}?`, labels[status]);
  if (!ok) return;

  showToast(`Procesando ${count} pedidos...`);
  let success = 0;

  for (const id of selectedOrders) {
    try {
      await api(`/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      success++;
    } catch (e) { console.error(e); }
  }

  showToast(`${success} de ${count} pedidos actualizados`);
  clearOrderSelection();
  await loadOrders();
  renderOrders();
}

// ═══════════════════════════════════════════
// CSV EXPORT
// ═══════════════════════════════════════════
function arrayToCSV(headers, rows) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(',')];
  rows.forEach(row => lines.push(row.map(escape).join(',')));
  return '\uFEFF' + lines.join('\n'); // BOM for Excel UTF-8
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportProductsCSV() {
  const filtered = getFilteredProducts();
  const headers = ['Nombre', 'Slug', 'Categoría', 'Precio', 'Precio anterior', 'Stock', 'Badge', 'Activo', 'Orden'];
  const rows = filtered.map(p => {
    const cat = categories.find(c => c.id === p.category_id);
    return [p.name, p.slug, cat ? cat.name : '', p.price, p.old_price || '', p.stock, p.badge || '', p.is_active !== false ? 'Sí' : 'No', p.display_order];
  });
  downloadCSV(arrayToCSV(headers, rows), `productos_${new Date().toISOString().slice(0, 10)}.csv`);
  showToast(`${filtered.length} productos exportados`);
}

function exportOrdersCSV() {
  const filterValue = document.getElementById('orderStatusFilter')?.value || 'all';
  let filtered = filterValue === 'all' ? orders : orders.filter(o => o.status === filterValue);

  if (orderSearchQuery) {
    const q = orderSearchQuery.toLowerCase();
    filtered = filtered.filter(o =>
      o.customer_name.toLowerCase().includes(q) ||
      o.customer_phone.includes(q) ||
      o.id.toLowerCase().startsWith(q)
    );
  }

  const headers = ['ID', 'Cliente', 'Teléfono', 'Dirección', 'Total', 'Estado', 'Notas', 'Fecha'];
  const statusLabels = { pending: 'Pendiente', confirmed: 'Confirmado', shipped: 'Enviado', delivered: 'Entregado', cancelled: 'Cancelado' };
  const rows = filtered.map(o => [
    o.id.slice(0, 8), o.customer_name, o.customer_phone, o.customer_address || '', o.total, statusLabels[o.status] || o.status, o.notes || '', o.created_at ? new Date(o.created_at).toLocaleDateString('es-MX') : ''
  ]);
  const label = filterValue === 'all' ? 'todos' : filterValue;
  downloadCSV(arrayToCSV(headers, rows), `pedidos_${label}_${new Date().toISOString().slice(0, 10)}.csv`);
  showToast(`${filtered.length} pedidos exportados`);
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
    slugInput.value = generateSlug(nameInput.value);
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
  document.getElementById('expenseForm').addEventListener('submit', saveExpense);

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

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const confirmDialog = document.getElementById('confirmDialog');
      if (confirmDialog.classList.contains('open')) {
        closeConfirmDialog();
      } else {
        closeModals();
      }
    }
  });

  loadFiltersFromHash();
  await loadAll();
  showSection(getSectionFromHash());
  restoreFilterInputs();
  document.querySelector('.admin-content').classList.add('ready');
}

init();
