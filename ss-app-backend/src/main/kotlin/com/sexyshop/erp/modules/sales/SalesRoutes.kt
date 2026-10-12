package com.sexyshop.erp.modules.sales

import com.sexyshop.erp.core.*
import io.ktor.http.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*

/**
 * Ventas / POS. La transacción (folio, partidas, pagos, inventario, caja, cliente,
 * auditoría) vive en `create_sale`; aquí se valida autorización, se aplican
 * promociones y se arma el payload.
 */
class SalesService(private val db: Db, private val promos: PromotionEngine) {

    data class Quote(val items: JsonArray, val gross: Double, val promoDiscount: Double, val applied: List<JsonObject>, val suggestions: List<JsonObject>)

    /** Resuelve precios y categorías desde el catálogo y aplica promociones. */
    suspend fun quote(ctx: AuthContext, rawItems: List<JsonObject>, allowOverride: Boolean): Quote {
        if (rawItems.isEmpty()) throw ErpException.badRequest("Agrega al menos un producto.", "SIN_PARTIDAS")
        val productIds = rawItems.mapNotNull { it.str("product_id") }.distinct()
        if (productIds.isEmpty()) throw ErpException.badRequest("Las partidas no tienen producto.", "SIN_PARTIDAS")
        val products = db.selectAll("products", "id, name, price, category_id, is_active, has_variants, deleted_at, categories(parent_id)") { isIn("id", productIds); org(ctx) }.associateBy { it.str("id")!! }
        val variantIds = rawItems.mapNotNull { it.str("variant_id") }.distinct()
        val variants = if (variantIds.isEmpty()) emptyMap() else db.selectAll("product_variants", "id, product_id, name, price, is_active") { isIn("id", variantIds) }.associateBy { it.str("id")!! }

        val lines = rawItems.mapIndexed { i, it ->
            val p = products[it.str("product_id")] ?: throw ErpException.badRequest("Un producto del carrito ya no existe.", "PRODUCTO_INVALIDO")
            if (p.bool("is_active") != true || p.str("deleted_at") != null) throw ErpException.badRequest("“${p.str("name")}” no está disponible para venta.", "PRODUCTO_INACTIVO")
            val v = it.str("variant_id")?.let { vid -> variants[vid] ?: throw ErpException.badRequest("La variante seleccionada no existe.", "VARIANTE_INVALIDA") }
            if (p.bool("has_variants") == true && v == null) throw ErpException.badRequest("“${p.str("name")}” requiere elegir una variante.", "VARIANTE_REQUERIDA")
            val qty = it.int("quantity") ?: 0
            if (qty <= 0) throw ErpException.badRequest("Las cantidades deben ser mayores a 0.", "CANTIDAD_INVALIDA")
            val basePrice = v?.dbl("price") ?: p.dbl("price") ?: 0.0
            val price = if (allowOverride && it.dbl("unit_price") != null) it.dbl("unit_price")!! else basePrice
            CartLine(i, p.str("id")!!, v?.str("id"), p.str("category_id"), p.obj("categories")?.str("parent_id"), price, qty, p.str("name")!! + (v?.str("name")?.let { n -> " · $n" } ?: ""))
        }
        val result = promos.apply(lines, promos.activePromotions(ctx.organizationId))
        val items = JsonArray(lines.map { l ->
            val d = result.lineDiscounts[l.index]
            jsonOf("product_id" to l.productId, "variant_id" to l.variantId, "quantity" to l.quantity, "unit_price" to l.unitPrice, "name" to l.name,
                "discount_amount" to (d?.first ?: 0.0), "promotion_id" to d?.second, "line_total" to Math.round((l.gross - (d?.first ?: 0.0)) * 100) / 100.0)
        })
        return Quote(items, lines.sumOf { it.gross }, result.lineDiscounts.values.sumOf { it.first }, result.applied, result.suggestions)
    }

    companion object {
        const val SALE_COLUMNS = "*, customers(id, first_name, last_name, phone), seller:users!sales_seller_id_fkey(id, first_name, last_name), branches(id, name), neighborhoods(name), sale_payments(method_code, amount)"
        val PROMO_FIELDS = listOf("name", "description", "promo_type", "value", "buy_qty", "get_qty", "min_quantity", "min_amount", "max_uses", "starts_at", "ends_at", "status", "free_product_id")
    }
}

