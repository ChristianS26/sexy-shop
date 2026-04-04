// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const API_URL = APP_CONFIG.API_URL;

// Visual mappings per category slug (bg gradient + emoji fallback)
const CATEGORY_VISUALS = {
  lenceria:       { bg: 'linear-gradient(135deg, #1a1a2e 0%, #2d2d44 100%)', emoji: '💃' },
  lubricantes:    { bg: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)', emoji: '💧' },
  vibradores:     { bg: 'linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%)', emoji: '✨' },
  juguetes:       { bg: 'linear-gradient(135deg, #1a1a2e 0%, #374151 100%)', emoji: '🎗' },
  multiorgasmicos:{ bg: 'linear-gradient(135deg, #fce7f3 0%, #FCE7F3 100%)', emoji: '🔥' },
  accesorios:     { bg: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)', emoji: '🎁' },
};

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let categories = [];
let products = [];
let cart = JSON.parse(localStorage.getItem('cart') || '[]');
let activeCategory = 'todos';

// ═══════════════════════════════════════════
// API
// ═══════════════════════════════════════════
async function fetchCategories() {
  try {
    const res = await fetch(`${API_URL}/categories`);
    const data = await res.json();
    categories = data.map(cat => ({
      ...cat,
      visuals: CATEGORY_VISUALS[cat.slug] || { bg: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)', emoji: cat.icon }
    }));
  } catch (e) {
    console.error('Error fetching categories:', e);
  }
}

async function fetchProducts() {
  try {
    const res = await fetch(`${API_URL}/products`);
    products = await res.json();

    // Load images for each product
    await Promise.all(products.map(async (p) => {
      try {
        const imgRes = await fetch(`${API_URL}/products/${p.id}/images`);
        const images = await imgRes.json();
        p.images = images;
        p.primaryImage = images[0] || null;
      } catch (e) {
        p.images = [];
        p.primaryImage = null;
      }
    }));
  } catch (e) {
    console.error('Error fetching products:', e);
  }
}

function getCategoryByProduct(product) {
  return categories.find(c => c.id === product.category_id);
}

function getProductVisuals(product) {
  const cat = getCategoryByProduct(product);
  if (cat) return cat.visuals;
  return { bg: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)', emoji: '🛍' };
}

// ═══════════════════════════════════════════
// AGE VERIFICATION
// ═══════════════════════════════════════════
function verifyAge(isAdult) {
  if (isAdult) {
    document.getElementById('ageModal').classList.add('hidden');
    document.body.classList.remove('no-scroll');
    sessionStorage.setItem('ageVerified', 'true');
  } else {
    window.location.href = 'https://www.google.com';
  }
}

if (sessionStorage.getItem('ageVerified') === 'true') {
  document.getElementById('ageModal').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 20);
});

function toggleMenu() {
  document.getElementById('navLinks').classList.toggle('mobile-open');
}

// Smooth scroll for all internal anchor links
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (!link) return;

  const href = link.getAttribute('href');
  if (!href || href === '#') return;

  const target = document.querySelector(href);
  if (target) {
    e.preventDefault();
    document.getElementById('navLinks').classList.remove('mobile-open');
    target.scrollIntoView({ behavior: 'smooth' });
  }
});

// ═══════════════════════════════════════════
// STATE — STORE SORT
// ═══════════════════════════════════════════
let storeSort = 'default';

// ═══════════════════════════════════════════
// RENDER CATEGORY TABS
// ═══════════════════════════════════════════
function renderCategories() {
  const grid = document.getElementById('categoriesGrid');

  const allTab = { id: 'todos', name: 'Todos', icon: '⭐' };
  const tabs = [allTab, ...categories];

  grid.innerHTML = tabs.map(cat => `
    <button type="button" class="catalog-tab ${cat.id === activeCategory ? 'catalog-tab--active' : ''}"
            onclick="filterCategory('${cat.id}')">
      <span class="catalog-tab__icon">${cat.icon}</span>
      <span class="catalog-tab__name">${escapeHtml(cat.name)}</span>
    </button>
  `).join('');
}

function filterCategory(catId) {
  activeCategory = catId;
  renderCategories();
  renderProducts();
}

