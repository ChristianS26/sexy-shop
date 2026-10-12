# API del ERP

Base: `https://ss-app-backend-production.up.railway.app/api/erp` (local: `http://localhost:8080/api/erp`).

- **Auth**: `Authorization: Bearer <access_token de Supabase Auth>`. El backend verifica el token contra GoTrue (`/auth/v1/user`) y construye el contexto (usuario, organización, roles, permisos, sucursales) con `auth_context()`. Cache de 60 s.
- **Errores**: siempre `{ "error": "mensaje legible", "code": "CODIGO", "details": {...}? }`. 401 sesión inválida · 403 sin permiso · 404 no encontrado · 409 conflicto de negocio (stock, estado, turno) · 422 validación (`details` = campo → mensaje) · 429 rate limit (600 req/min por token) · 500 genérico (el detalle técnico queda en logs).
- **Paginación** (listas): `?page=1&size=25&sort=-sold_at&q=texto` → `{ data, page, size, total, pages }`. Orden server-side; tamaño máximo 200.
- **Filtros de fecha** en analytics/reportes: `?range=today|yesterday|last7|last30|last90|this_week|last_week|this_month|last_month|this_year|last_year|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&branch=<id>`.
- **Costo/margen**: los campos de costo se omiten de las respuestas si el usuario no tiene `products.cost.read`.

## Sesión
| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/auth/me?login=true` | — | Contexto completo (usuario, permisos, sucursales, almacenes, cajas, métodos de pago, settings, alertas no leídas). `login=true` registra el acceso. |
| POST | `/auth/logout` | — | Audita el cierre e invalida cache. |

## Organización y estructura
| Método | Ruta | Permiso |
|---|---|---|
| GET / PATCH | `/org` | — / `settings.manage` |
| GET | `/settings` · PUT `/settings/{key}` | — / `settings.manage` (`security` requiere `settings.system`) |
| GET / POST / PATCH | `/branches`, `/warehouses`, `/cash-registers` (`?all=true` incluye inactivos) | `branches.manage` para escribir |
| GET / POST / PATCH | `/payment-methods`, `/tax-rates` | `settings.manage` para escribir |
| GET | `/permissions`, `/roles` | — |
| POST / PATCH / DELETE | `/roles`, `/roles/{id}` | `roles.manage` (roles de sistema: solo `settings.system`) |

## Usuarios
`GET /users` (paginado, `status`), `GET /users/{id}`, `POST /users` (crea cuenta en Supabase Auth + usuario ERP; `role_ids`, `branch_ids`, `password`), `PATCH /users/{id}`, `POST /users/{id}/status` (`ACTIVE|INACTIVE|SUSPENDED`; baneo en Auth), `DELETE /users/{id}` (soft), `POST /users/{id}/password`, `POST /users/{id}/recover` (correo de recuperación). Permisos `users.*`.

## Catálogo
- `GET /products` (filtros `category, brand, supplier, status, stock_status, active, q`), `GET /products/lookup?code=` (barcode/SKU exacto para POS), `GET /products/{id}`, `GET /products/{id}/quick` (ficha + historial 12 semanas), `POST /products`, `PATCH /products/{id}`, `DELETE /products/{id}` (soft si tiene ventas o stock).
- Variantes: `POST /products/{id}/variants`, `PATCH /variants/{id}`, `DELETE /variants/{id}`.
- Imágenes: se usa el API legado `POST /api/images/upload` (form `productId`, `isPrimary`, `file`), `PUT /api/images/reorder`, `DELETE /api/images/{id}`, `GET /api/products/{id}/images` (acepta usuarios ERP con `products.update`).
- `GET /categories` (árbol + plano con conteos), `POST/PATCH/DELETE /categories[/{id}]` (`categories.manage`).
- `GET /brands`, `POST/PATCH/DELETE /brands[/{id}]` (`brands.manage`).
- `GET /suppliers` (paginado), `GET /suppliers/{id}` (productos y órdenes), `POST/PATCH/DELETE` (`suppliers.manage`).

## Inventario
| Método | Ruta | Permiso |
|---|---|---|
| GET | `/inventory/stock` (vista `v_stock`; `warehouse, category, status, brand, q`) · `/inventory/summary` | `inventory.read` o `products.read` |
| GET | `/inventory/movements` (`product, warehouse, type, reference_type, user, from, to, q`) | `inventory.read` |
| GET | `/inventory/alerts` (bajo mínimo, sin movimiento, sugerido de reorden) | `inventory.read` |
| GET / POST | `/inventory/adjustments` `{warehouse_id, type, reason, notes, items:[{product_id, variant_id, quantity, unit_cost}]}` | `inventory.adjust` |
| GET / POST / PATCH | `/inventory/transfers[/{id}]` · POST `/{id}/send`, `/{id}/receive` `{items:[{item_id, received_quantity}]}`, `/{id}/cancel` | `inventory.transfer` |
| GET / POST | `/inventory/counts[/{id}]` · PATCH `/{id}/items` `{items:[{id, counted_qty}]}` · POST `/{id}/finalize`, `/{id}/cancel` | `inventory.count` |

## Compras
`GET /purchases`, `GET /purchases/{id}`, `POST /purchases` `{supplier_id, warehouse_id, expected_date, notes, items:[{product_id, variant_id, quantity, unit_cost}], send}`, `PATCH /purchases/{id}`, `POST /purchases/{id}/status` `{status: SENT|COMPLETED|CANCELLED, reason}`, `POST /purchases/{id}/receive` `{items:[{po_item_id, quantity, unit_cost}], invoice_number, notes}` (sin `items` recibe todo), `GET /purchases/receipts`, `GET /purchases/suggestions`.

## Ventas / POS
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/pos/quote` | `{items:[{product_id, variant_id, quantity}], discount_pct}` → líneas con promociones aplicadas, totales, sugerencias y `max_discount_pct` del rol. |
| POST | `/sales` | `{branch_id, warehouse_id?, customer_id?, cash_shift_id?, seller_id?, client_ref?, notes?, discount_pct?|discount_amount?, discount_reason, items:[…], payments:[{method_code, amount, reference?}]}`. Transacción completa (`create_sale`). `client_ref` hace idempotente el POST. |
| GET | `/sales` | Filtros `status, channel, branch, customer, seller, shift, product, category, payment_method, from, to, q(folio)`. Con `sales.read.own` solo ventas propias. |
| GET | `/sales/{id}` | Venta completa + movimientos de inventario + auditoría. |
| GET | `/sales/{id}/ticket` | Datos para ticket (settings, sucursal) · audita la impresión. |
| PATCH | `/sales/{id}` | Notas / cliente (`sales.update`). |
| POST | `/sales/{id}/cancel` | `{reason, cash_shift_id?}` (`sales.cancel`). Regresa inventario; respeta `allow_cancel_days`. |
| POST | `/sales/{id}/returns` | `{reason, refund_method_code, cash_shift_id?, notes, items:[{sale_item_id, quantity, restock, condition}]}` (`sales.refund`). |
| GET | `/returns` | Historial de devoluciones. |
| GET/POST/PATCH/DELETE | `/promotions[/{id}]` | `promotions.manage`; `product_ids`, `category_ids`. |

