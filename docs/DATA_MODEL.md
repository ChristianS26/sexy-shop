# Modelo de datos

Postgres 17 (Supabase). Todo el esquema del ERP es **aditivo** sobre las tablas que ya usaba el storefront. Las migraciones viven en `supabase/migrations/` y están aplicadas en el proyecto `litzzmjoiujifddkrryp`.

## Diagrama (resumen)

```
organizations ─┬─ branches ─┬─ warehouses ──── inventory_levels (product, variant, qty)
               │            ├─ cash_registers ── cash_shifts ── cash_movements
               │            └─ user_branches
               ├─ users ── user_roles ── roles ── role_permissions ── permissions
               ├─ categories (parent_id) · brands · suppliers · tax_rates
               ├─ products ── product_variants ── product_images
               │      └─ inventory_movements (INV-folio, inmutable)
               ├─ purchase_orders ── purchase_order_items ── purchase_receipts ── purchase_receipt_items
               ├─ inventory_transfers (+items) · inventory_adjustments (+items) · inventory_counts (+items)
               ├─ customers ── customer_addresses ── neighborhoods
               ├─ sales (SON-folio) ── sale_items · sale_payments · sale_returns (DEV-folio) ── sale_return_items
               ├─ promotions ── promotion_products · promotion_categories
               ├─ expenses ── expense_categories
               ├─ notifications · audit_logs (insert-only) · files · organization_settings · document_sequences
               └─ orders / order_items (tienda en línea, legado) ──trigger──▶ sales (channel ONLINE)
```

## Tablas por dominio

### Core
| Tabla | Notas |
|---|---|
| `organizations` | `is_default` = la tienda real (solo una). `is_demo` marca la organización de pruebas. `timezone` por defecto `America/Hermosillo`. |
| `branches`, `warehouses`, `cash_registers` | Códigos únicos por organización. `warehouses.is_default_online` = almacén que descarga el checkout web. |
| `users` | `id` = `auth.users.id`. Soft delete (`deleted_at`). Usuario único por organización. Sin contraseñas: viven en Supabase Auth. |
| `roles`, `permissions`, `role_permissions`, `user_roles`, `user_branches` | Roles de sistema con `organization_id null`; roles propios por organización. `roles.max_discount_pct` (null = sin límite). |
| `audit_logs` | Trigger `raise_immutable` impide UPDATE/DELETE. Guarda usuario, acción, entidad, ip, before/after, metadata. |
| `notifications` | `dedupe_key` + índice parcial: una alerta abierta por clave (p. ej. `stock:<product_id>`). |
| `document_sequences` | Folios por organización/tipo/año con `next_folio()` (upsert con bloqueo). Nunca se reutilizan. |
| `organization_settings` | Clave → JSON (`company`, `locale`, `tax`, `ticket`, `inventory`, `alerts`, `security`, `sales`). |

### Catálogo
| Tabla | Notas |
|---|---|
| `categories` | Jerarquía con `parent_id`. Soft delete. |
| `brands`, `suppliers` | CRUD con soft delete. |
| `products` | Existente, ampliada: `organization_id`, `sku` (único), `barcode`, `short_name`, `brand_id`, `supplier_id`, `tax_rate_id`, `unit`, `max_stock`, `status`, `has_variants`, `search_text` (trigram). `low_stock_threshold` = stock mínimo. **`stock` es derivado** (suma de `inventory_levels`, trigger). |
| `product_variants` | Color/talla/presentación/aroma/modelo en `attributes` jsonb; precio y costo opcionales (heredan). |

### Inventario
| Tabla | Notas |
|---|---|
| `inventory_levels` | Una fila por almacén × producto × variante. `quantity >= 0` salvo `inventory.allow_negative`. |
| `inventory_movements` | Inmutable. `reference` INV-AAAA-NNNNNN, tipo, cantidad con signo, antes/después, costo, motivo, referencia (SALE/ORDER/PURCHASE_RECEIPT/TRANSFER/ADJUSTMENT/COUNT/RETURN), usuario. |
| `inventory_transfers` (+items) | DRAFT → IN_TRANSIT → RECEIVED / CANCELLED. Faltantes → LOSS + alerta. |
| `inventory_adjustments` (+items) | ADJUSTMENT_IN/OUT, DAMAGE, LOSS, INITIAL_STOCK. Folio ADJ-. |
| `inventory_counts` (+items) | Foto del almacén, contados, al finalizar movimientos INVENTORY_COUNT. Folio CNT-. |
| `v_stock` (vista) | Existencias con semáforo (`stock_status`), costo y valor. |