function changeStoreSort(value) {
  storeSort = value;
  renderProducts();
}

// ═══════════════════════════════════════════
// RENDER PRODUCTS
// ═══════════════════════════════════════════
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  let filtered = activeCategory === 'todos'
    ? [...products]
    : products.filter(p => p.category_id === activeCategory);

  // Sort
  switch (storeSort) {
    case 'price-asc': filtered.sort((a, b) => a.price - b.price); break;
    case 'price-desc': filtered.sort((a, b) => b.price - a.price); break;
    case 'newest': filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); break;
    case 'name-asc': filtered.sort((a, b) => a.name.localeCompare(b.name)); break;
    default: filtered.sort((a, b) => a.display_order - b.display_order); break;
  }

  // Update count
  const countEl = document.getElementById('productCount');
  if (countEl) countEl.textContent = `${filtered.length} producto${filtered.length !== 1 ? 's' : ''}`;

  grid.innerHTML = filtered.map(product => {
    const visuals = getProductVisuals(product);
    const cat = getCategoryByProduct(product);
    const isDark = visuals.bg.includes('#1a1a2e');

    return `
    <div class="product-card" data-id="${product.id}">
      <div class="product-image">
        ${product.primaryImage
          ? `<div class="product-image-bg" style="background:#fff"><img src="${product.primaryImage.image_url}" alt="${product.name}" style="width:100%;height:100%;object-fit:cover;"></div>`
          : `<div class="product-image-bg" style="background:${visuals.bg}"><span style="font-size:3.5rem;${isDark ? 'filter:brightness(2);' : ''}">${visuals.emoji}</span></div>`
        }
        ${product.badge ? `<span class="product-badge badge-${product.badge}">${product.badge === 'new' ? 'Nuevo' : product.badge === 'hot' ? 'Popular' : 'Oferta'}</span>` : ''}
        ${product.stock <= 0 ? '<span class="product-badge badge-soldout">Agotado</span>' : ''}
        <div class="product-quick-add" onclick="addToCart('${product.id}')">${product.stock <= 0 ? 'Agotado' : 'Agregar al carrito'}</div>
      </div>
      <div class="product-info">
        <div class="product-category">${cat ? escapeHtml(cat.name) : ''}</div>
        <h3 class="product-name">${escapeHtml(product.name)}</h3>
        <p class="product-desc">${escapeHtml(product.description || '')}</p>
        <div class="product-footer">
          <div>
            <span class="product-price">$${product.price.toFixed(2)}</span>
            ${product.old_price ? `<span class="product-price-old">$${product.old_price.toFixed(2)}</span>` : ''}
          </div>
          <button class="product-add-btn" onclick="addToCart('${product.id}')" title="Agregar al carrito">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
  }).join('');
}

// ═══════════════════════════════════════════
// CART
// ═══════════════════════════════════════════
function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  if (product.stock <= 0) {
    showToast('Producto agotado');
    return;
  }

  const existing = cart.find(item => item.id === productId);
  const currentQty = existing ? existing.qty : 0;

  if (currentQty >= product.stock) {
    showToast(`Solo hay ${product.stock} disponibles`);
    return;
  }

  if (existing) {
    existing.qty++;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      category_id: product.category_id,
      qty: 1
    });
  }

  saveCart();
  updateCart();
  showToast(`${product.name} agregado al carrito`);
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  saveCart();
  updateCart();
}

function updateQty(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(productId);
    return;
  }
  saveCart();
  updateCart();
}

function updateCart() {
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  const countEl = document.getElementById('cartCount');
  countEl.textContent = totalItems;
  countEl.classList.toggle('show', totalItems > 0);

  const itemsEl = document.getElementById('cartItems');
  const footerEl = document.getElementById('cartFooter');

  if (cart.length === 0) {
    footerEl.style.display = 'none';
    itemsEl.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">&#128722;</div>
        <p>Tu carrito está vacío</p>
        <small>Agrega productos para comenzar</small>
      </div>`;
  } else {
    footerEl.style.display = 'block';
    document.getElementById('cartTotal').textContent = `$${totalPrice.toFixed(2)} MXN`;

    itemsEl.innerHTML = cart.map(item => {
      const product = products.find(p => p.id === item.id);
      const visuals = product ? getProductVisuals(product) : { bg: '#f3f4f6', emoji: '🛍' };

      return `
      <div class="cart-item">
        <div class="cart-item-img" style="background:${visuals.bg}">
          <span>${visuals.emoji}</span>
        </div>
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.name)}</div>
          <div class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</div>
        </div>
        <div class="cart-item-qty">
          <button type="button" onclick="updateQty('${item.id}', -1)">&minus;</button>
          <span>${item.qty}</span>
          <button type="button" onclick="updateQty('${item.id}', 1)">+</button>
        </div>
      </div>
    `;
    }).join('');
  }
}

