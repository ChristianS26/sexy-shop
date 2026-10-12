package com.sexyshop.erp.modules.reports

import com.sexyshop.erp.core.*
import com.sexyshop.erp.modules.bi.AnalyticsService
import com.sexyshop.erp.modules.bi.DateRange
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*

/**
 * Report Center: catálogo de reportes con filtros comunes (rango, sucursal) y exportación
 * CSV/XLSX generada server-side. Cada reporte declara sus columnas y una función que
 * produce filas (JsonObject) a partir de los agregados o de consultas paginadas en bloque.
 */
class ReportDef(val key: String, val group: String, val name: String, val description: String, val permission: String, val columns: List<ExportColumn>, val run: suspend (AuthContext, DateRange, String?, Map<String, String?>) -> List<JsonObject>)

class ReportCenter(private val db: Db, private val a: AnalyticsService) {
    private val money = { k: String, l: String -> ExportColumn(k, l, numeric = true) }

    /** Lee una tabla completa en bloques de 1 000 (sin cargar sin límite en memoria). */
    private suspend fun scan(table: String, columns: String, order: String, maxRows: Int = 20000, filters: io.github.jan.supabase.postgrest.query.filter.PostgrestFilterBuilder.() -> Unit): List<JsonObject> {
        val out = mutableListOf<JsonObject>(); var page = 1
        while (out.size < maxRows) {
            val (rows, _) = db.list(table, columns, PageQuery(page, 1000, order, true, null), filters, mapOf(order to order))
            out += rows; if (rows.size < 1000) break; page++
        }
        return out
    }

