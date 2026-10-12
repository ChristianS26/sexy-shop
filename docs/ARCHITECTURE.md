# SONROJA ERP — Arquitectura

> Documento de decisiones. Si algo aquí contradice al código, gana el código y hay que corregir este documento.

## 1. Punto de partida (lo que ya existía)

| Capa | Tecnología | Estado al 2026-10-11 |
|---|---|---|
| Backend | Kotlin 2.1 · Ktor 3.1 · supabase-kt 3.1 (PostgREST + Storage) · Koin 4 | Desplegado en Railway (Docker, 512 MB). API `/api/*` para la tienda en línea y un admin básico |
| Base de datos | Supabase Postgres 17 (proyecto `litzzmjoiujifddkrryp`) | 11 tablas: categorías, productos, imágenes, pedidos, items, perfiles, eventos de pedido, gastos, retiros, settings, envíos |
| Auth | Supabase Auth (GoTrue) + tabla `profiles.role` (`admin`/`customer`) | Un solo admin. El backend **no verificaba la firma del JWT** (solo decodificaba el payload) |
| Frontend | HTML/CSS/JS sin build, GitHub Pages (`sexyshoptoys.com.mx`) | Storefront + checkout Mercado Pago + admin de 2 400 líneas |
| Pagos | Mercado Pago (webhook HMAC) | Pedidos web entran `pending` y la tienda los confirma |

**Decisión central: no se reemplaza nada.** El ERP se construye encima: mismas tecnologías, mismo repositorio, misma base de datos. El storefront y el checkout siguen funcionando sin tocarse.

## 2. Principio del producto

```
OPERACIÓN    →  ¿Qué está pasando?   (POS, ventas, inventario, caja, compras)
INTELIGENCIA →  ¿Qué significa?      (analytics, tendencias, RFM, ABC, rotación)
ACCIÓN       →  ¿Qué debería hacer?  (alertas, insights, modo ejecutivo)
```

Cada módulo del frontend vive en una de esas tres zonas y la navegación lo refleja.

## 3. Arquitectura técnica

```
+------------------------- GitHub Pages ---------------------------+
|  /            storefront (sin cambios)                           |
|  /admin.html  admin legado (se mantiene hasta migrar todo)       |
|  /erp/        SONROJA ERP - SPA en ES modules, sin build         |
+--------------+---------------------------------------------------+
               | HTTPS - Bearer JWT (Supabase Auth)
+--------------v---------- Railway --------------------------------+
|  Ktor                                                            |
|   plugins/   Auth (verifica token contra GoTrue), CORS, errores  |
|   erp/       modulos: route -> service -> repository (PostgREST) |
|   erp/core   AuthContext, Permissions, Audit, Pagination, Export |
|   erp/bi     InsightEngine (texto a partir de agregados)         |
+--------------+---------------------------------------------------+
               | PostgREST (service_role) - RPC a funciones SQL
+--------------v---------- Supabase -------------------------------+
|  Postgres 17                                                     |
|   tablas transaccionales (3FN) + columnas desnormalizadas en     |
|   sale_items para analitica                                      |
|   funciones plpgsql = TRANSACCIONES (venta, devolucion,          |
|   recepcion, transferencia, ajuste, conteo, cierre de caja)      |
|   funciones bi_* = agregados server-side                         |
|   triggers: stock derivado, folios, alertas, auditoria inmutable |
|  Auth (GoTrue): contrasenas bcrypt, sesiones, recuperacion, MFA  |
|  Storage: imagenes de producto, comprobantes                     |
+------------------------------------------------------------------+
```

### 3.1 Dónde vive cada responsabilidad

| Responsabilidad | Dónde | Por qué |
|---|---|---|
| Credenciales, hash, sesiones, reset de password, 2FA | Supabase Auth | Ya está en uso; bcrypt + TOTP listos sin código propio |
| Verificación del token | Ktor → `GET /auth/v1/user` (cache 60 s) | El backend antes confiaba en el payload sin firma. Ahora GoTrue valida la firma |
| Autorización (RBAC) | Ktor (`requirePermission`) + DB (`users`, `roles`, `permissions`) | Nunca solo frontend. El frontend solo oculta lo que no puede usar |
| Validación de entrada / DTOs | Ktor | Mensajes legibles, sin exponer errores técnicos |
| Invariantes transaccionales | Funciones plpgsql `SECURITY DEFINER` | PostgREST no ofrece transacciones multi-sentencia. Una función = una transacción atómica con `FOR UPDATE` |
| Stock | `inventory_levels` + `inventory_movements`; `products.stock` es **derivado por trigger** | Nunca se edita stock sin movimiento. El storefront sigue leyendo `products.stock` |
| Folios | `document_sequences` con bloqueo de fila | Nunca se reutilizan ni se saltan |
| Auditoría | `audit_logs` (insert-only; trigger impide UPDATE/DELETE) | Ni el service_role puede alterarla desde la UI |
| Alertas | Triggers (stock) + `run_anomaly_checks()` programado desde Ktor cada 15 min | Sin pg_cron en el plan actual |
| Agregados de BI | Funciones SQL `bi_*(from, to, branch, tz)` | Volumen esperado (< 100 k ventas/año) se resuelve con índices; no hace falta un data warehouse. `sale_items` lleva `sold_at`, `branch_id`, `category_id`, `neighborhood_id`, `unit_cost` para que casi todo sea un solo escaneo |
| Exportaciones | Ktor genera CSV y XLSX (SpreadsheetML propio, sin POI); PDF = vista de impresión del navegador | 512 MB de RAM; POI/iText no caben con holgura |
| Tickets | HTML 80 mm con `@media print` + reimpresión desde la venta | Impresoras térmicas trabajan mejor con el driver del navegador |