function toggleCart() {
  const overlay = document.getElementById('cartOverlay');
  const sidebar = document.getElementById('cartSidebar');
  const isOpen = sidebar.classList.contains('open');

  overlay.classList.toggle('open', !isOpen);
  sidebar.classList.toggle('open', !isOpen);
  document.body.classList.toggle('no-scroll', !isOpen);
}

function showCheckoutForm() {
  document.getElementById('cartItems').style.display = 'none';
  document.getElementById('cartFooter').style.display = 'none';
  document.getElementById('checkoutForm').style.display = 'flex';
  document.getElementById('checkoutTotal').textContent = document.getElementById('cartTotal').textContent;
}

function hideCheckoutForm() {
  document.getElementById('checkoutForm').style.display = 'none';
  document.getElementById('cartItems').style.display = 'block';
  document.getElementById('cartFooter').style.display = 'block';
}

async function processOrder() {
  const name = document.getElementById('checkoutName').value.trim();
  const phone = document.getElementById('checkoutPhone').value.trim();
  const address = document.getElementById('checkoutAddress').value.trim();
  const notes = document.getElementById('checkoutNotes').value.trim();

  if (!name) { showToast('Ingresa tu nombre'); return; }
  if (!phone) { showToast('Ingresa tu número de WhatsApp'); return; }

  const payBtn = document.getElementById('payBtn');
  payBtn.disabled = true;
  payBtn.textContent = 'Procesando...';

  try {
    const orderData = {
      customer_name: name,
      customer_phone: phone,
      customer_address: address || null,
      notes: notes || null,
      items: cart.map(item => ({
        product_id: item.id,
        quantity: item.qty,
      })),
    };

    const res = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error al crear pedido');
    }

    const order = await res.json();

    // Show success in the checkout form
    document.getElementById('checkoutForm').innerHTML = `
      <div class="checkout-success">
        <div class="checkout-success__icon">&#10004;</div>
        <h3 class="checkout-success__title">¡Pedido creado!</h3>
        <p class="checkout-success__id">Pedido #${order.id.slice(0, 8)}</p>
        <p class="checkout-success__msg">Te contactaremos por WhatsApp para coordinar el pago y la entrega.</p>
        <a href="https://wa.me/${APP_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hola, acabo de hacer el pedido #${order.id.slice(0, 8)}. ¿Me pueden confirmar?`)}" target="_blank" class="checkout-success__wa-btn">
          Confirmar por WhatsApp
        </a>
        <button class="checkout-success__close" onclick="closeAfterOrder()">Seguir comprando</button>
      </div>
    `;

    // Clear cart
    cart = [];
    saveCart();
    updateCart();
    await fetchProducts();
    renderProducts();

  } catch (err) {
    showToast(err.message || 'Error al crear pedido');
    payBtn.disabled = false;
    payBtn.textContent = 'Pagar pedido';
  }
}

function closeAfterOrder() {
  hideCheckoutForm();
  toggleCart();
  // Reset checkout form for next order
  const form = document.getElementById('checkoutForm');
  if (form.querySelector('.checkout-success')) {
    location.reload();
  }
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ═══════════════════════════════════════════
// SCROLL REVEAL
// ═══════════════════════════════════════════
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
async function init() {
  await Promise.all([fetchCategories(), fetchProducts()]);
  renderCategories();
  renderProducts();
  updateCart();
}

init();
