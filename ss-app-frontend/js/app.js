// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const API_URL = APP_CONFIG.API_URL;

// Visual mappings per category slug (bg gradient + emoji fallback)
const CATEGORY_VISUALS = {
  lenceria:       { bg: 'linear-gradient(135deg, #1a1a2e 0%, #2d2d44 100%)', emoji: '👙' },
  lubricantes:    { bg: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)', emoji: '💧' },
  vibradores:     { bg: 'linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%)', emoji: '💜' },
  juguetes:       { bg: 'linear-gradient(135deg, #1a1a2e 0%, #374151 100%)', emoji: '🎲' },
  multiorgasmicos:{ bg: 'linear-gradient(135deg, #fce7f3 0%, #FCE7F3 100%)', emoji: '🔥' },
  accesorios:     { bg: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)', emoji: '🎀' },
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
      <div class="product-image" onclick="openPdp('${product.id}')" style="cursor:pointer">
        ${product.primaryImage
          ? `<div class="product-image-bg" style="background:#fff"><img src="${product.primaryImage.image_url}" alt="${escapeHtml(product.name)}" style="width:100%;height:100%;object-fit:cover;"></div>`
          : `<div class="product-image-bg" style="background:${visuals.bg}"><span style="font-size:3.5rem;${isDark ? 'filter:brightness(2);' : ''}">${visuals.emoji}</span></div>`
        }
        ${product.badge ? `<span class="product-badge badge-${product.badge}">${product.badge === 'new' ? 'Nuevo' : product.badge === 'hot' ? 'Popular' : 'Oferta'}</span>` : ''}
        ${product.stock <= 0 ? '<span class="product-badge badge-soldout">Agotado</span>' : ''}
        <div class="product-quick-add" onclick="event.stopPropagation(); addToCart('${product.id}')">${product.stock <= 0 ? 'Agotado' : 'Agregar al carrito'}</div>
      </div>
      <div class="product-info">
        <div class="product-category">${cat ? escapeHtml(cat.name) : ''}</div>
        <h3 class="product-name" onclick="openPdp('${product.id}')" style="cursor:pointer">${escapeHtml(product.name)}</h3>
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

// ═══════════════════════════════════════════
// CHECKOUT STATE MACHINE
// States: 'cart' → 'method' → 'local' or 'national'
// ═══════════════════════════════════════════
function setCheckoutState(state) {
  const cartItems = document.getElementById('cartItems');
  const cartFooter = document.getElementById('cartFooter');
  const methodSelector = document.getElementById('methodSelector');
  const localForm = document.getElementById('localForm');
  const nationalForm = document.getElementById('nationalForm');
  const cartTitle = document.getElementById('cartTitle');

  cartItems.style.display = 'none';
  cartFooter.style.display = 'none';
  methodSelector.style.display = 'none';
  localForm.style.display = 'none';
  nationalForm.style.display = 'none';

  if (state === 'cart') {
    cartItems.style.display = 'block';
    cartFooter.style.display = 'flex';
    cartTitle.textContent = 'Tu carrito';
  } else if (state === 'method') {
    methodSelector.style.display = 'flex';
    cartTitle.textContent = 'M&eacute;todo de entrega';
    updateMethodSelectorHints();
  } else if (state === 'local') {
    localForm.style.display = 'flex';
    cartTitle.textContent = 'Entrega local';
    updateLocalSummary();
  } else if (state === 'national') {
    nationalForm.style.display = 'flex';
    cartTitle.textContent = 'Env&iacute;o nacional';
    updateNationalSummary();
  }
}

function showMethodSelector() {
  setCheckoutState('method');
}

function backToCart() {
  setCheckoutState('cart');
}

function backToMethodSelector() {
  setCheckoutState('method');
}

function selectDeliveryMethod(method) {
  setCheckoutState(method);
}

function updateMethodSelectorHints() {
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const badge = document.getElementById('localFreeShippingBadge');
  if (!badge) return;
  if (subtotal >= APP_CONFIG.SHIPPING_LOCAL_FREE_THRESHOLD) {
    badge.textContent = '\u2728 \u00a1Env\u00edo GRATIS por tu compra!';
    badge.style.background = '#d1fae5';
    badge.style.color = '#065f46';
  } else {
    const remaining = (APP_CONFIG.SHIPPING_LOCAL_FREE_THRESHOLD - subtotal).toFixed(2);
    badge.textContent = `\u2728 GRATIS al sumar $${remaining} m\u00e1s`;
    badge.style.background = '#fef3c7';
    badge.style.color = '#b45309';
  }
}

function updateLocalSummary() {
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const shipping = calculateShipping('local', subtotal);
  const total = subtotal + shipping;
  document.getElementById('localSubtotal').textContent = `$${subtotal.toFixed(2)}`;
  document.getElementById('localShipping').textContent = shipping === 0 ? 'GRATIS' : `$${shipping.toFixed(2)}`;
  document.getElementById('localTotal').textContent = `$${total.toFixed(2)}`;

  const hint = document.getElementById('localFreeHint');
  if (shipping === 0) {
    hint.textContent = '\u2705 \u00a1Tu env\u00edo es GRATIS!';
    hint.className = 'checkout-summary__hint checkout-summary__hint--unlocked';
    hint.style.display = 'block';
  } else {
    const remaining = (APP_CONFIG.SHIPPING_LOCAL_FREE_THRESHOLD - subtotal).toFixed(2);
    hint.textContent = `\u{1F3AF} Agrega $${remaining} m\u00e1s y tu env\u00edo es GRATIS`;
    hint.className = 'checkout-summary__hint checkout-summary__hint--unlock';
    hint.style.display = 'block';
  }
}

function updateNationalSummary() {
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const shipping = calculateShipping('national', subtotal);
  document.getElementById('checkoutSubtotal').textContent = `$${subtotal.toFixed(2)}`;
  document.getElementById('checkoutTotal').textContent = `$${(subtotal + shipping).toFixed(2)}`;
}

function validateCheckoutField(inputId, message) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) {
    input.classList.add('checkout-field--error');
    input.placeholder = message;
    input.focus();
    return false;
  }
  input.classList.remove('checkout-field--error');
  return true;
}

