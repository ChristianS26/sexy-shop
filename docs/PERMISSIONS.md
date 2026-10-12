# Roles y permisos (RBAC)

El backend valida **cada** permiso (`call.require("x")`) antes de tocar datos; el frontend solo oculta lo que no puede usarse. Los permisos de un usuario son la unión de los de sus roles (`user_permissions()`), cacheados 60 s e invalidados al editar usuarios/roles.

## Permisos

| Módulo | Permisos |
|---|---|
| Catálogo | `products.read`, `products.create`, `products.update`, `products.delete`, `products.cost.read` (ver costo/margen/utilidad), `products.import`, `categories.manage`, `brands.manage` |
| Inventario | `inventory.read`, `inventory.adjust`, `inventory.transfer`, `inventory.count` |
| Compras | `suppliers.manage`, `purchases.read`, `purchases.create`, `purchases.update`, `purchases.receive`, `purchases.cancel` |
| Ventas | `sales.read` (todas), `sales.read.own` (solo propias), `sales.create`, `sales.update` (notas/cliente; también permite precio manual en POS), `sales.cancel`, `sales.refund`, `sales.discount`, `promotions.manage` |
| Clientes | `customers.read`, `customers.create`, `customers.update`, `customers.delete`, `customers.export` |
| Caja | `cash.read` (todos los turnos), `cash.open`, `cash.close`, `cash.movements`, `expenses.manage` |
| Inteligencia | `analytics.read`, `analytics.financial`, `reports.read`, `reports.export` |
| Administración | `users.read`, `users.create`, `users.update`, `users.delete`, `roles.manage`, `branches.manage`, `settings.manage`, `settings.system`, `audit.read`, `alerts.read`, `alerts.resolve` |

## Roles del sistema

| Rol | Descuento máx. | Alcance |
|---|---|---|
| `SUPER_ADMIN` | sin límite | Todo, incluida configuración crítica (`settings.system`), roles de sistema y otorgar SUPER_ADMIN. |
| `ADMIN` | sin límite | Todo excepto `settings.system`. |
| `MANAGER` | 20 % | Analytics y finanzas, inventario, compras, ventas (cancelar/devolver), clientes, caja, gastos, ver usuarios, alertas, auditoría. |
| `SALES` | 5 % | Ver productos (sin costo), POS, **sus** ventas, clientes (crear/editar), abrir/cerrar caja, alertas. No: costos, rentabilidad, inventario arbitrario, usuarios. |
| `WAREHOUSE` | 0 % | Productos (editar), inventario completo (ajustes, transferencias, conteos), recibir compras, proveedores, alertas. |
| `ACCOUNTING` | 0 % | Ventas, clientes, caja (lectura), gastos, compras (lectura), finanzas, reportes y exportación, auditoría, costo. |
| `ANALYST` | 0 % | Solo lectura: analytics, finanzas, reportes, productos (con costo), ventas, clientes, inventario, compras. |

Se pueden crear roles propios por organización desde Configuración → Roles (combinación libre de permisos y descuento máximo).

## Reglas de protección

- Un usuario no puede desactivar, eliminar ni quitarse el rol de administrador a sí mismo.
- Solo un `SUPER_ADMIN` puede otorgar `SUPER_ADMIN` o editar roles de sistema.
- La sucursal de una operación debe estar en `user_branches` del usuario (o tener `branches.manage`).
- Descuentos: requieren `sales.discount`, motivo obligatorio, y el porcentaje total (promociones excluidas) no puede exceder `max_discount_pct` del rol (lo valida también `create_sale` en la base).
- Costo/margen: se eliminan de **todas** las respuestas (productos, inventario, ventas, analytics, reportes, auditoría) sin `products.cost.read`.
- Consultar el expediente de un cliente queda auditado (`customers.view`).
- `audit_logs` es inmutable incluso para `service_role` (trigger).