### Compras
`purchase_orders` (PO-folio, DRAFT→SENT→PARTIAL→RECEIVED→COMPLETED→CANCELLED), `purchase_order_items` (`received_quantity`), `purchase_receipts` (REC-folio), `purchase_receipt_items`. Recibir actualiza inventario y el costo del producto (método `LAST` o `AVERAGE`).

### Comercial
| Tabla | Notas |
|---|---|
| `customers` | Datos mínimos. Estadísticas desnormalizadas (`purchases_count`, `total_spent`, `first/last_purchase_at`). Soft delete con anonimización. |
| `customer_addresses`, `neighborhoods` | La colonia de texto libre se normaliza (`resolve_neighborhood`: unaccent + alias) a `neighborhoods` con `lat/lng` para mapas futuros. |
| `payment_methods` | CASH, CARD, TRANSFER, MERCADO_PAGO, OTHER… extensible (`is_cash`, `requires_reference`, `fee_pct`). |
| `cash_shifts`, `cash_movements` | OPEN/CLOSED; movimientos OPENING/SALE/REFUND/DEPOSIT/WITHDRAWAL/EXPENSE con `affects_cash`. Cierre calcula esperado, contado, diferencia y totales por método. Movimientos inmutables. |
| `sales` | SON-folio, canal (POS/ONLINE…), estado (COMPLETED/CANCELLED/REFUNDED/PARTIALLY_REFUNDED), cliente, vendedor, turno, colonia (snapshot), subtotal/IVA/descuento/total/costo, `client_ref` (idempotencia), `source_order_id` (pedido web). |
| `sale_items` | Desnormaliza `sold_at`, `branch_id`, `category_id`, `brand_id`, `neighborhood_id`, `customer_id`, `seller_id`, `channel`, `unit_cost`, `net_amount`, `returned_quantity` → la analítica escanea una sola tabla. |
| `sale_payments`, `sale_returns` (DEV-folio), `sale_return_items` | Devolución parcial/total, restock o merma, reembolso en caja. |
| `promotions` (+products, +categories) | PERCENT, FIXED, BUY_X_GET_Y, BUNDLE, FREE_PRODUCT, CATEGORY_PERCENT, QUANTITY_DISCOUNT con vigencia, mínimo y máximo de usos. |
| `expenses`, `expense_categories` | Gastos por sucursal, método, comprobante; pueden salir del turno abierto. |

## Funciones transaccionales (SECURITY INVOKER, solo service_role)

`post_inventory_movement`, `descontar_stock`/`devolver_stock` (checkout web, misma firma), `apply_inventory_adjustment`, `send_transfer`/`receive_transfer`/`cancel_transfer`, `start_inventory_count`/`finalize_inventory_count`, `create_purchase_order`/`update_purchase_order`/`set_purchase_order_status`/`receive_purchase_order`, `open_cash_shift`/`add_cash_movement`/`close_cash_shift`, `create_sale`/`cancel_sale`/`create_sale_return`, `create_expense`, `resolve_neighborhood`, `next_folio`, `audit_log`, `upsert_notification`, `run_anomaly_checks`, `auth_context`.

## Funciones de BI (STABLE)

`bi_kpis`, `bi_overview`, `bi_timeseries`, `bi_by_category`, `bi_top_products`, `bi_heatmap`, `bi_by_neighborhood`, `bi_neighborhood_products`, `bi_rfm`, `bi_cohorts`, `bi_customers`, `bi_customer_360`, `bi_inventory_abc`, `bi_inventory_rotation`, `bi_sellers`, `bi_payment_methods`, `bi_financial`, `bi_market_basket`, `bi_trends`, `bi_product_history`, `global_search`. Ver [BI_STRATEGY.md](BI_STRATEGY.md).

## Índices relevantes

`sales (organization_id, sold_at desc)`, `sale_items (organization_id, sold_at desc)`, `sale_items (product_id, sold_at)`, `sale_items (organization_id, category_id, sold_at)`, `sale_items (organization_id, neighborhood_id)`, `inventory_movements (product_id, created_at)`, `inventory_levels (warehouse_id, product_id, variant)` único, `products.search_text` GIN trigram, `customers.search_text` GIN trigram, `notifications (organization_id, dedupe_key)` parcial único, `audit_logs (organization_id, created_at)`.

## Seguridad a nivel de datos

- RLS habilitado en todas las tablas del ERP sin políticas: solo `service_role` (el backend) las lee/escribe. Las políticas públicas del storefront quedan limitadas a la organización por defecto y a filas no borradas.
- Las funciones expuestas por PostgREST tienen `REVOKE EXECUTE` para `anon` y `authenticated`.
- `audit_logs`, `inventory_movements` y `cash_movements` son inmutables por trigger.