function validatePhone(inputId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim().replace(/\s|-/g, '');
  if (!value) {
    input.classList.add('checkout-field--error');
    input.placeholder = 'Número requerido';
    input.focus();
    return false;
  }
  if (!/^\d{10,13}$/.test(value)) {
    input.classList.add('checkout-field--error');
    showToast('Ingresa un número válido (10 dígitos)');
    input.focus();
    return false;
  }
  input.classList.remove('checkout-field--error');
  return true;
}

function validateEmail(inputId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) {
    input.classList.add('checkout-field--error');
    input.placeholder = 'Email requerido';
    input.focus();
    showToast('El email es obligatorio');
    return false;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    input.classList.add('checkout-field--error');
    input.focus();
    showToast('Ingresa un email válido');
    return false;
  }
  input.classList.remove('checkout-field--error');
  return true;
}

function clearCheckoutErrors() {
  document.querySelectorAll('.checkout-field--error').forEach(el => el.classList.remove('checkout-field--error'));
}

// ═══════════════════════════════════════════
// LOCAL ORDER FLOW (Guaymas)
// Handles cash, transfer, and MP payment methods
// ═══════════════════════════════════════════
async function processLocalOrder(paymentMethod) {
  clearCheckoutErrors();

  if (!validateCheckoutField('localName', 'Nombre requerido')) return;
  if (!validatePhone('localPhone')) return;
  // Email is optional in local flow EXCEPT when paying with MP (MP requires it)
  if (paymentMethod === 'mp') {
    if (!validateEmail('localEmail')) return;
  }
  if (!validateCheckoutField('localStreet', 'Calle requerida')) return;
  if (!validateCheckoutField('localNeighborhood', 'Colonia requerida')) return;

  const name = document.getElementById('localName').value.trim();
  const phone = document.getElementById('localPhone').value.trim();
  const email = document.getElementById('localEmail').value.trim();
  const street = document.getElementById('localStreet').value.trim();
  const neighborhood = document.getElementById('localNeighborhood').value.trim();
  const references = document.getElementById('localReferences').value.trim();
  const notes = document.getElementById('localNotes').value.trim();
  const fullAddress = `${street}, Col. ${neighborhood}, Guaymas, Sonora`;

  // For MP payment, branch into the MP flow with delivery_method='local'
  if (paymentMethod === 'mp') {
    return payWithMercadoPagoLocal({
      name, phone, email, street, neighborhood, references, notes,
    });
  }

  // For cash/transfer: create order directly
  const buttons = document.querySelectorAll('.checkout-payment-methods--local button');
  buttons.forEach(b => b.disabled = true);
  const targetBtn = document.querySelector(`.checkout-pay-btn--${paymentMethod === 'cash' ? 'cash' : 'transfer'}`);
  const originalText = targetBtn.innerHTML;
  targetBtn.innerHTML = '<span class="checkout-spinner"></span> Procesando...';

  try {
    const orderData = {
      customer_name: name,
      customer_phone: phone,
      customer_email: email || null,
      customer_address: fullAddress,
      customer_street: street,
      customer_neighborhood: neighborhood,
      customer_city: 'Guaymas',
      customer_state: 'Sonora',
      customer_references: references || null,
      delivery_method: 'local',
      payment_method: paymentMethod,
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
    showOrderSuccess('localForm', order, paymentMethod);

    cart = [];
    saveCart();
    updateCart();
    await fetchProducts();
    renderProducts();
  } catch (err) {
    buttons.forEach(b => b.disabled = false);
    targetBtn.innerHTML = originalText;
    showOrderError('localForm', err.message);
  }
}

async function payWithMercadoPagoLocal(data) {
  const btn = document.querySelector('#localForm .checkout-pay-btn--mp');
  btn.disabled = true;
  btn.innerHTML = '<span class="checkout-spinner"></span> Conectando con MP...';

  try {
    const items = cart.map(item => ({
      product_id: item.id,
      title: item.name,
      quantity: item.qty,
      unit_price: item.price,
    }));

    const res = await fetch(`${API_URL}/payments/create-preference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        customer_name: data.name,
        customer_phone: data.phone,
        customer_email: data.email,
        customer_address: `${data.street}, Col. ${data.neighborhood}, Guaymas, Sonora`,
        customer_street: data.street,
        customer_neighborhood: data.neighborhood,
        customer_city: 'Guaymas',
        customer_state: 'Sonora',
        customer_references: data.references || null,
        delivery_method: 'local',
        notes: data.notes || null,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error al crear preferencia de pago');
    }

    const preference = await res.json();
    window.location.href = preference.init_point;
  } catch (err) {
    showToast(err.message || 'Error al conectar con Mercado Pago');
    btn.disabled = false;
    btn.innerHTML = '\uD83D\uDCB3 Tarjeta (Mercado Pago)';
  }
}

function showOrderSuccess(containerId, order, paymentMethod) {
  const container = document.getElementById(containerId);
  let methodMsg = 'Te contactaremos por WhatsApp para coordinar la entrega y el pago.';
  if (paymentMethod === 'transfer') {
    methodMsg = 'Te enviaremos los datos bancarios por WhatsApp para que realices la transferencia.';
  } else if (paymentMethod === 'cash') {
    methodMsg = 'Te contactaremos por WhatsApp para coordinar la entrega. Pagas en efectivo al recibir.';
  }
  const waMsg = encodeURIComponent(`Hola, acabo de hacer el pedido #${order.id.slice(0, 8)}. ¿Me pueden confirmar?`);
  container.innerHTML = `
    <div class="checkout-success">
      <div class="checkout-success__icon">&#10004;</div>
      <h3 class="checkout-success__title">¡Pedido creado!</h3>
      <p class="checkout-success__id">Pedido #${escapeHtml(order.id.slice(0, 8))}</p>
      <p class="checkout-success__msg">${methodMsg}</p>
      <a href="https://wa.me/${APP_CONFIG.WHATSAPP_NUMBER}?text=${waMsg}" target="_blank" class="checkout-success__wa-btn">
        Confirmar por WhatsApp
      </a>
      <button class="checkout-success__close" onclick="location.reload()">Seguir comprando</button>
    </div>
  `;
}

function showOrderError(containerId, message) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="checkout-success">
      <div class="checkout-success__icon" style="background:#fef2f2;color:#b91c1c">&#10008;</div>
      <h3 class="checkout-success__title">Error al procesar</h3>
      <p class="checkout-success__msg">${escapeHtml(message || 'No se pudo crear el pedido. Intenta de nuevo.')}</p>
      <button class="checkout-success__close" onclick="location.reload()">Intentar de nuevo</button>
    </div>
  `;
}

async function payWithMercadoPago() {
  clearCheckoutErrors();

  if (!validateCheckoutField('checkoutName', 'Nombre requerido')) return;
  if (!validatePhone('checkoutPhone')) return;
  if (!validateEmail('checkoutEmail')) return;
  if (!validateCheckoutField('checkoutStreet', 'Calle requerida')) return;
  if (!validateCheckoutField('checkoutExtNum', 'No. exterior requerido')) return;
  if (!validateCheckoutField('checkoutNeighborhood', 'Colonia requerida')) return;
  if (!validateCheckoutField('checkoutCity', 'Ciudad requerida')) return;
  if (!validateCheckoutField('checkoutZip', 'C.P. requerido')) return;
  if (!validateCheckoutField('checkoutState', 'Estado requerido')) return;

  const btn = document.getElementById('payMpBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="checkout-spinner"></span> Conectando...';

  try {
    const items = cart.map(item => ({
      product_id: item.id,
      title: item.name,
      quantity: item.qty,
      unit_price: item.price,
    }));

    const res = await fetch(`${API_URL}/payments/create-preference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        customer_name: document.getElementById('checkoutName').value.trim(),
        customer_phone: document.getElementById('checkoutPhone').value.trim(),
        customer_email: document.getElementById('checkoutEmail').value.trim() || null,
        customer_address: `${document.getElementById('checkoutStreet').value.trim()}, Col. ${document.getElementById('checkoutNeighborhood').value.trim()}, ${document.getElementById('checkoutCity').value.trim()}, ${document.getElementById('checkoutState').value.trim()}, C.P. ${document.getElementById('checkoutZip').value.trim()}`,
        customer_street: document.getElementById('checkoutStreet').value.trim(),
        customer_ext_num: document.getElementById('checkoutExtNum').value.trim(),
        customer_int_num: document.getElementById('checkoutIntNum').value.trim() || null,
        customer_neighborhood: document.getElementById('checkoutNeighborhood').value.trim(),
        customer_city: document.getElementById('checkoutCity').value.trim(),
        customer_state: document.getElementById('checkoutState').value.trim(),
        customer_zip: document.getElementById('checkoutZip').value.trim(),
        customer_references: document.getElementById('checkoutReferences').value.trim() || null,
        delivery_method: 'national',
        notes: document.getElementById('checkoutNotes').value.trim() || null,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error al crear preferencia de pago');
    }

    const data = await res.json();

    // Save cart to localStorage before redirecting (to create order on return)
    localStorage.setItem('pending_mp_order', JSON.stringify({
      items: cart.map(item => ({ product_id: item.id, quantity: item.qty })),
      customer_name: document.getElementById('checkoutName').value.trim(),
      customer_phone: document.getElementById('checkoutPhone').value.trim(),
      customer_email: document.getElementById('checkoutEmail').value.trim() || null,
      customer_address: `${document.getElementById('checkoutStreet').value.trim()}, Col. ${document.getElementById('checkoutNeighborhood').value.trim()}, ${document.getElementById('checkoutCity').value.trim()}, ${document.getElementById('checkoutState').value.trim()}, C.P. ${document.getElementById('checkoutZip').value.trim()}`,
      customer_street: document.getElementById('checkoutStreet').value.trim(),
      customer_ext_num: document.getElementById('checkoutExtNum').value.trim(),
      customer_int_num: document.getElementById('checkoutIntNum').value.trim() || null,
      customer_neighborhood: document.getElementById('checkoutNeighborhood').value.trim(),
      customer_city: document.getElementById('checkoutCity').value.trim(),
      customer_state: document.getElementById('checkoutState').value.trim(),
      customer_zip: document.getElementById('checkoutZip').value.trim(),
      customer_references: document.getElementById('checkoutReferences').value.trim() || null,
      notes: document.getElementById('checkoutNotes').value.trim() || null,
    }));

    // Redirect to Mercado Pago
    window.location.href = data.init_point;

  } catch (err) {
    showToast(err.message || 'Error al conectar con Mercado Pago');
    btn.disabled = false;
    btn.textContent = 'Pagar con Mercado Pago';
  }
}

