# Criterios de aceptación — flujo completo

El sistema se considera funcional cuando este recorrido se completa de punta a punta. Cada paso indica dónde se hace en la UI y qué lo respalda en el backend/BD.

| # | Paso | UI | Backend / BD | Verificado |
|---|---|---|---|---|
| 1 | Crear usuario | Configuración → Usuarios → Nuevo | `POST /users` → GoTrue admin + `users` | ✔ API test (validación 422) · pendiente manual tras deploy |
| 2 | Asignarle rol | mismo formulario (roles y sucursales) | `user_roles`, `user_branches`; `guardRoleEscalation` | ✔ unit test |
| 3 | Crear categoría | Configuración → Categorías | `POST /categories` | ✔ (SQL) |
| 4 | Crear proveedor | Compras → Proveedores | `POST /suppliers` | ✔ (SQL) |
| 5 | Crear producto | Inventario → Productos → Nuevo | `POST /products` (SKU auto, slug único) | ✔ (SQL) |
| 6 | Costo / precio | mismo formulario (costo solo con `products.cost.read`) | `products.price.update` auditado | ✔ |
| 7 | Recibir inventario | Compras → Nueva orden → Enviar → Recibir | `create_purchase_order` → `receive_purchase_order` → `PURCHASE` | ✔ SQL (seed demo: 12 órdenes recibidas) |
| 8 | Ver stock | Inventario → Existencias | `v_stock`, `/inventory/summary` | ✔ |
| 9 | Crear cliente | Clientes → Nuevo (con colonia) | `customers` + `customer_addresses` → `resolve_neighborhood` | ✔ SQL |
| 10–13 | Venta, cliente, productos, cobrar | Ventas → Punto de venta | `/pos/quote` → `create_sale` (turno, stock, folio, pagos, caja) | ✔ SQL (prueba transaccional con rollback + 1 123 ventas demo) |
| 14 | Ticket | se abre al cobrar; reimpresión desde la venta | `/sales/{id}/ticket` (80 mm / carta / PDF) | ✔ |
| 15 | Ver venta | Ventas → fila | `/sales/{id}` (items, pagos, auditoría, movimientos) | ✔ |
| 16 | Movimiento de inventario | Inventario → Movimientos | `inventory_movements` `SALE` | ✔ SQL |
| 17 | Reducción de stock | Existencias / ficha | `inventory_levels` → `products.stock` | ✔ SQL (6 → 5 tras venta y devolución) |
| 18 | Dashboard | Dashboard | `/analytics/overview` | ✔ SQL |
| 19 | Venta en analytics | Analytics → Overview / Productos | `bi_*` | ✔ SQL |
| 20 | Cancelar / devolver | Ventas → acciones | `cancel_sale`, `create_sale_return` | ✔ SQL (stock 5 → 4 → 4 tras cancelar) |
| 21 | Inventario actualizado | Existencias | `SALE_RETURN` | ✔ SQL |
| 22 | Auditoría | Configuración → Auditoría | `audit_logs` (cash.open, sales.create, sales.discount, sales.refund, sales.cancel, cash.close) | ✔ SQL |
| 23 | Reporte | Reportes | `/reports/{key}` | ✔ |
| 24 | Exportar | Reportes → Excel / CSV; tablas → Exportar | `Exporter` (CSV/XLSX) | ✔ unit test (round-trip XLSX) |

## Pruebas automatizadas
- `ss-app-backend/src/test` — 27 pruebas: motor de promociones, validación, ocultamiento de costo, rangos de fecha en zona Hermosillo, exportación CSV/XLSX, parser CSV/XLSX, traducción de errores de BD, autorización de rutas (401/403/422 antes de tocar la BD), escalada de roles.
- Flujo transaccional SQL (venta con descuento y cambio → idempotencia → devolución parcial → segunda venta con tarjeta → cancelación → cierre de caja con diferencia y alerta) ejecutado contra la base con rollback; los resultados cuadraron en todos los campos.
- `ss-app-frontend/erp`: `npm run check` valida sintaxis de los 31 módulos; se cruzaron las llamadas del frontend contra las rutas del backend.

## Pendiente de verificación manual (requiere despliegue)
Prueba en navegador del recorrido completo con la organización demo (`demo.admin@sonroja.demo / Sonroja2026!`) una vez que Railway despliegue el backend y GitHub Pages publique `/erp/`.
