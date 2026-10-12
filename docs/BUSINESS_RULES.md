# Reglas de negocio

Las reglas críticas viven en funciones SQL (una transacción cada una) y se complementan con validaciones en Ktor. Ninguna regla importante vive en componentes de UI.

## Inventario
1. **Nunca se cambia el stock sin movimiento.** `products.stock` es derivado de `inventory_levels`; cualquier UPDATE directo (admin legado) se convierte automáticamente en un `ADJUSTMENT_IN/OUT` con rastro.
2. Cada movimiento lleva referencia única `INV-AAAA-NNNNNN`, cantidad con signo, existencia antes/después, usuario y motivo. Es inmutable: se corrige con otro movimiento.
3. Stock negativo prohibido (`STOCK_INSUFICIENTE`) salvo `inventory.allow_negative`. La fila de `inventory_levels` se bloquea con `FOR UPDATE` → dos ventas simultáneas de la última pieza no pasan ambas.
4. Semáforo: 🔴 agotado (0) · 🟠 crítico (≤ mitad del mínimo) · 🟡 bajo (≤ mínimo) · 🟢 saludable · 🔵 exceso (> máximo). Alertas `OUT_OF_STOCK`/`INVENTORY_LOW` se crean/resuelven solas por trigger.
5. Transferencia: enviar descuenta el origen (`TRANSFER_OUT`); recibir suma al destino (`TRANSFER_IN`); lo que no llega se registra como `LOSS` y genera alerta. Cancelar una transferencia en tránsito regresa al origen.
6. Conteo físico: solo se ajustan partidas con cantidad contada; cada diferencia es un movimiento `INVENTORY_COUNT`.
7. Recepción de compra (parcial o total) genera `PURCHASE` por partida y actualiza el costo (`LAST` por defecto, `AVERAGE` configurable).

## Ventas
8. `create_sale` valida en orden: sucursal/almacén → turno abierto de la misma sucursal (si hay efectivo y `require_shift_for_cash`) → cliente → productos activos y variante requerida → descuentos (límite por rol, motivo) → pagos (suma ≥ total; solo efectivo da cambio) → folio → partidas → inventario (`SALE`) → pagos/caja → estadísticas del cliente → promociones usadas → auditoría. Si algo falla, nada queda escrito.
9. Folios `SON-AAAA-NNNNNN` consecutivos por organización y año, nunca reutilizados. `client_ref` hace idempotente el cobro (doble clic = misma venta).
10. Precios incluyen IVA (configurable). Cada partida guarda tasa, IVA, importe neto, costo y descuento (el descuento general se reparte proporcionalmente para que la analítica por producto sea exacta).
11. Promociones se aplican automáticamente en el servidor (`PromotionEngine`): porcentaje, fijo, 2x1/3x2, bundle, producto gratis, por categoría, por cantidad; con vigencia, mínimo y máximo de usos. Por línea gana el mejor descuento. El descuento manual es aparte y auditado.
12. Una venta completada **no se borra**: se cancela (regresa todo el inventario, reembolso en el turno abierto, dentro de `allow_cancel_days`) o se devuelve (parcial/total; `restock=false` registra entrada + merma). Estados: COMPLETED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED.
13. Pedidos web: el checkout descuenta inventario al crear el pedido (`descontar_stock` → movimiento `SALE`); al confirmarse/enviarse/entregarse se crea la venta `ONLINE` (sin volver a descontar) y el cliente se vincula por teléfono con su colonia; al cancelarse el pedido, la venta se cancela y el inventario regresa (`devolver_stock`).

## Caja
14. Una caja solo puede tener un turno abierto. Abrir registra `OPENING`; cada pago registra `SALE` con su método (`affects_cash` solo efectivo); cancelaciones y devoluciones registran `REFUND`.
15. Cierre: esperado = fondo + ventas efectivo − reembolsos efectivo + depósitos − retiros − gastos de caja. Diferencia > `alerts.cash_difference_threshold` → alerta `CASH_DISCREPANCY`. Movimientos inmutables.
16. Un gasto pagado desde el turno sale del cajón (`EXPENSE`) y después no se edita ni elimina.

## Clientes y privacidad
17. Datos mínimos: nombre, contacto, dirección. Sin atributos sensibles; las notas son libres pero se desaconseja información íntima. Eliminar = anonimizar (teléfono, correo, notas, cumpleaños) conservando historial de ventas.
18. La colonia se normaliza (unaccent + alias + ciudad) a `neighborhoods`; las ventas guardan la colonia vigente del cliente en el momento de la venta.
19. El acceso al expediente (Customer 360) se audita. El modo discreto oculta nombres en pantalla; el ticket no muestra el cliente salvo configuración.

## Seguridad y auditoría
20. Autenticación en Supabase Auth (bcrypt, sesiones, recuperación, MFA disponible); el backend verifica la firma del token con GoTrue y aplica RBAC en cada ruta.
21. Auditoría inmutable de login/logout, catálogo, precios, inventario, ventas, descuentos, cancelaciones, devoluciones, usuarios, roles, caja, settings, exportaciones de cliente, impresión de tickets.
22. Anomalías (cada 15 min o a demanda): cancelaciones por usuario/día, descuentos promedio por vendedor, devoluciones por semana, ventas fuera de horario, ajustes de inventario inusuales, alta demanda con poco stock, órdenes de compra vencidas. Generan alertas, no bloquean.

## Numeración
`SON-` ventas · `DEV-` devoluciones · `INV-` movimientos · `PO-` órdenes de compra · `REC-` recepciones · `TRF-` transferencias · `ADJ-` ajustes · `CNT-` conteos. Formato `PREFIJO-AAAA-NNNNNN`.
