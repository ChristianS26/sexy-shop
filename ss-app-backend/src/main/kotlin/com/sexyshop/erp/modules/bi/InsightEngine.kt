package com.sexyshop.erp.modules.bi

import com.sexyshop.erp.core.*
import kotlinx.serialization.json.*
import java.text.NumberFormat
import java.util.Locale

/**
 * Convierte los agregados de BI en mensajes de negocio ("¿Qué significa? ¿Qué debería hacer?").
 * Es la capa que más adelante puede alimentar a un asistente con LLM: cada insight tiene
 * tipo, severidad, texto y datos de soporte.
 */
class InsightEngine(private val analytics: AnalyticsService) {
    private val money: NumberFormat = NumberFormat.getCurrencyInstance(Locale("es", "MX")).apply { maximumFractionDigits = 0 }
    private val days = listOf("domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado")

    private fun insight(type: String, severity: String, title: String, text: String, action: String? = null, data: JsonObject? = null, link: String? = null) =
        jsonOf("type" to type, "severity" to severity, "title" to title, "text" to text, "action" to action, "data" to data, "link" to link)

    private fun pct(cur: Double, prev: Double): Double? = if (prev > 0) Math.round((cur - prev) / prev * 1000) / 10.0 else null
    private fun fmtPct(p: Double) = (if (p >= 0) "+" else "") + String.format(Locale("es", "MX"), "%.1f", p) + " %"
    private fun hourLabel(h: Int) = "${if (h % 12 == 0) 12 else h % 12} ${if (h < 12) "AM" else "PM"}"

    suspend fun generate(ctx: AuthContext, r: DateRange, branch: String?): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        val ov = analytics.overview(ctx, r, branch)
        val cur = ov.obj("current") ?: JsonObject(emptyMap()); val prev = ov.obj("previous") ?: JsonObject(emptyMap())
        val revenue = cur.dbl("revenue") ?: 0.0; val prevRevenue = prev.dbl("revenue") ?: 0.0
        val inv = ov.obj("inventory") ?: JsonObject(emptyMap())

        // 1. Ventas vs período anterior
        pct(revenue, prevRevenue)?.let { g ->
            out.add(insight("SALES_TREND", if (g >= 0) "SUCCESS" else "WARNING", if (g >= 0) "Las ventas crecen" else "Las ventas bajan",
                "Vendiste ${money.format(revenue)} en ${r.label.lowercase()}, ${fmtPct(g)} respecto al período anterior (${money.format(prevRevenue)}).",
                if (g < -10) "Revisa qué productos o categorías cayeron en Tendencias." else null, jsonOf("revenue" to revenue, "prev" to prevRevenue, "growth_pct" to g), "#/analytics/trends"))
        }
        // 2. Ticket promedio
        val avg = cur.dbl("avg_ticket") ?: 0.0; val prevAvg = prev.dbl("avg_ticket") ?: 0.0
        pct(avg, prevAvg)?.let { g -> if (Math.abs(g) >= 5) out.add(insight("AVG_TICKET", if (g >= 0) "INFO" else "WARNING", "Ticket promedio ${if (g >= 0) "sube" else "baja"}",
            "El ticket promedio es ${money.format(avg)} (${fmtPct(g)}).", if (g < 0) "Considera promociones de combo o cross-selling en el POS." else null, jsonOf("avg_ticket" to avg, "prev" to prevAvg))) }