    val reports: List<ReportDef> = listOf(
        ReportDef("sales_by_day", "VENTAS", "Ventas por día", "Ingresos, tickets y unidades por día.", "reports.read",
            listOf(ExportColumn("bucket", "Fecha"), money("revenue", "Ingresos"), ExportColumn("orders", "Ventas", true), ExportColumn("units", "Unidades", true), money("avg_ticket", "Ticket promedio"), ExportColumn("customers", "Clientes", true))) { ctx, r, b, _ -> a.timeseries(ctx, r, b, "day").jsonArray.map { it.jsonObject } },
        ReportDef("sales_by_month", "VENTAS", "Ventas por mes", "Resumen mensual de ingresos.", "reports.read",
            listOf(ExportColumn("bucket", "Mes"), money("revenue", "Ingresos"), ExportColumn("orders", "Ventas", true), ExportColumn("units", "Unidades", true), money("avg_ticket", "Ticket promedio"))) { ctx, r, b, _ -> a.timeseries(ctx, r, b, "month").jsonArray.map { it.jsonObject } },
        ReportDef("sales_by_product", "VENTAS", "Ventas por producto", "Ranking de productos por ingresos, unidades y margen.", "reports.read",
            listOf(ExportColumn("name", "Producto"), ExportColumn("sku", "SKU"), ExportColumn("category_name", "Categoría"), ExportColumn("units", "Unidades", true), money("revenue", "Ingresos"), money("margin", "Margen"), ExportColumn("growth_pct", "Crecimiento %", true), ExportColumn("stock", "Stock", true))) { ctx, r, b, _ -> a.topProducts(ctx, r, b, "revenue", 1000, null).jsonArray.map { it.jsonObject } },
        ReportDef("sales_by_category", "VENTAS", "Ventas por categoría", "Participación y crecimiento por categoría.", "reports.read",
            listOf(ExportColumn("name", "Categoría"), money("revenue", "Ingresos"), ExportColumn("units", "Unidades", true), ExportColumn("share_pct", "Participación %", true), money("margin", "Margen"), ExportColumn("growth_pct", "Crecimiento %", true))) { ctx, r, b, _ -> a.byCategory(ctx, r, b).jsonArray.map { it.jsonObject } },
        ReportDef("sales_by_customer", "VENTAS", "Ventas por cliente", "Clientes ordenados por gasto en el período.", "customers.export",
            listOf(ExportColumn("customer", "Cliente"), ExportColumn("phone", "Teléfono"), ExportColumn("sales", "Compras", true), money("revenue", "Ingresos"), money("avg_ticket", "Ticket promedio"), ExportColumn("last_purchase_at", "Última compra"))) { ctx, r, b, _ ->
            scan("sales", "customer_id, total, refunded_amount, sold_at, customers(first_name, last_name, phone)", "sold_at") { org(ctx); neq("status", "CANCELLED"); notNull("customer_id"); gte("sold_at", r.from.toString()); lt("sold_at", r.to.toString()); eqOpt("branch_id", b) }
                .groupBy { it.str("customer_id") }.map { (_, v) -> val c = v.first().obj("customers"); val rev = v.sumOf { (it.dbl("total") ?: 0.0) - (it.dbl("refunded_amount") ?: 0.0) }
                    jsonOf("customer" to listOfNotNull(c?.str("first_name"), c?.str("last_name")).joinToString(" "), "phone" to c?.str("phone"), "sales" to v.size, "revenue" to rev, "avg_ticket" to Math.round(rev / v.size * 100) / 100.0, "last_purchase_at" to v.maxOf { it.str("sold_at") ?: "" }) }.sortedByDescending { it.dbl("revenue") } },
        ReportDef("sales_by_neighborhood", "VENTAS", "Ventas por colonia", "Ranking geográfico de ventas.", "reports.read",
            listOf(ExportColumn("name", "Colonia"), ExportColumn("city", "Ciudad"), ExportColumn("sales", "Ventas", true), money("revenue", "Ingresos"), ExportColumn("customers", "Clientes", true), money("avg_ticket", "Ticket promedio"), ExportColumn("share_pct", "Participación %", true), ExportColumn("growth_pct", "Crecimiento %", true))) { ctx, r, b, _ -> a.byNeighborhood(ctx, r, b, 500).arr("rows")?.map { it.jsonObject } ?: emptyList() },
        ReportDef("sales_by_seller", "VENTAS", "Ventas por vendedor", "Desempeño por vendedor: ventas, ticket, descuentos y cancelaciones.", "reports.read",
            listOf(ExportColumn("name", "Vendedor"), ExportColumn("sales", "Ventas", true), money("revenue", "Ingresos"), money("avg_ticket", "Ticket promedio"), ExportColumn("units", "Unidades", true), money("discounts", "Descuentos"), ExportColumn("discount_pct", "Descuento %", true), ExportColumn("cancelled", "Canceladas", true), money("margin", "Margen"))) { ctx, r, b, _ -> a.sellers(ctx, r, b).jsonArray.map { it.jsonObject } },
        ReportDef("sales_by_payment", "VENTAS", "Ventas por método de pago", "Mezcla de pagos del período.", "reports.read",
            listOf(ExportColumn("name", "Método"), money("amount", "Monto"), ExportColumn("sales", "Ventas", true), ExportColumn("share_pct", "Participación %", true))) { ctx, r, b, _ -> a.paymentMethods(ctx, r, b).jsonArray.map { it.jsonObject } },
        ReportDef("sales_detail", "VENTAS", "Detalle de ventas", "Una fila por venta con folio, cliente, vendedor, totales y estado.", "reports.read",
            listOf(ExportColumn("folio", "Folio"), ExportColumn("sold_at", "Fecha"), ExportColumn("channel", "Canal"), ExportColumn("status", "Estado"), ExportColumn("customer", "Cliente"), ExportColumn("seller", "Vendedor"), ExportColumn("items_count", "Unidades", true), money("subtotal", "Subtotal"), money("discount_amount", "Descuento"), money("tax_amount", "IVA"), money("total", "Total"), money("refunded_amount", "Reembolsado"), ExportColumn("payment", "Pago"))) { ctx, r, b, _ ->
            scan("sales", "folio, sold_at, channel, status, items_count, subtotal, discount_amount, tax_amount, total, refunded_amount, customers(first_name, last_name), seller:users!sales_seller_id_fkey(first_name, last_name), sale_payments(method_code)", "sold_at") { org(ctx); gte("sold_at", r.from.toString()); lt("sold_at", r.to.toString()); eqOpt("branch_id", b) }
                .map { s -> s.with("customer" to s.obj("customers")?.let { listOfNotNull(it.str("first_name"), it.str("last_name")).joinToString(" ") }, "seller" to s.obj("seller")?.let { listOfNotNull(it.str("first_name"), it.str("last_name")).joinToString(" ") }, "payment" to s.arr("sale_payments")?.joinToString("+") { it.jsonObject.str("method_code") ?: "" }) } },
        ReportDef("stock_current", "INVENTARIO", "Stock actual", "Existencias por producto y almacén con semáforo y valor.", "reports.read",
            listOf(ExportColumn("product_name", "Producto"), ExportColumn("effective_sku", "SKU"), ExportColumn("variant_name", "Variante"), ExportColumn("category_name", "Categoría"), ExportColumn("warehouse_name", "Almacén"), ExportColumn("quantity", "Existencia", true), ExportColumn("min_stock", "Mínimo", true), ExportColumn("stock_status", "Estado"), money("unit_cost", "Costo"), money("stock_value", "Valor"))) { ctx, _, _, f -> scan("v_stock", "*", "product_name") { org(ctx); eq("is_active", true); eqOpt("warehouse_id", f["warehouse"]) } },
        ReportDef("stock_low", "INVENTARIO", "Stock bajo y agotado", "Productos por debajo del mínimo.", "reports.read",
            listOf(ExportColumn("product_name", "Producto"), ExportColumn("effective_sku", "SKU"), ExportColumn("warehouse_name", "Almacén"), ExportColumn("quantity", "Existencia", true), ExportColumn("min_stock", "Mínimo", true), ExportColumn("stock_status", "Estado"))) { ctx, _, _, _ -> scan("v_stock", "*", "quantity") { org(ctx); eq("is_active", true); isIn("stock_status", listOf("OUT", "CRITICAL", "LOW")) } },
        ReportDef("stock_movements", "INVENTARIO", "Movimientos de inventario", "Kardex del período.", "reports.read",
            listOf(ExportColumn("created_at", "Fecha"), ExportColumn("reference", "Referencia"), ExportColumn("movement_type", "Tipo"), ExportColumn("product_name", "Producto"), ExportColumn("sku", "SKU"), ExportColumn("warehouse_name", "Almacén"), ExportColumn("quantity", "Cantidad", true), ExportColumn("quantity_before", "Antes", true), ExportColumn("quantity_after", "Después", true), ExportColumn("reason", "Motivo"), ExportColumn("user_name", "Usuario"))) { ctx, r, _, f ->
            scan("inventory_movements", "*, products(name, sku), warehouses(name), users(first_name, last_name)", "created_at") { org(ctx); gte("created_at", r.from.toString()); lt("created_at", r.to.toString()); eqOpt("warehouse_id", f["warehouse"]); eqOpt("movement_type", f["type"]) }.map { com.sexyshop.erp.modules.inventory.shapeMovement(it) } },
        ReportDef("stock_rotation", "INVENTARIO", "Rotación de inventario", "Ventas diarias, días de inventario, rotación y clasificación.", "reports.read",
            listOf(ExportColumn("name", "Producto"), ExportColumn("sku", "SKU"), ExportColumn("category_name", "Categoría"), ExportColumn("stock", "Stock", true), ExportColumn("units_sold", "Vendidas 90d", true), ExportColumn("avg_daily_sales", "Venta diaria", true), ExportColumn("days_of_inventory", "Días de inventario", true), ExportColumn("turnover", "Rotación", true), ExportColumn("classification", "Clasificación"), money("stock_value", "Valor"), ExportColumn("last_sold", "Última venta"))) { ctx, _, _, _ -> a.rotation(ctx).arr("rows")?.map { it.jsonObject } ?: emptyList() },
        ReportDef("stock_dead", "INVENTARIO", "Dead stock", "Productos sin venta en 90 días con existencia.", "reports.read",
            listOf(ExportColumn("name", "Producto"), ExportColumn("sku", "SKU"), ExportColumn("stock", "Stock", true), money("stock_value", "Valor"), ExportColumn("last_sold", "Última venta"), ExportColumn("last_received", "Última entrada"))) { ctx, _, _, _ -> a.rotation(ctx).arr("rows")?.map { it.jsonObject }?.filter { it.str("classification") == "DEAD" } ?: emptyList() },
        ReportDef("stock_abc", "INVENTARIO", "Clasificación ABC", "Productos clasificados por contribución a ventas.", "reports.read",
            listOf(ExportColumn("class", "Clase"), ExportColumn("name", "Producto"), ExportColumn("sku", "SKU"), ExportColumn("category", "Categoría"), money("revenue", "Ingresos"), ExportColumn("units", "Unidades", true), money("margin", "Margen"), ExportColumn("share_pct", "Participación %", true), ExportColumn("cum_pct", "Acumulado %", true), ExportColumn("stock", "Stock", true), ExportColumn("rotation", "Rotación", true))) { ctx, r, _, _ -> a.abc(ctx, r).arr("rows")?.map { it.jsonObject } ?: emptyList() },
        ReportDef("purchases_by_supplier", "COMPRAS", "Compras por proveedor", "Órdenes y montos por proveedor en el período.", "reports.read",
            listOf(ExportColumn("supplier", "Proveedor"), ExportColumn("orders", "Órdenes", true), money("total", "Total"), ExportColumn("completed", "Completadas", true), ExportColumn("pending", "Pendientes", true))) { ctx, r, _, _ ->
            scan("purchase_orders", "supplier_id, status, total, suppliers(name)", "created_at") { org(ctx); gte("created_at", r.from.toString()); lt("created_at", r.to.toString()); neq("status", "CANCELLED") }
                .groupBy { it.str("supplier_id") }.map { (_, v) -> jsonOf("supplier" to v.first().obj("suppliers")?.str("name"), "orders" to v.size, "total" to v.sumOf { it.dbl("total") ?: 0.0 }, "completed" to v.count { it.str("status") == "COMPLETED" }, "pending" to v.count { it.str("status") in setOf("SENT", "PARTIAL", "DRAFT") }) }.sortedByDescending { it.dbl("total") } },
        ReportDef("purchases_detail", "COMPRAS", "Órdenes de compra", "Listado de órdenes del período.", "reports.read",
            listOf(ExportColumn("folio", "Folio"), ExportColumn("created_at", "Fecha"), ExportColumn("supplier", "Proveedor"), ExportColumn("status", "Estado"), ExportColumn("expected_date", "Fecha esperada"), money("subtotal", "Subtotal"), money("tax_amount", "IVA"), money("total", "Total"))) { ctx, r, _, _ ->
            scan("purchase_orders", "folio, created_at, status, expected_date, subtotal, tax_amount, total, suppliers(name)", "created_at") { org(ctx); gte("created_at", r.from.toString()); lt("created_at", r.to.toString()) }.map { it.with("supplier" to it.obj("suppliers")?.str("name")) } },
        ReportDef("purchased_products", "COMPRAS", "Productos comprados", "Unidades y costo recibido por producto.", "reports.read",
            listOf(ExportColumn("product", "Producto"), ExportColumn("sku", "SKU"), ExportColumn("units", "Unidades", true), money("cost", "Costo total"), money("avg_cost", "Costo promedio"))) { ctx, r, _, _ ->
            scan("purchase_receipt_items", "product_id, quantity, unit_cost, products(name, sku), purchase_receipts!inner(organization_id, received_at)", "id") { eq("purchase_receipts.organization_id", ctx.organizationId); gte("purchase_receipts.received_at", r.from.toString()); lt("purchase_receipts.received_at", r.to.toString()) }
                .groupBy { it.str("product_id") }.map { (_, v) -> val units = v.sumOf { it.int("quantity") ?: 0 }; val cost = v.sumOf { (it.int("quantity") ?: 0) * (it.dbl("unit_cost") ?: 0.0) }
                    jsonOf("product" to v.first().obj("products")?.str("name"), "sku" to v.first().obj("products")?.str("sku"), "units" to units, "cost" to cost, "avg_cost" to if (units > 0) Math.round(cost / units * 100) / 100.0 else 0) }.sortedByDescending { it.dbl("cost") } },
        ReportDef("customers_new", "CLIENTES", "Clientes nuevos", "Clientes cuya primera compra fue en el período.", "customers.export",
            listOf(ExportColumn("first_name", "Nombre"), ExportColumn("last_name", "Apellidos"), ExportColumn("phone", "Teléfono"), ExportColumn("email", "Correo"), ExportColumn("source", "Origen"), ExportColumn("first_purchase_at", "Primera compra"), ExportColumn("purchases_count", "Compras", true), money("total_spent", "Gasto total"))) { ctx, r, _, _ -> scan("customers", "first_name, last_name, phone, email, source, first_purchase_at, purchases_count, total_spent", "first_purchase_at") { org(ctx); isNull("deleted_at"); gte("first_purchase_at", r.from.toString()); lt("first_purchase_at", r.to.toString()) } },
        ReportDef("customers_recurring", "CLIENTES", "Clientes recurrentes", "Clientes con dos o más compras.", "customers.export",
            listOf(ExportColumn("first_name", "Nombre"), ExportColumn("last_name", "Apellidos"), ExportColumn("phone", "Teléfono"), ExportColumn("purchases_count", "Compras", true), money("total_spent", "Gasto total"), ExportColumn("first_purchase_at", "Primera compra"), ExportColumn("last_purchase_at", "Última compra"))) { ctx, _, _, _ -> scan("customers", "first_name, last_name, phone, purchases_count, total_spent, first_purchase_at, last_purchase_at", "total_spent") { org(ctx); isNull("deleted_at"); gte("purchases_count", 2) } },
        ReportDef("customers_rfm", "CLIENTES", "Segmentación RFM", "Recency, Frequency, Monetary y segmento por cliente.", "customers.export",
            listOf(ExportColumn("first_name", "Nombre"), ExportColumn("last_name", "Apellidos"), ExportColumn("phone", "Teléfono"), ExportColumn("segment", "Segmento"), ExportColumn("recency_days", "Días desde última compra", true), ExportColumn("frequency", "Compras", true), money("monetary", "Gasto"), ExportColumn("r", "R", true), ExportColumn("f", "F", true), ExportColumn("m", "M", true))) { ctx, _, _, f -> a.rfm(ctx, f["segment"], 5000).arr("customers")?.map { it.jsonObject } ?: emptyList() },
        ReportDef("customers_cohorts", "CLIENTES", "Cohortes de retención", "Retención mensual por cohorte de primera compra.", "reports.read",
            listOf(ExportColumn("cohort", "Cohorte"), ExportColumn("size", "Clientes", true), ExportColumn("m", "Mes", true), ExportColumn("active", "Activos", true), ExportColumn("retention_pct", "Retención %", true), money("revenue", "Ingresos"))) { ctx, _, _, _ ->
            a.cohorts(ctx, 12).jsonArray.flatMap { c -> val co = c.jsonObject; co.arr("months")?.map { m -> m.jsonObject.with("cohort" to co.str("cohort"), "size" to co.int("size")) } ?: emptyList() } },
        ReportDef("finance_pl", "FINANZAS", "Estado de resultados", "Ingresos, costo de ventas, utilidad bruta, gastos y utilidad operativa por mes.", "analytics.financial",
            listOf(ExportColumn("month", "Mes"), money("revenue", "Ingresos"), money("net_revenue", "Ingresos sin IVA"), money("cogs", "Costo de ventas"), money("gross_profit", "Utilidad bruta"), money("expenses", "Gastos"), money("operating_profit", "Utilidad operativa"))) { ctx, r, b, _ -> a.financial(ctx, r, b).arr("by_month")?.map { it.jsonObject } ?: emptyList() },
        ReportDef("finance_expenses", "FINANZAS", "Gastos", "Detalle de gastos del período.", "analytics.financial",
            listOf(ExportColumn("expense_date", "Fecha"), ExportColumn("category", "Categoría"), ExportColumn("description", "Descripción"), money("amount", "Monto"), ExportColumn("payment_method_code", "Método"), ExportColumn("branch", "Sucursal"), ExportColumn("user", "Registró"))) { ctx, r, b, _ ->
            scan("expenses", "expense_date, description, amount, payment_method_code, expense_categories(name), branches(name), users(first_name, last_name)", "expense_date") { org(ctx); isNull("deleted_at"); gte("expense_date", r.from.toString().take(10)); lt("expense_date", r.to.toString().take(10)); eqOpt("branch_id", b) }
                .map { it.with("category" to it.obj("expense_categories")?.str("name"), "branch" to it.obj("branches")?.str("name"), "user" to it.obj("users")?.let { u -> listOfNotNull(u.str("first_name"), u.str("last_name")).joinToString(" ") }) } },
        ReportDef("cash_shifts", "FINANZAS", "Cortes de caja", "Turnos con esperado, contado y diferencia.", "cash.read",
            listOf(ExportColumn("opened_at", "Apertura"), ExportColumn("closed_at", "Cierre"), ExportColumn("register", "Caja"), ExportColumn("opened_by", "Abrió"), money("opening_amount", "Fondo"), money("expected_cash", "Esperado"), money("counted_cash", "Contado"), money("difference", "Diferencia"), ExportColumn("sales_count", "Ventas", true), money("sales_total", "Total ventas"))) { ctx, r, b, _ ->
            scan("cash_shifts", "opened_at, closed_at, opening_amount, expected_cash, counted_cash, difference, sales_count, sales_total, cash_registers(name), opener:users!cash_shifts_opened_by_fkey(first_name, last_name)", "opened_at") { org(ctx); gte("opened_at", r.from.toString()); lt("opened_at", r.to.toString()); eqOpt("branch_id", b) }
                .map { it.with("register" to it.obj("cash_registers")?.str("name"), "opened_by" to it.obj("opener")?.let { u -> listOfNotNull(u.str("first_name"), u.str("last_name")).joinToString(" ") }) } },
    )

