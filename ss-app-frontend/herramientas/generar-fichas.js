/**
 * Genera una página real por producto en /producto/{slug}/ más el sitemap.
 *
 * Corre durante el despliegue, no en el navegador. GitHub Pages sólo sirve
 * archivos, así que las fichas tienen que existir como HTML de verdad: si se
 * armaran con JavaScript el enlace abriría bien, pero el rastreador de WhatsApp
 * —que no ejecuta JS— no podría generar la vista previa, que es justo para lo
 * que sirven estas páginas en una tienda que vende por WhatsApp.
 *
 * Uso: node herramientas/generar-fichas.js
 */

const fs = require('fs');
const path = require('path');

const API = process.env.API_URL || 'https://ss-app-backend-production.up.railway.app/api';
const SITIO = (process.env.SITE_URL || 'https://sexyshoptoys.com.mx').replace(/\/$/, '');
const WHATSAPP = '5216222279504';
const RAIZ = path.join(__dirname, '..');

// Los artículos de prueba de la tienda no se publican ni se indexan.
const PREFIJO_PRUEBA = 'prueba-';

const escapar = (t) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const dinero = (n) => Number(n || 0).toLocaleString('es-MX', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** Resumen corto y limpio para <meta description> y og:description. */
function resumen(producto, categoria) {
  const base = (producto.description || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (base) return base.length > 155 ? base.slice(0, 152).trimEnd() + '…' : base;
  return `${producto.name}${categoria ? ' · ' + categoria.name : ''}. Envío discreto a todo México desde Guaymas, Sonora.`;
}

/** Reintenta: durante un redespliegue del backend la API tarda en responder. */
async function pedir(ruta, intentos = 4) {
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(`${API}${ruta}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === intentos) throw new Error(`No se pudo leer ${ruta}: ${e.message}`);
      console.log(`  reintentando ${ruta} (${i}/${intentos}): ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
}

function paginaProducto(producto, imagenes, categoria) {
  const url = `${SITIO}/producto/${producto.slug}/`;
  const titulo = `${producto.name} — Sexy Shop`;
  const desc = resumen(producto, categoria);
  const foto = imagenes[0]?.image_url || `${SITIO}/img/logo.png`;
  const hayStock = (producto.stock ?? 0) > 0;

  const mensajeWa = encodeURIComponent(
    `Hola, me interesa este producto: ${producto.name} (${url})`
  );

  // Datos estructurados: permiten que Google muestre precio y disponibilidad
  // directamente en el resultado de búsqueda.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: producto.name,
    description: desc,
    image: imagenes.map((i) => i.image_url).slice(0, 5),
    sku: producto.id,
    ...(categoria ? { category: categoria.name } : {}),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'MXN',
      price: Number(producto.price).toFixed(2),
      availability: hayStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: 'Sexy Shop' },
    },
  };

  const galeria = imagenes.slice(0, 4).map((img, i) =>
    `<img src="${escapar(img.image_url)}" alt="${escapar(producto.name)} — imagen ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}">`
  ).join('\n      ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapar(titulo)}</title>
<meta name="description" content="${escapar(desc)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#E91E8C">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Sexy Shop">
<meta property="og:title" content="${escapar(producto.name)}">
<meta property="og:description" content="${escapar(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${escapar(foto)}">
<meta property="product:price:amount" content="${Number(producto.price).toFixed(2)}">
<meta property="product:price:currency" content="MXN">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="/img/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Great+Vibes&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Outfit',system-ui,sans-serif;background:#fff;color:#1a1a2e;line-height:1.6}
  a{color:#E91E8C;text-decoration:none}
  .topbar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid #f3e1ea;padding:14px 20px;display:flex;align-items:center;justify-content:space-between}
  /* Mismo logotipo que la tienda: script rosa + sans cian */
  .brand{font-family:'Great Vibes',cursive;font-size:2.5rem;line-height:1;color:#E91E8C}
  .brand span{font-family:'Outfit',sans-serif;font-size:1.55rem;font-weight:600;color:#29ABD4;letter-spacing:-.02em;margin-left:-3px}
  .topbar a.volver{font-size:.85rem;font-weight:500;color:#6b7280}
  .wrap{max-width:1000px;margin:0 auto;padding:28px 20px 70px;display:grid;gap:34px}
  @media(min-width:840px){.wrap{grid-template-columns:1fr 1fr;align-items:start;padding-top:44px}}
  .fotos{display:grid;gap:12px}
  .fotos img{width:100%;border-radius:16px;background:#f9fafb;object-fit:cover}
  .fotos img:not(:first-child){display:none}
  @media(min-width:840px){.fotos img:not(:first-child){display:block;height:130px}
    .fotos{grid-template-columns:repeat(3,1fr)}
    .fotos img:first-child{grid-column:1/-1}}
  .eyebrow{font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:#E91E8C;font-weight:600}
  h1{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:600;margin:6px 0 12px;line-height:1.2}
  .precio{display:flex;align-items:baseline;gap:10px;margin-bottom:6px}
  .precio strong{font-size:1.7rem;font-weight:600}
  .precio s{color:#9ca3af;font-size:1rem}
  .stock{font-size:.82rem;font-weight:600;margin-bottom:18px}
  .stock--si{color:#047857}
  .stock--no{color:#b91c1c}
  .desc{color:#4b4b60;font-size:.95rem;white-space:pre-line;margin-bottom:26px}
  .cta{display:block;text-align:center;padding:15px 28px;border-radius:50px;font-weight:600;font-size:.95rem;margin-bottom:12px}
  .cta--main{background:#E91E8C;color:#fff}
  .cta--wa{border:1.5px solid #e5e7eb;color:#6b7280}
  .nota{font-size:.8rem;color:#9ca3af;text-align:center;margin-top:16px}
  footer{border-top:1px solid #f3e1ea;padding:22px 20px;text-align:center;font-size:.78rem;color:#9ca3af}
  footer a{margin:0 8px;color:#6b7280}
  .edad{position:fixed;inset:0;z-index:50;background:rgba(26,26,46,.97);display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
  .edad__caja{background:#fff;border-radius:20px;padding:36px 28px;max-width:380px}
  .edad h2{font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:600;margin-bottom:10px}
  .edad p{font-size:.9rem;color:#6b7280;margin-bottom:22px}
  .edad button{font-family:'Outfit',sans-serif;font-size:.9rem;font-weight:500;padding:13px 26px;border-radius:50px;border:none;cursor:pointer;margin:0 5px}
  .edad .si{background:#E91E8C;color:#fff}
  .edad .no{background:#f3f4f6;color:#6b7280}
</style>
</head>
<body>

<div class="edad" id="edad">
  <div class="edad__caja">
    <div class="brand">Sexy<span>Shop</span></div>
    <h2>Verificación de edad</h2>
    <p>Este sitio contiene productos para adultos. Para continuar, confirma que eres mayor de 18 años.</p>
    <button class="si" onclick="confirmarEdad(true)">Sí, soy mayor de 18</button>
    <button class="no" onclick="confirmarEdad(false)">Salir</button>
  </div>
</div>

<nav class="topbar">
  <a href="/" class="brand">Sexy<span>Shop</span></a>
  <a href="/#tienda" class="volver">Ver todo el catálogo</a>
</nav>

<div class="wrap">
  <div class="fotos">
      ${galeria || `<img src="/img/logo.png" alt="${escapar(producto.name)}">`}
  </div>
  <div>
    ${categoria ? `<div class="eyebrow">${escapar(categoria.name)}</div>` : ''}
    <h1>${escapar(producto.name)}</h1>
    <div class="precio">
      <strong>$${dinero(producto.price)}</strong>
      ${producto.old_price ? `<s>$${dinero(producto.old_price)}</s>` : ''}
      <span style="font-size:.85rem;color:#9ca3af">MXN</span>
    </div>
    <div class="stock ${hayStock ? 'stock--si' : 'stock--no'}">
      ${hayStock ? '● Disponible' : '● Agotado por ahora'}
    </div>
    ${producto.description ? `<div class="desc">${escapar(producto.description)}</div>` : ''}
    <a class="cta cta--main" href="/?producto=${encodeURIComponent(producto.slug)}">
      ${hayStock ? 'Agregar al carrito' : 'Ver en la tienda'}
    </a>
    <a class="cta cta--wa" href="https://wa.me/${WHATSAPP}?text=${mensajeWa}" target="_blank" rel="noopener">
      Preguntar por WhatsApp
    </a>
    <p class="nota">Envío discreto · Entrega el mismo día en Guaymas · Envíos a todo México</p>
  </div>
</div>

<footer>
  &copy; 2026 Sexy Shop
  <div style="margin-top:6px">
    <a href="/">Tienda</a>
    <a href="/privacidad.html">Aviso de privacidad</a>
    <a href="/terminos.html">Términos y condiciones</a>
  </div>
</footer>

<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<script>
  // Mismo criterio que la tienda: la verificación dura la sesión del navegador.
  function confirmarEdad(esAdulto) {
    if (!esAdulto) { location.href = 'https://www.google.com'; return; }
    sessionStorage.setItem('ageVerified', 'true');
    document.getElementById('edad').style.display = 'none';
  }
  if (sessionStorage.getItem('ageVerified') === 'true') {
    document.getElementById('edad').style.display = 'none';
  }
</script>
</body>
</html>
`;
}

function sitemap(productos) {
  const hoy = new Date().toISOString().slice(0, 10);
  const entrada = (loc, prio, freq) =>
    `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${hoy}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${prio}</priority>\n  </url>`;

  const urls = [
    entrada(`${SITIO}/`, '1.0', 'daily'),
    entrada(`${SITIO}/terminos.html`, '0.3', 'yearly'),
    entrada(`${SITIO}/privacidad.html`, '0.3', 'yearly'),
    ...productos.map((p) => entrada(`${SITIO}/producto/${p.slug}/`, '0.8', 'weekly')),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

async function main() {
  console.log(`Generando fichas desde ${API}`);

  const [conImagenes, categorias] = await Promise.all([
    pedir('/products?images=true'),
    pedir('/categories'),
  ]);

  const porCategoria = new Map(categorias.map((c) => [c.id, c]));

  const publicables = conImagenes.filter(({ product }) =>
    product && product.slug && !product.slug.startsWith(PREFIJO_PRUEBA)
  );

  // Se limpia primero para que un producto borrado no deje su página huérfana.
  const destino = path.join(RAIZ, 'producto');
  fs.rmSync(destino, { recursive: true, force: true });

  for (const { product, images } of publicables) {
    const carpeta = path.join(destino, product.slug);
    fs.mkdirSync(carpeta, { recursive: true });
    fs.writeFileSync(
      path.join(carpeta, 'index.html'),
      paginaProducto(product, images || [], porCategoria.get(product.category_id)),
      'utf8'
    );
  }

  fs.writeFileSync(
    path.join(RAIZ, 'sitemap.xml'),
    sitemap(publicables.map((x) => x.product)),
    'utf8'
  );

  const omitidos = conImagenes.length - publicables.length;
  console.log(`Listo: ${publicables.length} fichas + sitemap${omitidos ? ` (${omitidos} omitidos por ser de prueba)` : ''}`);
}

main().catch((e) => {
  console.error(`\nFalló la generación de fichas: ${e.message}`);
  process.exit(1);
});
