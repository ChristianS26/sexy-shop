# Estrategia de Business Intelligence

## Decisión de capa analítica

Volumen esperado: una tienda física + canal web, del orden de 1 000–5 000 ventas/mes como escenario alto. A ese tamaño Postgres responde en milisegundos con índices adecuados, así que **no** se construye un data warehouse ni tablas agregadas materializadas (añadirían latencia de refresco y complejidad sin beneficio). En su lugar:

1. **`sale_items` desnormalizada**: lleva `sold_at`, `branch_id`, `category_id`, `brand_id`, `neighborhood_id`, `customer_id`, `seller_id`, `channel`, `unit_cost`, `net_amount`, `returned_quantity`. Casi toda la analítica de producto/categoría/colonia es un escaneo indexado de una sola tabla.
2. **Funciones SQL `bi_*`** con parámetros `(org, from, to, branch, tz)` que devuelven JSON listo para la UI. Calculan también el periodo anterior de la misma duración para los comparativos.
3. **Zona horaria** `America/Hermosillo` (sin horario de verano) para cortes por día/hora.
4. **Cache de permisos y contexto** en el backend; los dashboards piden un solo endpoint agregador (`/analytics/overview`) que combina varias funciones.
5. Si el volumen crece (> 100 k ventas/año) el siguiente paso es `daily_sales_summary` / `product_sales_summary` como vistas materializadas refrescadas por hora; las funciones `bi_*` son el único punto a cambiar.

## Métricas y definiciones

| Métrica | Definición |
|---|---|
| Ingresos | `sum(total − refunded_amount)` de ventas no canceladas en el periodo (incluye IVA). |
| Ingreso neto | ingreso sin IVA (`net_amount`). |
| COGS | `unit_cost × unidades netas` (costo al momento de la venta). |
| Utilidad bruta / margen | ingreso neto − COGS; margen % sobre ingreso neto. |
| Utilidad operativa | utilidad bruta − gastos del periodo. |
| Ticket promedio | ingresos / número de ventas. |
| Clientes nuevos | primera compra dentro del periodo. Recurrentes: compraron en el periodo y su primera compra fue antes. |
| RFM | quintiles sobre toda la base: R (días desde la última compra), F (compras), M (gasto). Segmentos: Champions, Loyal, Potential, New, At Risk, Can't Lose, Hibernating, Lost. |
| Cohortes | mes de primera compra × meses transcurridos → % de clientes que volvieron a comprar. |
| ABC | acumulado de ingresos ordenado: A hasta 80 %, B hasta 95 %, C resto. |
| Rotación | unidades vendidas en N días / stock; días de inventario = stock / venta diaria; turnover = COGS / valor del inventario. DEAD = con stock y sin venta en 90 días; SLOW = < 1 unidad/mes; FAST = ≤ 7 días de inventario. |
| Market basket | pares de productos en el mismo ticket: soporte, confianza A→B y lift. |
| Tendencias | últimas N semanas vs las N anteriores por producto, categoría, colonia; horarios fuertes; clientes recurrentes. |
| Heatmap | ventas por día de la semana × hora (ingresos, tickets, ticket promedio). |

## De la inteligencia a la acción

`InsightEngine` (Kotlin) convierte los agregados en mensajes con tipo, severidad, texto, acción sugerida, datos de soporte y enlace: tendencia de ventas, ticket promedio, producto estrella y concentración, horario pico, colonia líder/mejor ticket/emergente, inventario detenido, riesgo de agotamiento ("se agotaría en ~N días"), mezcla de clientes, inactivos, productos/categorías en crecimiento o caída, productos que se compran juntos, descuentos altos, cancelaciones, margen. El **Modo ejecutivo** ordena esas respuestas por pregunta del dueño.

## Preparado para IA

Los insights ya son datos estructurados (`type`, `data`). Un asistente con LLM puede recibir el resultado de `/analytics/executive` o de cada `bi_*` como contexto y responder "¿qué vendió más este mes?", "¿qué debería reordenar?" sin tocar el modelo de datos. La función `global_search` y los endpoints JSON sirven como herramientas (tool calling) para ese asistente.

## Mapas

`neighborhoods` guarda `lat`/`lng`; `bi_by_neighborhood` ya los devuelve. Integrar Mapbox/Google Maps es solo frontend.