## Clientes
`GET /customers` (`neighborhood, source, status, with_purchases, q`), `GET /customers/{id}` (Customer 360, audita el acceso), `POST /customers` (acepta `address`), `PATCH`, `DELETE` (anonimiza), `POST /customers/{id}/addresses`, `PATCH/DELETE /customers/addresses/{id}`, `GET /neighborhoods`, `POST /neighborhoods`, `PATCH /neighborhoods/{id}`, `POST /neighborhoods/{id}/merge` `{target_id}`.

## Caja y gastos
`GET /cash/shifts`, `GET /cash/shifts/current?register=&branch=`, `GET /cash/shifts/{id}` (movimientos, esperado en vivo, totales por método, ventas), `POST /cash/shifts/open` `{cash_register_id, opening_amount, notes}`, `POST /cash/shifts/{id}/close` `{counted_cash, notes}`, `POST /cash/shifts/{id}/movements` `{type: DEPOSIT|WITHDRAWAL|ADJUSTMENT, amount, description}`. `GET/POST/PATCH/DELETE /expenses`, `GET/POST/PATCH /expense-categories`.

## Analytics (permiso `analytics.read`; finanzas `analytics.financial`)
`/analytics/overview`, `/analytics/sales`, `/analytics/products?metric=revenue|units|margin|growth|decline|rotation&limit=&category=`, `/analytics/products/{id}/history`, `/analytics/categories`, `/analytics/customers?segment=&months=`, `/analytics/geography?neighborhood=`, `/analytics/time`, `/analytics/inventory?days=`, `/analytics/trends?weeks=`, `/analytics/basket?min=`, `/analytics/financial`, `/analytics/insights`, `/analytics/executive`. Todos aceptan `range/from/to/branch`.

## Reportes, alertas, auditoría, búsqueda, archivos, importación
- `GET /reports` (catálogo) · `GET /reports/{key}?format=json|csv|xlsx&range=…` (`reports.read`; exportar requiere `reports.export`).
- `GET /alerts?status=open|all|UNREAD|READ|RESOLVED&severity=&type=`, `GET /alerts/summary`, `POST /alerts/{id}/read`, `POST /alerts/read-all`, `POST /alerts/{id}/resolve`, `POST /alerts/run-checks`.
- `GET /audit` (`user, action, entity_type, entity_id, from, to, q`), `GET /audit/actions`.
- `GET /search?q=` (productos, clientes, ventas, proveedores, órdenes; filtrado por permisos).
- `POST /files` (multipart `file`, `entity_type`, `entity_id`; imágenes/PDF ≤ 8 MB) → URL pública en Storage.
- `POST /import/{products|customers|suppliers|inventory}/preview` (multipart CSV/XLSX o JSON `{csv}`/`{rows}`) → filas válidas/errores · `POST /import/{entity}/commit` `{rows, warehouse_id?}`.
