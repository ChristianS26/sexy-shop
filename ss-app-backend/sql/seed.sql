-- ═══════════════════════════════════════════
-- SS App - Seed Data
-- Migrated from hardcoded JS arrays in index.html
-- ═══════════════════════════════════════════

-- Categories (excluding "Todos" which is a frontend filter, not a real category)
INSERT INTO categories (name, slug, icon, display_order) VALUES
    ('Lencería',        'lenceria',        '💃', 1),
    ('Lubricantes',     'lubricantes',     '💧', 2),
    ('Vibradores',      'vibradores',      '✨', 3),
    ('Juguetes',        'juguetes',        '🎗', 4),
    ('Multiorgásmicos', 'multiorgasmicos', '🔥', 5),
    ('Accesorios',      'accesorios',      '🎁', 6);

-- Products
-- Using subqueries to reference category IDs by slug
INSERT INTO products (name, slug, description, price, old_price, category_id, stock, badge) VALUES
    (
        'Baby Doll Encaje Negro',
        'baby-doll-encaje-negro',
        'Lencería de encaje fino con tirantes ajustables. Disponible en varias tallas.',
        350.00, NULL,
        (SELECT id FROM categories WHERE slug = 'lenceria'),
        10, 'new'
    ),
    (
        'Vibrador Punto G Recargable',
        'vibrador-punto-g-recargable',
        '10 modos de vibración, silicona médica, resistente al agua. Carga USB.',
        680.00, 850.00,
        (SELECT id FROM categories WHERE slug = 'vibradores'),
        5, 'hot'
    ),
    (
        'Lubricante Base Agua 120ml',
        'lubricante-base-agua-120ml',
        'Fórmula premium hipoalergénica. Compatible con preservativos y juguetes.',
        180.00, NULL,
        (SELECT id FROM categories WHERE slug = 'lubricantes'),
        20, NULL
    ),
    (
        'Conjunto Lencería Roja',
        'conjunto-lenceria-roja',
        'Brasier push-up y tanga a juego. Encaje floral con detalles satinados.',
        450.00, NULL,
        (SELECT id FROM categories WHERE slug = 'lenceria'),
        8, 'new'
    ),
    (
        'Aceite para Masaje Sensual',
        'aceite-masaje-sensual',
        'Aceite con aroma a rosas, efecto calor. Perfecto para masajes en pareja.',
        220.00, NULL,
        (SELECT id FROM categories WHERE slug = 'lubricantes'),
        15, NULL
    ),
    (
        'Bala Vibradora Inalámbrica',
        'bala-vibradora-inalambrica',
        'Control remoto inalámbrico, 12 velocidades. Ideal para uso en pareja.',
        490.00, NULL,
        (SELECT id FROM categories WHERE slug = 'vibradores'),
        7, 'hot'
    ),
    (
        'Kit Esposas y Antifaz',
        'kit-esposas-antifaz',
        'Set de esposas acolchadas con antifaz de satín. Para noches especiales.',
        280.00, NULL,
        (SELECT id FROM categories WHERE slug = 'juguetes'),
        12, NULL
    ),
    (
        'Multiorgásmico Femenino',
        'multiorgasmico-femenino',
        'Gel estimulante de efecto calor y frío. Potencia el placer femenino.',
        320.00, NULL,
        (SELECT id FROM categories WHERE slug = 'multiorgasmicos'),
        10, 'sale'
    ),
    (
        'Corsé Satinado con Liguero',
        'corse-satinado-liguero',
        'Corsé de satín con ballenas flexibles y liguero desmontable.',
        590.00, NULL,
        (SELECT id FROM categories WHERE slug = 'lenceria'),
        4, NULL
    ),
    (
        'Anillo Vibrador para Parejas',
        'anillo-vibrador-parejas',
        'Anillo de silicona con vibración. Estimulación mutua garantizada.',
        350.00, NULL,
        (SELECT id FROM categories WHERE slug = 'vibradores'),
        9, NULL
    ),
    (
        'Retardante Masculino Spray',
        'retardante-masculino-spray',
        'Spray retardante con efecto desensibilizante suave. Prolonga el momento.',
        250.00, NULL,
        (SELECT id FROM categories WHERE slug = 'multiorgasmicos'),
        18, NULL
    ),
    (
        'Set de Dados Eróticos',
        'set-dados-eroticos',
        'Par de dados con posiciones y acciones. Diversión asegurada en pareja.',
        120.00, NULL,
        (SELECT id FROM categories WHERE slug = 'juguetes'),
        25, NULL
    );