        // 3. Top producto y concentración
        val top = analytics.topProducts(ctx, r, branch, "revenue", 50, null).jsonArray.map { it.jsonObject }
        if (top.isNotEmpty()) {
            val first = top.first()
            out.add(insight("TOP_PRODUCT", "INFO", "Tu producto estrella", "“${first.str("name")}” fue el más vendido: ${money.format(first.dbl("revenue") ?: 0.0)} en ${first.int("units") ?: 0} unidades.", null, first, "#/products/${first.str("product_id")}"))
            val total = top.sumOf { it.dbl("revenue") ?: 0.0 }
            var acc = 0.0; var n = 0
            for (p in top) { acc += p.dbl("revenue") ?: 0.0; n++; if (acc / total >= 0.6) break }
            if (total > 0 && n <= 10) out.add(insight("CONCENTRATION", "INFO", "Pocos productos concentran las ventas", "$n productos representan el ${Math.round(acc / total * 100)} % de tus ventas del período.",
                "Asegura su stock antes que nada: son tu base de ingresos.", jsonOf("products" to n, "share_pct" to Math.round(acc / total * 100)), "#/analytics/inventory"))
        }
        // 4. Horario fuerte
        val heat = analytics.heatmap(ctx, r, branch).jsonArray.map { it.jsonObject }
        if (heat.size >= 5) {
            val best = heat.maxByOrNull { it.dbl("revenue") ?: 0.0 }!!
            val byDay = heat.groupBy { it.int("dow") }.mapValues { (_, v) -> v.sumOf { it.dbl("revenue") ?: 0.0 } }
            val bestDay = byDay.maxByOrNull { it.value }!!
            val hours = heat.filter { it.int("dow") == bestDay.key }.sortedByDescending { it.dbl("revenue") ?: 0.0 }.take(2).mapNotNull { it.int("hour") }.sorted()
            out.add(insight("PEAK_HOURS", "INFO", "Tu mejor horario", "Los ${days[bestDay.key ?: 0]} concentran más ventas (${money.format(bestDay.value)}); la hora pico es ${hourLabel(best.int("hour") ?: 0)} del ${days[best.int("dow") ?: 0]}.",
                "Programa más personal y promociones en ${if (hours.size == 2) "${hourLabel(hours[0])}–${hourLabel(hours[1] + 1)}" else hourLabel(best.int("hour") ?: 0)}.", jsonOf("dow" to bestDay.key, "hours" to hours), "#/analytics/time"))
        }
        // 5. Colonias
        val geo = analytics.byNeighborhood(ctx, r, branch, 10)
        val rows = geo.arr("rows")?.map { it.jsonObject } ?: emptyList()
        if (rows.isNotEmpty()) {
            val first = rows.first()
            out.add(insight("TOP_NEIGHBORHOOD", "INFO", "¿De dónde vienen tus clientes?", "La colonia ${first.str("name")} genera el ${first.dbl("share_pct")} % de las ventas (${money.format(first.dbl("revenue") ?: 0.0)}).", null, first, "#/analytics/geography"))
            rows.filter { it.int("sales") ?: 0 >= 3 }.maxByOrNull { it.dbl("avg_ticket") ?: 0.0 }?.let { b -> if (b.str("name") != first.str("name")) out.add(insight("BEST_TICKET_NEIGHBORHOOD", "INFO", "La colonia con mayor ticket", "${b.str("name")} tiene el ticket promedio más alto: ${money.format(b.dbl("avg_ticket") ?: 0.0)}.", "Enfoca ahí campañas de productos premium.", b, "#/analytics/geography")) }
            rows.filter { (it.dbl("growth_pct") ?: 0.0) > 25 && (it.dbl("prev_revenue") ?: 0.0) > 0 }.maxByOrNull { it.dbl("growth_pct") ?: 0.0 }?.let { g -> out.add(insight("EMERGING_NEIGHBORHOOD", "SUCCESS", "Colonia emergente", "${g.str("name")} creció ${fmtPct(g.dbl("growth_pct") ?: 0.0)} frente al período anterior.", null, g, "#/analytics/geography")) }
        }
        // 6. Inventario
        val rot = analytics.rotation(ctx, 90, 90)
        val sum = rot.obj("summary") ?: JsonObject(emptyMap())
        val deadValue = (sum.dbl("dead_value") ?: 0.0) + (sum.dbl("slow_value") ?: 0.0)
        val slowCount = (sum.int("dead_count") ?: 0) + (sum.int("slow_count") ?: 0)
        if (slowCount > 0) out.add(insight("SLOW_STOCK", if (deadValue > 20000) "WARNING" else "INFO", "Inventario detenido", "Tienes ${money.format(deadValue)} en $slowCount productos con rotación baja o nula en los últimos 90 días.", "Considera promociones de liquidación o bundles para moverlos.", jsonOf("value" to deadValue, "count" to slowCount), "#/analytics/inventory"))
        val out1 = inv.int("out_of_stock") ?: 0; val crit = inv.int("critical") ?: 0
        if (out1 + crit > 0) out.add(insight("STOCK_RISK", if (out1 > 0) "CRITICAL" else "WARNING", "Productos en riesgo", "$out1 productos agotados y $crit en nivel crítico.", "Revisa las sugerencias de reorden en Compras.", jsonOf("out" to out1, "critical" to crit), "#/purchases/suggestions"))
        rot.arr("rows")?.map { it.jsonObject }?.filter { it.str("classification") == "FAST" && (it.int("days_of_inventory") ?: 99) <= 7 }?.sortedBy { it.int("days_of_inventory") }?.take(3)?.forEach { p ->
            out.add(insight("RUNNING_OUT", "WARNING", "Podría agotarse pronto", "“${p.str("name")}” se agotaría en aproximadamente ${p.int("days_of_inventory")} días al ritmo actual (${p.int("stock")} en stock).", "Haz un pedido al proveedor esta semana.", p, "#/products/${p.str("product_id")}"))
        }
        // 7. Clientes
        val cust = analytics.customers(ctx, r, branch)
        val newC = cust.int("new_in_period") ?: 0; val retC = cust.int("returning_in_period") ?: 0
        if (newC + retC > 0) out.add(insight("CUSTOMER_MIX", "INFO", "Clientes nuevos y recurrentes", "$newC clientes nuevos y $retC recurrentes compraron en el período. Tasa de recompra histórica: ${cust.dbl("repeat_rate_pct") ?: 0} %.",
            if ((cust.dbl("repeat_rate_pct") ?: 0.0) < 30) "Un programa de lealtad o seguimiento por WhatsApp puede elevar la recompra." else null, cust.without("top"), "#/analytics/customers"))
        val inactive = cust.int("inactive_90d") ?: 0
        if (inactive > 10) out.add(insight("INACTIVE_CUSTOMERS", "INFO", "Clientes por recuperar", "$inactive clientes no compran desde hace más de 90 días.", "Filtra el segmento “En riesgo” en Clientes y contáctalos con una oferta.", jsonOf("inactive" to inactive), "#/analytics/customers"))
        // 8. Tendencias
        val tr = analytics.trends(ctx, 4, branch)
        tr.arr("products_rising")?.firstOrNull()?.jsonObject?.let { p -> out.add(insight("RISING_PRODUCT", "SUCCESS", "Producto en crecimiento", "“${p.str("name")}” creció ${fmtPct(p.dbl("growth_pct") ?: 0.0)} en las últimas 4 semanas.", "Asegura inventario y dale visibilidad.", p, "#/analytics/trends")) }
        tr.arr("products_falling")?.firstOrNull()?.jsonObject?.let { p -> out.add(insight("FALLING_PRODUCT", "WARNING", "Producto en caída", "“${p.str("name")}” cayó ${fmtPct(p.dbl("growth_pct") ?: 0.0)} en las últimas 4 semanas.", "Revisa precio, exhibición o reemplázalo.", p, "#/analytics/trends")) }
        tr.arr("categories_rising")?.firstOrNull()?.jsonObject?.let { c -> out.add(insight("RISING_CATEGORY", "SUCCESS", "Categoría en crecimiento", "Las ventas de ${c.str("name")} aumentaron ${fmtPct(c.dbl("growth_pct") ?: 0.0)} durante las últimas 4 semanas.", null, c, "#/analytics/trends")) }
        tr.arr("baskets")?.firstOrNull()?.jsonObject?.let { b -> if ((b.int("together") ?: 0) >= 3) out.add(insight("BASKET", "INFO", "Se compran juntos", "“${b.str("name_a")}” y “${b.str("name_b")}” se llevaron juntos ${b.int("together")} veces.", "Crea un bundle o sugiere el segundo en el POS.", b, "#/analytics/products")) }
        // 9. Descuentos y cancelaciones
        val disc = cur.dbl("discounts") ?: 0.0
        if (revenue > 0 && disc / (revenue + disc) > 0.1) out.add(insight("DISCOUNTS", "WARNING", "Descuentos altos", "Los descuentos representan el ${Math.round(disc / (revenue + disc) * 100)} % de las ventas brutas del período.", "Revisa quién los otorga en Vendedores y la auditoría.", jsonOf("discounts" to disc), "#/analytics/sales"))
        val cancelled = cur.int("cancelled") ?: 0; val orders = cur.int("orders") ?: 0
        if (orders > 0 && cancelled.toDouble() / (orders + cancelled) > 0.05) out.add(insight("CANCELLATIONS", "WARNING", "Muchas cancelaciones", "$cancelled ventas canceladas frente a $orders completadas.", "Revisa los motivos en el historial de ventas.", jsonOf("cancelled" to cancelled), "#/sales?status=CANCELLED"))
        // 10. Margen
        val gp = cur.dbl("gross_profit"); val net = cur.dbl("net_revenue")
        if (gp != null && net != null && net > 0) out.add(insight("MARGIN", "INFO", "Margen bruto", "Tu margen bruto del período es ${Math.round(gp / net * 100)} % (${money.format(gp)} de utilidad bruta).", null, jsonOf("gross_profit" to gp, "margin_pct" to Math.round(gp / net * 100)), "#/analytics/financial"))

