package com.sexyshop.erp.modules.bi

import com.sexyshop.erp.core.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*
import java.time.*
import java.time.format.DateTimeFormatter

/**
 * Rango de fechas de los dashboards. Los presets se resuelven en la zona horaria de la
 * organización y se envían a SQL como instantes [from, to).
 */
data class DateRange(val from: Instant, val to: Instant, val preset: String, val label: String) {
    val days: Long get() = Duration.between(from, to).toDays().coerceAtLeast(1)
    fun granularity(): String = when { days <= 2 -> "hour"; days <= 92 -> "day"; days <= 400 -> "week"; else -> "month" }
    fun json() = jsonOf("from" to from.toString(), "to" to to.toString(), "preset" to preset, "label" to label, "days" to days)

    companion object {
        fun from(call: ApplicationCall, tz: String): DateRange {
            val zone = ZoneId.of(tz)
            val p = call.request.queryParameters
            val preset = p["range"] ?: p["preset"] ?: "last30"
            val today = LocalDate.now(zone)
            fun r(a: LocalDate, b: LocalDate, label: String) = DateRange(a.atStartOfDay(zone).toInstant(), b.plusDays(1).atStartOfDay(zone).toInstant(), preset, label)
            return when (preset) {
                "today" -> r(today, today, "Hoy")
                "yesterday" -> r(today.minusDays(1), today.minusDays(1), "Ayer")
                "last7" -> r(today.minusDays(6), today, "Últimos 7 días")
                "last30" -> r(today.minusDays(29), today, "Últimos 30 días")
                "last90" -> r(today.minusDays(89), today, "Últimos 90 días")
                "this_week" -> r(today.with(DayOfWeek.MONDAY), today, "Esta semana")
                "last_week" -> r(today.with(DayOfWeek.MONDAY).minusWeeks(1), today.with(DayOfWeek.MONDAY).minusDays(1), "Semana anterior")
                "this_month" -> r(today.withDayOfMonth(1), today, "Este mes")
                "last_month" -> { val f = today.withDayOfMonth(1).minusMonths(1); r(f, f.plusMonths(1).minusDays(1), "Mes anterior") }
                "this_year" -> r(today.withDayOfYear(1), today, "Este año")
                "last_year" -> { val f = today.withDayOfYear(1).minusYears(1); r(f, f.plusYears(1).minusDays(1), "Año anterior") }
                "custom" -> {
                    val a = p["from"]?.let { LocalDate.parse(it.take(10)) } ?: today.minusDays(29)
                    val b = p["to"]?.let { LocalDate.parse(it.take(10)) } ?: today
                    if (b.isBefore(a)) throw ErpException.badRequest("La fecha final debe ser posterior a la inicial.")
                    r(a, b, "${a.format(DateTimeFormatter.ofPattern("d MMM"))} – ${b.format(DateTimeFormatter.ofPattern("d MMM yyyy"))}")
                }
                else -> r(today.minusDays(29), today, "Últimos 30 días")
            }
        }
    }
}

class AnalyticsService(private val db: Db) {
    private fun base(ctx: AuthContext, r: DateRange, branch: String?) = jsonOf("p_org" to ctx.organizationId, "p_from" to r.from.toString(), "p_to" to r.to.toString(), "p_branch" to branch)

