// ═══════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════
const CATEGORIES = [
  { id: 'todos', name: 'Todos', icon: '&#9733;', count: 24 },
  { id: 'lenceria', name: 'Lencería', icon: '&#128131;', count: 8 },
  { id: 'lubricantes', name: 'Lubricantes', icon: '&#128167;', count: 5 },
  { id: 'vibradores', name: 'Vibradores', icon: '&#10024;', count: 6 },
  { id: 'juguetes', name: 'Juguetes', icon: '&#127895;', count: 4 },
  { id: 'multiorgasmicos', name: 'Multiorgásmicos', icon: '&#128293;', count: 3 },
  { id: 'accesorios', name: 'Accesorios', icon: '&#127873;', count: 5 }
];

const PRODUCTS = [
  {
    id: 1, name: 'Baby Doll Encaje Negro', category: 'lenceria',
    desc: 'Lencería de encaje fino con tirantes ajustables. Disponible en varias tallas.',
    price: 350, badge: 'new',
    bg: 'linear-gradient(135deg, #1a1a2e 0%, #2d2d44 100%)', emoji: '&#128131;'
  },
  {
    id: 2, name: 'Vibrador Punto G Recargable', category: 'vibradores',
    desc: '10 modos de vibración, silicona médica, resistente al agua. Carga USB.',
    price: 680, oldPrice: 850, badge: 'hot',
    bg: 'linear-gradient(135deg, var(--pink-soft) 0%, #fce7f3 100%)', emoji: '&#10024;'
  },
  {
    id: 3, name: 'Lubricante Base Agua 120ml', category: 'lubricantes',
    desc: 'Fórmula premium hipoalergénica. Compatible con preservativos y juguetes.',
    price: 180,
    bg: 'linear-gradient(135deg, var(--blue-soft) 0%, #dbeafe 100%)', emoji: '&#128167;'
  },
  {
    id: 4, name: 'Conjunto Lencería Roja', category: 'lenceria',
    desc: 'Brasier push-up y tanga a juego. Encaje floral con detalles satinados.',
    price: 450, badge: 'new',
    bg: 'linear-gradient(135deg, #FEF2F2 0%, #FECACA 100%)', emoji: '&#10084;'
  },
  {
    id: 5, name: 'Aceite para Masaje Sensual', category: 'lubricantes',
    desc: 'Aceite con aroma a rosas, efecto calor. Perfecto para masajes en pareja.',
    price: 220,
    bg: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)', emoji: '&#127801;'
  },
  {
    id: 6, name: 'Bala Vibradora Inalámbrica', category: 'vibradores',
    desc: 'Control remoto inalámbrico, 12 velocidades. Ideal para uso en pareja.',
    price: 490, badge: 'hot',
    bg: 'linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%)', emoji: '&#128171;'
  },
  {
    id: 7, name: 'Kit Esposas y Antifaz', category: 'juguetes',
    desc: 'Set de esposas acolchadas con antifaz de satín. Para noches especiales.',
    price: 280,
    bg: 'linear-gradient(135deg, #1a1a2e 0%, #374151 100%)', emoji: '&#128156;'
  },
  {
    id: 8, name: 'Multiorgásmico Femenino', category: 'multiorgasmicos',
    desc: 'Gel estimulante de efecto calor y frío. Potencia el placer femenino.',
    price: 320, badge: 'sale',
    bg: 'linear-gradient(135deg, var(--pink-soft) 0%, #FCE7F3 100%)', emoji: '&#128293;'
  },
  {
    id: 9, name: 'Corsé Satinado con Liguero', category: 'lenceria',
    desc: 'Corsé de satín con ballenas flexibles y liguero desmontable.',
    price: 590,
    bg: 'linear-gradient(135deg, #F9FAFB 0%, #E5E7EB 100%)', emoji: '&#127904;'
  },
  {
    id: 10, name: 'Anillo Vibrador para Parejas', category: 'vibradores',
    desc: 'Anillo de silicona con vibración. Estimulación mutua garantizada.',
    price: 350,
    bg: 'linear-gradient(135deg, var(--blue-soft) 0%, #BFDBFE 100%)', emoji: '&#128141;'
  },
  {
    id: 11, name: 'Retardante Masculino Spray', category: 'multiorgasmicos',
    desc: 'Spray retardante con efecto desensibilizante suave. Prolonga el momento.',
    price: 250,
    bg: 'linear-gradient(135deg, #ECFDF5 0%, #A7F3D0 100%)', emoji: '&#9200;'
  },
  {
    id: 12, name: 'Set de Dados Eróticos', category: 'juguetes',
    desc: 'Par de dados con posiciones y acciones. Diversión asegurada en pareja.',
    price: 120,
    bg: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)', emoji: '&#127922;'
  }
];

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let cart = [];
let activeCategory = 'todos';

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