function closeAfterOrder() {
  toggleCart();
  location.reload();
}

// ═══════════════════════════════════════════
// PRODUCT DETAIL MODAL (PDP)
// ═══════════════════════════════════════════
let pdpProductId = null;
let pdpCurrentImage = 0;

function openPdp(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  pdpProductId = productId;
  pdpCurrentImage = 0;
  const cat = getCategoryByProduct(product);
  const images = product.images || [];

  // Category
  document.getElementById('pdpCategory').textContent = cat ? cat.name : '';

  // Name
  document.getElementById('pdpName').textContent = product.name;

  // Price
  const priceEl = document.getElementById('pdpPrice');
  priceEl.innerHTML = `<span class="pdp-info__current-price">$${product.price.toFixed(2)}</span>` +
    (product.old_price ? `<span class="pdp-info__old-price">$${product.old_price.toFixed(2)}</span>` : '');

  // Description
  document.getElementById('pdpDesc').textContent = product.description || '';

  // Stock
  const stockEl = document.getElementById('pdpStock');
  if (product.stock <= 0) {
    stockEl.innerHTML = '<span class="pdp-stock pdp-stock--out">Agotado</span>';
  } else if (product.stock <= 5) {
    stockEl.innerHTML = `<span class="pdp-stock pdp-stock--low">¡Solo quedan ${parseInt(product.stock)}!</span>`;
  } else {
    stockEl.innerHTML = '<span class="pdp-stock pdp-stock--ok">Disponible</span>';
  }

  // Add to cart button
  const addBtn = document.getElementById('pdpAddBtn');
  if (product.stock <= 0) {
    addBtn.disabled = true;
    addBtn.textContent = 'Agotado';
  } else {
    addBtn.disabled = false;
    addBtn.textContent = 'Agregar al carrito';
  }

  // WhatsApp link
  document.getElementById('pdpWaBtn').href =
    `https://wa.me/${APP_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hola, me interesa el producto: ${product.name}`)}`;

  // Gallery
  renderPdpGallery(product, images);

  // Show modal
  document.getElementById('pdpOverlay').classList.add('open');
  document.getElementById('pdpModal').classList.add('open');
  document.body.classList.add('no-scroll');
}

function renderPdpGallery(product, images) {
  const mainEl = document.getElementById('pdpMainImage');
  const thumbsEl = document.getElementById('pdpThumbs');

  if (images.length === 0) {
    const visuals = getProductVisuals(product);
    const isDark = visuals.bg.includes('#1a1a2e');
    mainEl.innerHTML = `<div class="pdp-gallery__placeholder" style="background:${visuals.bg}"><span style="font-size:5rem;${isDark ? 'filter:brightness(2);' : ''}">${visuals.emoji}</span></div>`;
    thumbsEl.innerHTML = '';
    return;
  }

  mainEl.innerHTML = `<img src="${images[pdpCurrentImage].image_url}" alt="" class="pdp-gallery__img">`;

  if (images.length > 1) {
    mainEl.innerHTML += `
      <button class="pdp-gallery__nav pdp-gallery__nav--prev" onclick="pdpNav(-1)">&#10094;</button>
      <button class="pdp-gallery__nav pdp-gallery__nav--next" onclick="pdpNav(1)">&#10095;</button>
    `;

    thumbsEl.innerHTML = images.map((img, i) =>
      `<button class="pdp-thumb ${i === pdpCurrentImage ? 'pdp-thumb--active' : ''}" onclick="pdpGoTo(${i})">
        <img src="${img.image_url}" alt="">
      </button>`
    ).join('');
  } else {
    thumbsEl.innerHTML = '';
  }
}

function pdpNav(direction) {
  const product = products.find(p => p.id === pdpProductId);
  if (!product) return;
  const images = product.images || [];
  if (images.length <= 1) return;

  pdpCurrentImage = (pdpCurrentImage + direction + images.length) % images.length;
  renderPdpGallery(product, images);
}

function pdpGoTo(index) {
  const product = products.find(p => p.id === pdpProductId);
  if (!product) return;
  pdpCurrentImage = index;
  renderPdpGallery(product, product.images || []);
}

function pdpAddToCart() {
  if (pdpProductId) {
    addToCart(pdpProductId);
  }
}

function closePdp() {
  document.getElementById('pdpOverlay').classList.remove('open');
  document.getElementById('pdpModal').classList.remove('open');
  document.body.classList.remove('no-scroll');
  pdpProductId = null;
}

// Close PDP with Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('pdpModal').classList.contains('open')) {
    closePdp();
  }
});

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