    suspend fun overview(ctx: AuthContext, r: DateRange, branch: String?) = db.rpcObject("bi_overview", base(ctx, r, branch))
    suspend fun timeseries(ctx: AuthContext, r: DateRange, branch: String?, granularity: String?) = db.rpc("bi_timeseries", base(ctx, r, branch).with("p_granularity" to (granularity ?: r.granularity()), "p_tz" to ctx.timezone))
    suspend fun byCategory(ctx: AuthContext, r: DateRange, branch: String?) = db.rpc("bi_by_category", base(ctx, r, branch))
    suspend fun topProducts(ctx: AuthContext, r: DateRange, branch: String?, metric: String, limit: Int, category: String?) = db.rpc("bi_top_products", base(ctx, r, branch).with("p_metric" to metric, "p_limit" to limit, "p_category" to category))
    suspend fun heatmap(ctx: AuthContext, r: DateRange, branch: String?) = db.rpc("bi_heatmap", base(ctx, r, branch).with("p_tz" to ctx.timezone))
    suspend fun byNeighborhood(ctx: AuthContext, r: DateRange, branch: String?, limit: Int = 50) = db.rpcObject("bi_by_neighborhood", base(ctx, r, branch).with("p_limit" to limit))
    suspend fun neighborhoodProducts(ctx: AuthContext, r: DateRange, id: String) = db.rpc("bi_neighborhood_products", jsonOf("p_org" to ctx.organizationId, "p_neighborhood" to id, "p_from" to r.from.toString(), "p_to" to r.to.toString(), "p_limit" to 10))
    suspend fun customers(ctx: AuthContext, r: DateRange, branch: String?) = db.rpcObject("bi_customers", base(ctx, r, branch))
    suspend fun rfm(ctx: AuthContext, segment: String?, limit: Int = 500) = db.rpcObject("bi_rfm", jsonOf("p_org" to ctx.organizationId, "p_limit" to limit, "p_segment" to segment))
    suspend fun cohorts(ctx: AuthContext, months: Int = 12) = db.rpc("bi_cohorts", jsonOf("p_org" to ctx.organizationId, "p_months" to months, "p_tz" to ctx.timezone))
    suspend fun abc(ctx: AuthContext, r: DateRange) = db.rpcObject("bi_inventory_abc", jsonOf("p_org" to ctx.organizationId, "p_from" to r.from.toString(), "p_to" to r.to.toString()))
    suspend fun rotation(ctx: AuthContext, days: Int = 90, deadDays: Int = 90) = db.rpcObject("bi_inventory_rotation", jsonOf("p_org" to ctx.organizationId, "p_days" to days, "p_dead_days" to deadDays))
    suspend fun sellers(ctx: AuthContext, r: DateRange, branch: String?) = db.rpc("bi_sellers", base(ctx, r, branch))
    suspend fun paymentMethods(ctx: AuthContext, r: DateRange, branch: String?) = db.rpc("bi_payment_methods", base(ctx, r, branch))
    suspend fun financial(ctx: AuthContext, r: DateRange, branch: String?) = db.rpcObject("bi_financial", base(ctx, r, branch).with("p_tz" to ctx.timezone))
    suspend fun basket(ctx: AuthContext, r: DateRange, minPairs: Int = 2, limit: Int = 30) = db.rpc("bi_market_basket", jsonOf("p_org" to ctx.organizationId, "p_from" to r.from.toString(), "p_to" to r.to.toString(), "p_min_pairs" to minPairs, "p_limit" to limit))
    suspend fun trends(ctx: AuthContext, weeks: Int, branch: String?) = db.rpcObject("bi_trends", jsonOf("p_org" to ctx.organizationId, "p_weeks" to weeks, "p_branch" to branch, "p_tz" to ctx.timezone))
    suspend fun productHistory(ctx: AuthContext, id: String) = db.rpcObject("bi_product_history", jsonOf("p_product" to id, "p_weeks" to 12, "p_tz" to ctx.timezone))
    suspend fun recentSales(ctx: AuthContext, branch: String?, limit: Long = 8) = db.selectAll("sales", "id, folio, total, status, sold_at, items_count, channel, customers(first_name, last_name), seller:users!sales_seller_id_fkey(first_name)", order = "sold_at", asc = false, limit = limit) { org(ctx); eqOpt("branch_id", branch) }
}

/** Oculta métricas de costo/margen a quien no tiene permiso, recursivamente. */
fun JsonElement.stripCostDeep(auth: AuthContext): JsonElement = if (auth.has("products.cost.read")) this else when (this) {
    is JsonObject -> JsonObject(filterKeys { it !in COST_FIELDS }.mapValues { it.value.stripCostDeep(auth) })
    is JsonArray -> JsonArray(map { it.stripCostDeep(auth) })
    else -> this
}