### 3.2 Multi-sucursal desde el día uno

```
organizations -+- branches -+- warehouses
               |            +- cash_registers
               |            +- user_branches (usuarios con acceso)
               +- users / roles / permissions
               +- settings (por organizacion)
```

Toda tabla operativa lleva `organization_id`; ventas, inventario y caja llevan además `branch_id`/`warehouse_id`. La tienda en línea es un **canal** (`sales.channel = 'ONLINE'`) que descarga del almacén marcado `is_default_online`.

### 3.3 Entorno de desarrollo

Supabase gratuito permite 2 proyectos activos y ambos están ocupados (SexyShop + MultiHaus). Hasta que se libere o actualice uno:

- El esquema se aplica al proyecto SexyShop con migraciones **aditivas** (no se altera ninguna columna usada por el storefront).
- Los datos demo viven en una **organización aparte** (`Sonroja Demo`): sucursal, almacén, productos (`slug` con prefijo `demo-`), clientes y ~1 200 ventas. El storefront filtra por la organización real, así que nunca los ve. `purge_demo_data()` los elimina en cascada.
- Cuando exista proyecto dev propio: `supabase/migrations/*.sql` se aplican en orden y `seed_demo.sql` genera los datos.

## 4. Módulos

| Zona | Módulo | Backend (`com.sexyshop.erp.*`) | Frontend (`erp/js/modules/*`) |
|---|---|---|---|
| Core | Auth, usuarios, roles, permisos, sucursales, almacenes, auditoría, notificaciones, settings, archivos | `core`, `users`, `org`, `audit`, `notifications`, `settings` | `settings/*`, `alerts` |
| Operación | Productos, categorías, marcas, proveedores, compras/recepciones, inventario (stock, movimientos, transferencias, ajustes, conteos), POS, ventas, devoluciones, clientes, caja, gastos, promociones | `catalog`, `inventory`, `purchasing`, `sales`, `customers`, `cash`, `promotions` | `products`, `stock`, `movements`, `transfers`, `counts`, `suppliers`, `purchases`, `pos`, `sales`, `returns`, `customers`, `cash`, `expenses` |
| Inteligencia | Dashboard ejecutivo, analytics (ventas, productos, categorías, clientes/RFM/cohortes, geografía, horarios, inventario ABC/rotación), tendencias, market basket | `bi` | `dashboard`, `analytics/*`, `trends` |
| Acción | Centro de alertas, insights, modo ejecutivo, anomalías | `bi.insights`, `notifications` | `executive`, `alerts` |
| Reporting | Report center, exportaciones CSV/XLSX, impresión | `reports`, `export` | `reports` |

## 5. Riesgos técnicos identificados

1. **JWT sin verificar en producción (crítico, ya existente).** Cualquiera podía forjar un token con el `sub` del admin. Se corrige en Fase 1 verificando contra GoTrue.
2. **Un solo proyecto Supabase.** Mitigado con organización demo aislada; a mediano plazo conviene un proyecto dev.
3. **512 MB en Railway.** Nada de bibliotecas pesadas (POI, iText). Agregados en SQL, no en memoria. El `DashboardService` legado cargaba todos los pedidos en memoria: se reemplaza.
4. **`products.stock` lo usan el storefront y el webhook de MP.** Se vuelve columna derivada; `descontar_stock`/`devolver_stock` se reescriben para registrar movimientos. Misma firma, mismo comportamiento externo.
5. **Concurrencia en POS.** `create_sale` bloquea las filas de `inventory_levels` (`FOR UPDATE`) y rechaza stock negativo; folio con bloqueo de secuencia; idempotencia por `client_ref`.
6. **Privacidad.** Clientes sin datos sexuales; nombres enmascarables en pantalla ("modo discreto"); acceso a costo/margen bajo permiso `products.cost.read`; acceso a datos de cliente auditado.
7. **Sin build en frontend.** Se compensa con ES modules, un router y un mini design system. Si el ERP crece más allá de ~30 k líneas, migrar a Vite es un cambio mecánico (los módulos ya son ESM).

## 6. Orden de implementación

Fase 1 Foundation → 2 Catalog → 3 Inventory → 4 Sales → 5 Cash → 6 Analytics → 7 Reporting → 8 Security/Audit → 9 Polish. Cada fase deja la base compilando, migrada y con el flujo de aceptación (`docs/ACCEPTANCE.md`) ejecutable hasta donde llega.