    fun find(key: String) = reports.firstOrNull { it.key == key } ?: throw ErpException.notFound("Reporte no encontrado.")
}

fun Route.reportsRoutes(center: ReportCenter) {
    get("/reports") {
        val ctx = call.require("reports.read")
        call.respond(JsonArray(center.reports.filter { ctx.has(it.permission) || ctx.has("reports.read") && it.permission == "reports.read" }.map { r ->
            jsonOf("key" to r.key, "group" to r.group, "name" to r.name, "description" to r.description, "columns" to r.columns.map { jsonOf("key" to it.key, "label" to it.label, "numeric" to it.numeric) }, "allowed" to ctx.has(r.permission))
        }))
    }
    get("/reports/{key}") {
        val ctx = call.require("reports.read")
        val def = center.find(call.requiredParam("key"))
        if (!ctx.has(def.permission)) throw ErpException.forbidden()
        val format = call.request.queryParameters["format"]
        if (format in setOf("csv", "xlsx") && !ctx.has("reports.export")) throw ErpException.forbidden("No tienes permiso para exportar.")
        val range = DateRange.from(call, ctx.timezone)
        val branch = call.request.queryParameters["branch"]?.takeIf { it.isNotBlank() }
        val filters = call.request.queryParameters.entries().associate { it.key to it.value.firstOrNull() }
        val rows = def.run(ctx, range, branch, filters).map { it.stripCost(ctx) }
        val columns = def.columns.filter { ctx.has("products.cost.read") || it.key !in COST_FIELDS }
        call.respondExport(def.key, columns, rows, format)
    }
}