fun Route.analyticsRoutes(service: AnalyticsService, insights: InsightEngine) {
    fun ApplicationCall.range() = DateRange.from(this, erpAuth.timezone)
    fun ApplicationCall.branch(): String? = request.queryParameters["branch"]?.takeIf { it.isNotBlank() }?.also { if (!erpAuth.canAccessBranch(it)) throw ErpException.forbidden("No tienes acceso a esa sucursal.") }

    get("/analytics/overview") {
        val ctx = call.require("analytics.read")
        val r = call.range(); val b = call.branch()
        val out = jsonOf(
            "range" to r.json(), "overview" to service.overview(ctx, r, b), "timeseries" to service.timeseries(ctx, r, b, call.request.queryParameters["granularity"]),
            "categories" to service.byCategory(ctx, r, b), "top_products" to service.topProducts(ctx, r, b, "revenue", 8, null), "heatmap" to service.heatmap(ctx, r, b),
            "neighborhoods" to service.byNeighborhood(ctx, r, b, 8), "payment_methods" to service.paymentMethods(ctx, r, b), "recent_sales" to service.recentSales(ctx, b),
            "customers" to service.customers(ctx, r, b),
        )
        call.respond(out.stripCostDeep(ctx))
    }
    get("/analytics/sales") {
        val ctx = call.require("analytics.read"); val r = call.range(); val b = call.branch()
        call.respond(jsonOf("range" to r.json(), "overview" to service.overview(ctx, r, b), "timeseries" to service.timeseries(ctx, r, b, call.request.queryParameters["granularity"]),
            "payment_methods" to service.paymentMethods(ctx, r, b), "sellers" to service.sellers(ctx, r, b), "heatmap" to service.heatmap(ctx, r, b)).stripCostDeep(ctx))
    }
    get("/analytics/products") {
        val ctx = call.require("analytics.read"); val r = call.range(); val b = call.branch()
        val metric = call.request.queryParameters["metric"] ?: "revenue"
        val limit = call.request.queryParameters["limit"]?.toIntOrNull()?.coerceIn(1, 100) ?: 15
        call.respond(jsonOf("range" to r.json(), "top" to service.topProducts(ctx, r, b, metric, limit, call.request.queryParameters["category"]),
            "growth" to service.topProducts(ctx, r, b, "growth", 10, null), "decline" to service.topProducts(ctx, r, b, "decline", 10, null),
            "categories" to service.byCategory(ctx, r, b), "basket" to service.basket(ctx, r)).stripCostDeep(ctx))
    }
    get("/analytics/products/{id}/history") {
        val ctx = call.require("analytics.read", "products.read")
        call.respond(service.productHistory(ctx, call.requiredParam("id")).stripCostDeep(ctx))
    }
    get("/analytics/categories") {
        val ctx = call.require("analytics.read"); val r = call.range(); val b = call.branch()
        call.respond(jsonOf("range" to r.json(), "categories" to service.byCategory(ctx, r, b)).stripCostDeep(ctx))
    }
    get("/analytics/customers") {
        val ctx = call.require("analytics.read"); val r = call.range(); val b = call.branch()
        call.respond(jsonOf("range" to r.json(), "summary" to service.customers(ctx, r, b), "rfm" to service.rfm(ctx, call.request.queryParameters["segment"], 200),
            "cohorts" to service.cohorts(ctx, call.request.queryParameters["months"]?.toIntOrNull() ?: 12)).stripCostDeep(ctx))
    }
    get("/analytics/geography") {
        val ctx = call.require("analytics.read"); val r = call.range(); val b = call.branch()
        val n = call.request.queryParameters["neighborhood"]
        call.respond(jsonOf("range" to r.json(), "neighborhoods" to service.byNeighborhood(ctx, r, b, 100), "products" to n?.let { service.neighborhoodProducts(ctx, r, it) }).stripCostDeep(ctx))
    }
    get("/analytics/time") {
        val ctx = call.require("analytics.read"); val r = call.range(); val b = call.branch()
        call.respond(jsonOf("range" to r.json(), "heatmap" to service.heatmap(ctx, r, b), "by_hour" to service.timeseries(ctx, r, b, "hour").takeIf { r.days <= 7 }, "by_day" to service.timeseries(ctx, r, b, "day")).stripCostDeep(ctx))
    }
    get("/analytics/inventory") {
        val ctx = call.require("analytics.read", "inventory.read"); val r = call.range()
        call.respond(jsonOf("range" to r.json(), "abc" to service.abc(ctx, r), "rotation" to service.rotation(ctx, call.request.queryParameters["days"]?.toIntOrNull() ?: 90)).stripCostDeep(ctx))
    }
    get("/analytics/trends") {
        val ctx = call.require("analytics.read")
        call.respond(service.trends(ctx, call.request.queryParameters["weeks"]?.toIntOrNull()?.coerceIn(1, 26) ?: 4, call.branch()).stripCostDeep(ctx))
    }
    get("/analytics/basket") {
        val ctx = call.require("analytics.read"); val r = call.range()
        call.respond(jsonOf("range" to r.json(), "pairs" to service.basket(ctx, r, call.request.queryParameters["min"]?.toIntOrNull() ?: 2, 50)))
    }
    get("/analytics/financial") {
        val ctx = call.require("analytics.financial"); val r = call.range(); val b = call.branch()
        call.respond(jsonOf("range" to r.json(), "financial" to service.financial(ctx, r, b), "payment_methods" to service.paymentMethods(ctx, r, b)))
    }
    get("/analytics/insights") {
        val ctx = call.require("analytics.read"); val r = call.range(); val b = call.branch()
        call.respond(jsonOf("range" to r.json(), "insights" to insights.generate(ctx, r, b)).stripCostDeep(ctx))
    }
    get("/analytics/executive") {
        val ctx = call.require("analytics.read"); val r = call.range(); val b = call.branch()
        call.respond(insights.executive(ctx, r, b).stripCostDeep(ctx))
    }
}