        val order = mapOf("CRITICAL" to 0, "WARNING" to 1, "SUCCESS" to 2, "INFO" to 3)
        return out.sortedBy { order[it.str("severity")] ?: 9 }
    }

    /** Vista ejecutiva: responde las preguntas del dueño en un solo payload. */
    suspend fun executive(ctx: AuthContext, r: DateRange, branch: String?): JsonObject {
        val ov = analytics.overview(ctx, r, branch)
        val cur = ov.obj("current") ?: JsonObject(emptyMap()); val prev = ov.obj("previous") ?: JsonObject(emptyMap())
        val trends = analytics.trends(ctx, 4, branch)
        val rot = analytics.rotation(ctx, 90, 90)
        val geo = analytics.byNeighborhood(ctx, r, branch, 5)
        val heat = analytics.heatmap(ctx, r, branch).jsonArray.map { it.jsonObject }.sortedByDescending { it.dbl("revenue") ?: 0.0 }.take(5)
        val cust = analytics.customers(ctx, r, branch)
        val fin = if (ctx.has("analytics.financial")) analytics.financial(ctx, r, branch) else null
        val toBuy = rot.arr("rows")?.map { it.jsonObject }?.filter { (it.int("stock") ?: 0) <= (it.int("min_stock") ?: 3) || ((it.int("days_of_inventory") ?: 999) <= 10 && (it.int("units_sold") ?: 0) > 0) }?.sortedBy { it.int("days_of_inventory") ?: 999 }?.take(10) ?: emptyList()
        val stuck = rot.arr("rows")?.map { it.jsonObject }?.filter { it.str("classification") in setOf("DEAD", "SLOW") }?.sortedByDescending { it.dbl("stock_value") ?: 0.0 }?.take(10) ?: emptyList()
        val insights = generate(ctx, r, branch)
        fun kpi(key: String) = jsonOf("current" to cur[key], "previous" to prev[key], "change_pct" to pct(cur.dbl(key) ?: 0.0, prev.dbl(key) ?: 0.0))
        return jsonOf(
            "range" to r.json(), "greeting_name" to ctx.firstName,
            "how_is_business" to jsonOf("revenue" to kpi("revenue"), "orders" to kpi("orders"), "avg_ticket" to kpi("avg_ticket"), "gross_profit" to kpi("gross_profit"), "units" to kpi("units"), "customers" to kpi("customers")),
            "what_sold" to analytics.topProducts(ctx, r, branch, "revenue", 10, null),
            "what_grows" to trends["products_rising"], "what_falls" to trends["products_falling"], "categories_growing" to trends["categories_rising"], "categories_falling" to trends["categories_falling"],
            "what_to_buy" to toBuy, "where_customers" to geo["rows"], "when_sell" to heat, "margin" to fin?.let { jsonOf("gross_margin_pct" to it["gross_margin_pct"], "gross_profit" to it["gross_profit"], "operating_profit" to it["operating_profit"], "expenses" to it["expenses"]) },
            "stuck_products" to stuck, "returning_customers" to trends["recurring_customers"], "customer_summary" to cust.without("top"),
            "this_week" to insights.filter { it.str("action") != null }.take(6), "insights" to insights,
            "alerts" to ov["alerts"], "inventory" to ov["inventory"],
        )
    }
}
