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
let productFilters = {
  search: '',
  category: '',
  status: '',
  badge: '',
  sort: 'newest',
};
let productPage = 1;
const PRODUCTS_PER_PAGE = 10;

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
        p.primaryImage = images.find(i => i.is_primary) || images[0] || null;
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
  window.location.hash = section;

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
  const hash = window.location.hash.replace('#', '');
  const valid = ['dashboard', 'categories', 'products', 'orders'];
  return valid.includes(hash) ? hash : 'dashboard';
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
            <strong>${p.name}</strong>
            <small class="product-cell__slug">${p.slug}</small>
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
      <div class="product-image-card ${img.is_primary ? 'primary' : ''}" data-image-id="${img.id}">
        <img src="${img.image_url}" alt="Producto">
        <div class="product-image-card__actions">
          ${i > 0 ? `<button type="button" class="product-image-card__btn" onclick="moveImage('${img.id}', '${productId}', -1)" title="Mover izquierda">&#9664;</button>` : ''}
          ${i < images.length - 1 ? `<button type="button" class="product-image-card__btn" onclick="moveImage('${img.id}', '${productId}', 1)" title="Mover derecha">&#9654;</button>` : ''}
          ${!img.is_primary ? `<button type="button" class="product-image-card__btn" onclick="setPrimaryImage('${img.id}', '${productId}')" title="Hacer principal">&#11088;</button>` : ''}
          <button type="button" class="product-image-card__btn product-image-card__btn--delete" onclick="deleteProductImage('${img.id}', '${productId}')" title="Eliminar">&#10005;</button>
        </div>
        ${img.is_primary ? '<div class="product-image-card__primary-label">Principal</div>' : ''}
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

  // Check if product already has images to determine primary and order
  let existingImages = [];
  try {
    existingImages = await api(`/products/${editingProductId}/images`);
  } catch (e) { /* no images yet */ }

  const hasPrimary = existingImages.some(img => img.is_primary);
  let nextOrder = existingImages.length;

  showToast(`Subiendo ${files.length} imagen(es)...`);
  let uploaded = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const formData = new FormData();
    formData.append('productId', editingProductId);
    formData.append('file', file);
    formData.append('isPrimary', (!hasPrimary && i === 0) ? 'true' : 'false');

    try {
      const res = await fetch(`${API_URL}/images/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error();

      // Set display_order for this image
      const imgData = await res.json();
      if (imgData.id) {
        await api(`/images/${imgData.id}/order`, {
          method: 'PUT',
          body: JSON.stringify({ display_order: nextOrder }),
        });
      }

      nextOrder++;
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

async function setPrimaryImage(imageId, productId) {
  try {
    await api(`/images/${imageId}/primary`, { method: 'PUT' });
    showToast('Imagen principal actualizada');
    loadProductImages(productId);
  } catch (e) {
    showToast('Error al actualizar imagen', true);
    console.error(e);
  }
}

async function moveImage(imageId, productId, direction) {
  try {
    const grid = document.getElementById('productImagesGrid');
    const cards = grid.querySelectorAll('.product-image-card');
    let currentOrder = -1;

    cards.forEach((card, i) => {
      if (card.dataset.imageId === imageId) currentOrder = i;
    });

    const newOrder = currentOrder + direction;
    if (newOrder < 0 || newOrder >= cards.length) return;

    await api(`/images/${imageId}/order`, {
      method: 'PUT',
      body: JSON.stringify({ display_order: newOrder }),
    });

    // Swap the other image's order
    const otherCard = cards[newOrder];
    if (otherCard) {
      await api(`/images/${otherCard.dataset.imageId}/order`, {
        method: 'PUT',
        body: JSON.stringify({ display_order: currentOrder }),
      });
    }

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

function closeModals() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.querySelectorAll('.admin-modal').forEach(m => m.classList.remove('open'));
  editingCategoryId = null;
  editingProductId = null;
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
  const input = document.getElementById('categoryIcon');

  picker.innerHTML = EMOJI_OPTIONS.map(emoji =>
    `<button type="button" class="emoji-picker__btn" data-emoji="${emoji}">${emoji}</button>`
  ).join('');

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-picker__btn');
    if (!btn) return;

    input.value = btn.dataset.emoji;

    picker.querySelectorAll('.emoji-picker__btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
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

  await loadAll();
  showSection(getSectionFromHash());
}

init();