fun Route.salesRoutes(db: Db, service: SalesService, audit: AuditService) {

    post("/pos/quote") {
        val ctx = call.require("sales.create")
        val body = call.receiveOrThrow<JsonObject>()
        val q = service.quote(ctx, body.arr("items")?.map { it.jsonObject } ?: emptyList(), ctx.has("sales.update"))
        val discountPct = body.dbl("discount_pct") ?: 0.0
        val net = q.gross - q.promoDiscount
        val manual = Math.round(net * discountPct / 100 * 100) / 100.0
        call.respond(jsonOf("items" to q.items, "gross" to q.gross, "promotion_discount" to q.promoDiscount, "manual_discount" to manual,
            "total" to Math.round((net - manual) * 100) / 100.0, "applied_promotions" to q.applied, "suggestions" to q.suggestions,
            "max_discount_pct" to ctx.maxDiscountPct))
    }

    post("/sales") {
        val ctx = call.require("sales.create")
        val body = call.receiveOrThrow<JsonObject>()
        val branch = call.branchOrDefault(body.str("branch_id"))
        val discountPct = body.dbl("discount_pct") ?: 0.0
        val discountAmount = body.dbl("discount_amount") ?: 0.0
        if ((discountPct > 0 || discountAmount > 0) && !ctx.has("sales.discount")) throw ErpException.forbidden("No tienes permiso para aplicar descuentos.")
        if ((discountPct > 0 || discountAmount > 0) && body.str("discount_reason").isNullOrBlank()) throw ErpException.badRequest("Indica el motivo del descuento.", "MOTIVO_REQUERIDO")
        val sellerId = body.str("seller_id")?.takeIf { ctx.has("sales.read") } ?: ctx.userId
        val q = service.quote(ctx, body.arr("items")?.map { it.jsonObject } ?: emptyList(), ctx.has("sales.update"))
        val payload = jsonOf(
            "organization_id" to ctx.organizationId, "branch_id" to branch, "warehouse_id" to body.str("warehouse_id"), "user_id" to ctx.userId, "seller_id" to sellerId,
            "customer_id" to body.str("customer_id"), "cash_shift_id" to body.str("cash_shift_id"), "channel" to (body.str("channel") ?: "POS"), "client_ref" to body.str("client_ref"),
            "notes" to body.str("notes"), "discount_pct" to discountPct.takeIf { it > 0 }, "discount_amount" to discountAmount.takeIf { it > 0 && discountPct <= 0 }, "discount_reason" to body.str("discount_reason"),
            "max_discount_pct" to ctx.maxDiscountPct, "allow_price_override" to ctx.has("sales.update"), "items" to q.items, "payments" to (body["payments"] ?: JsonArray(emptyList())),
        )
        val sale = db.rpcObject("create_sale", jsonOf("p" to payload))
        call.respond(HttpStatusCode.Created, sale.stripCost(ctx))
    }

    get("/sales") {
        val ctx = call.require("sales.read", "sales.read.own")
        val q = PageQuery.from(call, "sold_at")
        val p = call.request.queryParameters
        val onlyOwn = !ctx.has("sales.read")
        val productFilter = p["product"]; val categoryFilter = p["category"]
        val cols = if (productFilter != null || categoryFilter != null) SalesService.SALE_COLUMNS + ", sale_items!inner(product_id, category_id)" else SalesService.SALE_COLUMNS
        val (rows, total) = db.list("sales", cols, q, {
            org(ctx); eqOpt("status", p["status"]); eqOpt("channel", p["channel"]); eqOpt("branch_id", p["branch"]); eqOpt("customer_id", p["customer"]); eqOpt("cash_shift_id", p["shift"])
            if (onlyOwn) eq("seller_id", ctx.userId) else eqOpt("seller_id", p["seller"])
            dateRange("sold_at", p["from"], p["to"])
            if (productFilter != null) eq("sale_items.product_id", productFilter)
            if (categoryFilter != null) eq("sale_items.category_id", categoryFilter)
            if (q.q != null) ilike("folio", "%${q.q}%")
        }, mapOf("sold_at" to "sold_at", "total" to "total", "folio" to "folio", "status" to "status", "items_count" to "items_count"))
        val method = p["payment_method"]
        val shaped = rows.map { s ->
            s.with("customer" to s.obj("customers"), "seller_name" to s.obj("seller")?.let { listOfNotNull(it.str("first_name"), it.str("last_name")).joinToString(" ") }, "branch_name" to s.obj("branches")?.str("name"),
                "neighborhood_name" to s.obj("neighborhoods")?.str("name"), "payments" to s.arr("sale_payments")).without("customers", "seller", "branches", "neighborhoods", "sale_payments", "sale_items").stripCost(ctx)
        }.let { list -> if (method != null) list.filter { s -> s.arr("payments")?.any { it.jsonObject.str("method_code") == method } == true } else list }
        call.respond(paged(shaped, q, total))
    }

    get("/sales/{id}") {
        val ctx = call.require("sales.read", "sales.read.own")
        val id = call.requiredParam("id")
        val sale = db.rpcObject("sale_json", jsonOf("p_sale" to id))
        if (sale.str("organization_id") != ctx.organizationId) throw ErpException.notFound("Venta no encontrada.")
        if (!ctx.has("sales.read") && sale.str("seller_id") != ctx.userId) throw ErpException.forbidden()
        val movements = db.selectAll("inventory_movements", "id, reference, movement_type, quantity, quantity_before, quantity_after, created_at, products(name)", order = "created_at") { or { eq("reference_id", id); isIn("reference_id", (sale.arr("returns")?.mapNotNull { it.jsonObject.str("id") } ?: emptyList()) + id) } }
        val auditTrail = db.selectAll("audit_logs", "id, action, user_name, created_at, metadata", order = "created_at") { eq("entity_type", "SALE"); eq("entity_id", id) }
        call.respond(sale.with("inventory_movements" to movements, "audit" to auditTrail).stripCost(ctx))
    }

    get("/sales/{id}/ticket") {
        val ctx = call.require("sales.read", "sales.read.own", "sales.create")
        val id = call.requiredParam("id")
        val sale = db.rpcObject("sale_json", jsonOf("p_sale" to id))
        if (sale.str("organization_id") != ctx.organizationId) throw ErpException.notFound("Venta no encontrada.")
        val settings = db.selectAll("organization_settings", "key, value") { eq("organization_id", ctx.organizationId); isIn("key", listOf("ticket", "company", "tax")) }.associate { it.str("key")!! to it["value"] }
        val branch = sale.str("branch_id")?.let { db.one("branches") { eq("id", it) } }
        audit.log(call, "sales.ticket.print", "SALE", id, metadata = jsonOf("folio" to sale.str("folio")))
        call.respond(jsonOf("sale" to sale.without("total_cost").with("items" to sale.arr("items")?.map { it.jsonObject.without("unit_cost") }), "ticket" to settings["ticket"], "company" to settings["company"], "tax" to settings["tax"], "branch" to branch, "organization" to ctx.organization))
    }

    patch("/sales/{id}") {
        val ctx = call.require("sales.update")
        val id = call.requiredParam("id")
        val before = db.one("sales") { eq("id", id); org(ctx) } ?: throw ErpException.notFound("Venta no encontrada.")
        val body = pick(call.receiveOrThrow<JsonObject>(), listOf("notes", "customer_id"))
        val after = db.update("sales", id, body)
        if (body.containsKey("customer_id")) db.updateWhere("sale_items", jsonOf("customer_id" to body.str("customer_id"))) { eq("sale_id", id) }
        audit.log(call, "sales.update", "SALE", id, before, after)
        call.respond(after.stripCost(ctx))
    }

    post("/sales/{id}/cancel") {
        val ctx = call.require("sales.cancel")
        val id = call.requiredParam("id")
        val body = call.receiveOrThrow<JsonObject>()
        validate { notBlank(body.str("reason"), "reason", "El motivo") }
        val sale = db.one("sales", "id, organization_id") { eq("id", id); org(ctx) } ?: throw ErpException.notFound("Venta no encontrada.")
        val res = db.rpcObject("cancel_sale", jsonOf("p_sale" to sale.str("id"), "p_user" to ctx.userId, "p_reason" to body.str("reason"), "p_cash_shift" to body.str("cash_shift_id")))
        call.respond(res.stripCost(ctx))
    }

    post("/sales/{id}/returns") {
        val ctx = call.require("sales.refund")
        val id = call.requiredParam("id")
        val body = call.receiveOrThrow<JsonObject>()
        validate { notBlank(body.str("reason"), "reason", "El motivo"); notBlank(body.str("refund_method_code"), "refund_method_code", "El método de reembolso"); require((body.arr("items")?.size ?: 0) > 0, "items", "Selecciona al menos un producto.") }
        db.one("sales", "id") { eq("id", id); org(ctx) } ?: throw ErpException.notFound("Venta no encontrada.")
        val res = db.rpcObject("create_sale_return", jsonOf("p" to jsonOf("sale_id" to id, "user_id" to ctx.userId, "cash_shift_id" to body.str("cash_shift_id"), "reason" to body.str("reason"),
            "notes" to body.str("notes"), "refund_method_code" to body.str("refund_method_code"), "items" to body["items"])))
        call.respond(HttpStatusCode.Created, res.stripCost(ctx))
    }

    get("/returns") {
        val ctx = call.require("sales.read", "sales.refund")
        val q = PageQuery.from(call, "created_at")
        val p = call.request.queryParameters
        val (rows, total) = db.list("sale_returns", "*, sales(folio, customer_id, customers(first_name, last_name)), users(first_name, last_name), sale_return_items(quantity, line_total, restock, condition, sale_items(product_name))", q, {
            org(ctx); dateRange("created_at", p["from"], p["to"]); eqOpt("branch_id", p["branch"]); eqOpt("sale_id", p["sale"])
            if (q.q != null) ilike("folio", "%${q.q}%")
        }, mapOf("created_at" to "created_at", "refund_amount" to "refund_amount", "folio" to "folio"))
        call.respond(paged(rows, q, total))
    }

    // ---------------------------------------------------------------- Promociones
    get("/promotions") {
        val ctx = call.require("sales.create", "promotions.manage")
        val rows = db.selectAll("promotions", "*, promotion_products(product_id, products(name)), promotion_categories(category_id, categories(name))", order = "created_at", asc = false) { org(ctx); eqOpt("status", call.request.queryParameters["status"]) }
        call.respond(JsonArray(rows))
    }
    post("/promotions") {
        val ctx = call.require("promotions.manage")
        val body = call.receiveOrThrow<JsonObject>()
        val fields = pick(body, SalesService.PROMO_FIELDS)
        validate {
            notBlank(fields.str("name"), "name", "El nombre"); oneOf(fields.str("promo_type"), listOf("PERCENT", "FIXED", "BUY_X_GET_Y", "BUNDLE", "FREE_PRODUCT", "CATEGORY_PERCENT", "QUANTITY_DISCOUNT"), "promo_type", "El tipo")
            require(fields.str("promo_type") != null, "promo_type", "El tipo es obligatorio."); nonNegative(fields.dbl("value"), "value", "El valor")
            require(fields.str("promo_type") !in setOf("PERCENT", "CATEGORY_PERCENT", "QUANTITY_DISCOUNT") || (fields.dbl("value") ?: 0.0) <= 100, "value", "El porcentaje no puede exceder 100.")
        }
        val row = db.insert("promotions", fields.with("organization_id" to ctx.organizationId, "created_by" to ctx.userId))
        linkPromotion(db, row.str("id")!!, body)
        audit.log(call, "promotions.create", "PROMOTION", row.str("id"), null, row.with("products" to body["product_ids"], "categories" to body["category_ids"]))
        call.respond(HttpStatusCode.Created, row)
    }
    patch("/promotions/{id}") {
        val ctx = call.require("promotions.manage")
        val id = call.requiredParam("id")
        val before = db.one("promotions") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        val body = call.receiveOrThrow<JsonObject>()
        val fields = pick(body, SalesService.PROMO_FIELDS)
        val after = if (fields.isNotEmpty()) db.update("promotions", id, fields) else before
        if (body.containsKey("product_ids") || body.containsKey("category_ids")) linkPromotion(db, id, body)
        audit.log(call, "promotions.update", "PROMOTION", id, before, after)
        call.respond(after)
    }
    delete("/promotions/{id}") {
        val ctx = call.require("promotions.manage")
        val id = call.requiredParam("id")
        val before = db.one("promotions") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        if ((before.int("uses_count") ?: 0) > 0) db.update("promotions", id, jsonOf("status" to "INACTIVE")) else db.delete("promotions") { eq("id", id) }
        audit.log(call, "promotions.delete", "PROMOTION", id, before, null)
        call.respond(HttpStatusCode.NoContent)
    }
}

private suspend fun linkPromotion(db: Db, id: String, body: JsonObject) {
    body.arr("product_ids")?.let { arr ->
        db.delete("promotion_products") { eq("promotion_id", id) }
        db.insertMany("promotion_products", arr.map { jsonOf("promotion_id" to id, "product_id" to it.jsonPrimitive.content) })
    }
    body.arr("category_ids")?.let { arr ->
        db.delete("promotion_categories") { eq("promotion_id", id) }
        db.insertMany("promotion_categories", arr.map { jsonOf("promotion_id" to id, "category_id" to it.jsonPrimitive.content) })
    }
}