// Check if already verified
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

// Close mobile menu on link click
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.getElementById('navLinks').classList.remove('mobile-open');
  });
});

// ═══════════════════════════════════════════
// RENDER CATEGORIES
// ═══════════════════════════════════════════
function renderCategories() {
  const grid = document.getElementById('categoriesGrid');
  grid.innerHTML = CATEGORIES.map(cat => `
    <div class="category-card ${cat.id === activeCategory ? 'active' : ''}"
         onclick="filterCategory('${cat.id}')">
      <div class="category-icon">${cat.icon}</div>
      <div class="category-name">${cat.name}</div>
      <div class="category-count">${cat.count} productos</div>
    </div>
  `).join('');
}

function filterCategory(catId) {
  activeCategory = catId;
  renderCategories();
  renderProducts();
  document.getElementById('productos').scrollIntoView({ behavior: 'smooth' });
}

// ═══════════════════════════════════════════
// RENDER PRODUCTS
// ═══════════════════════════════════════════
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  const filtered = activeCategory === 'todos'
    ? PRODUCTS
    : PRODUCTS.filter(p => p.category === activeCategory);

  grid.innerHTML = filtered.map(product => `
    <div class="product-card" data-id="${product.id}">
      <div class="product-image">
        <div class="product-image-bg" style="background:${product.bg}">
          <span style="font-size:3.5rem;${product.bg.includes('#1a1a2e') ? 'filter:brightness(2);' : ''}">${product.emoji}</span>
        </div>
        ${product.badge ? `<span class="product-badge badge-${product.badge}">${product.badge === 'new' ? 'Nuevo' : product.badge === 'hot' ? 'Popular' : 'Oferta'}</span>` : ''}
        <div class="product-quick-add" onclick="addToCart(${product.id})">Agregar al carrito</div>
      </div>
      <div class="product-info">
        <div class="product-category">${CATEGORIES.find(c => c.id === product.category)?.name || ''}</div>
        <h3 class="product-name">${product.name}</h3>
        <p class="product-desc">${product.desc}</p>
        <div class="product-footer">
          <div>
            <span class="product-price">$${product.price.toFixed(2)}</span>
            ${product.oldPrice ? `<span class="product-price-old">$${product.oldPrice.toFixed(2)}</span>` : ''}
          </div>
          <button class="product-add-btn" onclick="addToCart(${product.id})" title="Agregar al carrito">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════
// CART
// ═══════════════════════════════════════════
function addToCart(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return;

  const existing = cart.find(item => item.id === productId);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ ...product, qty: 1 });
  }

  updateCart();
  showToast(`${product.name} agregado al carrito`);
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
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
  updateCart();
}

function updateCart() {
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  // Update count badge
  const countEl = document.getElementById('cartCount');
  countEl.textContent = totalItems;
  countEl.classList.toggle('show', totalItems > 0);

  // Render cart items
  const itemsEl = document.getElementById('cartItems');
  const emptyEl = document.getElementById('cartEmpty');
  const footerEl = document.getElementById('cartFooter');

  if (cart.length === 0) {
    emptyEl.style.display = 'flex';
    footerEl.style.display = 'none';
    itemsEl.innerHTML = '';
    itemsEl.appendChild(emptyEl);
  } else {
    emptyEl.style.display = 'none';
    footerEl.style.display = 'block';
    document.getElementById('cartTotal').textContent = `$${totalPrice.toFixed(2)} MXN`;

    itemsEl.innerHTML = cart.map(item => `
      <div class="cart-item">
        <div class="cart-item-img" style="background:${item.bg}">
          <span>${item.emoji}</span>
        </div>
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</div>
        </div>
        <div class="cart-item-qty">
          <button onclick="updateQty(${item.id}, -1)">&minus;</button>
          <span>${item.qty}</span>
          <button onclick="updateQty(${item.id}, 1)">+</button>
        </div>
      </div>
    `).join('');
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

function checkout() {
  if (cart.length === 0) return;

  let message = 'Hola, me gustaría hacer el siguiente pedido:\n\n';
  let total = 0;

  cart.forEach(item => {
    const subtotal = item.price * item.qty;
    total += subtotal;
    message += `• ${item.name} x${item.qty} — $${subtotal.toFixed(2)}\n`;
  });

  message += `\n*Total: $${total.toFixed(2)} MXN*\n\n¿Me pueden confirmar disponibilidad y forma de entrega? Gracias.`;

  const encoded = encodeURIComponent(message);
  window.open(`https://wa.me/526222279504?text=${encoded}`, '_blank');
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
renderCategories();
renderProducts();
updateCart();
