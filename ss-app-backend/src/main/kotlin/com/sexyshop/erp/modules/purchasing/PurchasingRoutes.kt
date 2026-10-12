package com.sexyshop.erp.modules.purchasing

import com.sexyshop.erp.core.*
import io.ktor.http.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*

/** Órdenes de compra y recepciones (parciales o totales). */
fun Route.purchasingRoutes(db: Db, audit: AuditService) {
    val poCols = "*, suppliers(id, name, contact_name, phone, email), warehouses(id, name, branch_id), creator:users!purchase_orders_created_by_fkey(first_name, last_name), purchase_order_items(id, product_id, variant_id, quantity, received_quantity, unit_cost, line_total, products(name, sku, barcode), product_variants(name))"

    get("/purchases") {
        val ctx = call.require("purchases.read")
        val q = PageQuery.from(call, "created_at")
        val p = call.request.queryParameters
        val (rows, total) = db.list("purchase_orders", poCols, q, {
            org(ctx); eqOpt("status", p["status"]); eqOpt("supplier_id", p["supplier"]); eqOpt("warehouse_id", p["warehouse"]); dateRange("created_at", p["from"], p["to"])
            if (q.q != null) ilike("folio", "%${q.q}%")
        }, mapOf("created_at" to "created_at", "folio" to "folio", "status" to "status", "total" to "total", "expected_date" to "expected_date"))
        call.respond(paged(rows.map { it.stripCost(ctx) }, q, total))
    }

    get("/purchases/{id}") {
        val ctx = call.require("purchases.read")
        val id = call.requiredParam("id")
        val po = db.one("purchase_orders", poCols) { eq("id", id); org(ctx) } ?: throw ErpException.notFound("Orden no encontrada.")
        val receipts = db.selectAll("purchase_receipts", "*, receiver:users!purchase_receipts_received_by_fkey(first_name, last_name), purchase_receipt_items(id, po_item_id, product_id, variant_id, quantity, unit_cost, products(name, sku), product_variants(name))", order = "received_at", asc = false) { eq("purchase_order_id", id) }
        call.respond(po.with("receipts" to receipts))
    }

    post("/purchases") {
        val ctx = call.require("purchases.create")
        val body = call.receiveOrThrow<JsonObject>()
        val items = body.arr("items")?.map { it.jsonObject } ?: emptyList()
        validate {
            notBlank(body.str("supplier_id"), "supplier_id", "El proveedor"); notBlank(body.str("warehouse_id"), "warehouse_id", "El almacén")
            require(items.isNotEmpty(), "items", "Agrega al menos un producto.")
            require(items.all { (it.int("quantity") ?: 0) > 0 && (it.dbl("unit_cost") ?: -1.0) >= 0 }, "items", "Cantidad y costo deben ser válidos.")
        }
        val po = db.rpcObject("create_purchase_order", jsonOf("p_org" to ctx.organizationId, "p_supplier" to body.str("supplier_id"), "p_warehouse" to body.str("warehouse_id"),
            "p_expected" to body.str("expected_date"), "p_notes" to body.str("notes"), "p_items" to JsonArray(items), "p_user" to ctx.userId))
        if (body.bool("send") == true) db.rpcObject("set_purchase_order_status", jsonOf("p_po" to po.str("id"), "p_status" to "SENT", "p_user" to ctx.userId))
        call.respond(HttpStatusCode.Created, db.one("purchase_orders", poCols) { eq("id", po.str("id")!!) }!!)
    }

    patch("/purchases/{id}") {
        val ctx = call.require("purchases.update")
        val id = call.requiredParam("id")
        val body = call.receiveOrThrow<JsonObject>()
        val po = db.one("purchase_orders", "id, status, supplier_id, warehouse_id") { eq("id", id); org(ctx) } ?: throw ErpException.notFound("Orden no encontrada.")
        val items = body.arr("items")?.map { it.jsonObject }
        if (items != null && items.any { (it.int("quantity") ?: 0) <= 0 }) throw ErpException.badRequest("Las cantidades deben ser mayores a 0.")
        db.rpcObject("update_purchase_order", jsonOf("p_po" to id, "p_supplier" to (body.str("supplier_id") ?: po.str("supplier_id")), "p_warehouse" to (body.str("warehouse_id") ?: po.str("warehouse_id")),
            "p_expected" to body.str("expected_date"), "p_notes" to body.str("notes"), "p_items" to (items?.let { JsonArray(it) } ?: run {
                db.selectAll("purchase_order_items", "product_id, variant_id, quantity, unit_cost") { eq("purchase_order_id", id) }.let { JsonArray(it) }
            }), "p_user" to ctx.userId))
        call.respond(db.one("purchase_orders", poCols) { eq("id", id) }!!)
    }

    post("/purchases/{id}/status") {
        val ctx = call.require("purchases.update", "purchases.cancel")
        val id = call.requiredParam("id")
        val body = call.receiveOrThrow<JsonObject>()
        val status = body.str("status")
        validate { oneOf(status, listOf("SENT", "COMPLETED", "CANCELLED"), "status", "El estado"); require(status != null, "status", "El estado es obligatorio.") }
        if (status == "CANCELLED" && !ctx.has("purchases.cancel")) throw ErpException.forbidden()
        db.rpcObject("set_purchase_order_status", jsonOf("p_po" to id, "p_status" to status, "p_user" to ctx.userId, "p_reason" to body.str("reason")))
        call.respond(db.one("purchase_orders", poCols) { eq("id", id) }!!)
    }

    post("/purchases/{id}/receive") {
        val ctx = call.require("purchases.receive")
        val id = call.requiredParam("id")
        val body = runCatching { call.receiveOrThrow<JsonObject>() }.getOrDefault(JsonObject(emptyMap()))
        val items = body.arr("items")
        if (items != null && items.any { (it.jsonObject.int("quantity") ?: 0) < 0 }) throw ErpException.badRequest("Las cantidades no pueden ser negativas.")
        val receipt = db.rpcObject("receive_purchase_order", jsonOf("p_po" to id, "p_user" to ctx.userId, "p_items" to items, "p_invoice" to body.str("invoice_number"), "p_notes" to body.str("notes")))
        call.respond(HttpStatusCode.Created, jsonOf("receipt" to receipt, "purchase_order" to db.one("purchase_orders", poCols) { eq("id", id) }))
    }

    get("/purchases/receipts") {
        val ctx = call.require("purchases.read")
        val q = PageQuery.from(call, "received_at")
        val (rows, total) = db.list("purchase_receipts", "*, purchase_orders(folio, supplier_id, suppliers(name)), warehouses(name), receiver:users!purchase_receipts_received_by_fkey(first_name, last_name), purchase_receipt_items(quantity, unit_cost)", q, {
            org(ctx); dateRange("received_at", call.request.queryParameters["from"], call.request.queryParameters["to"])
            if (q.q != null) or { ilike("folio", "%${q.q}%"); ilike("invoice_number", "%${q.q}%") }
        }, mapOf("received_at" to "received_at", "folio" to "folio"))
        call.respond(paged(rows.map { r ->
            val items = r.arr("purchase_receipt_items")?.map { it.jsonObject } ?: emptyList()
            r.with("units" to items.sumOf { it.int("quantity") ?: 0 }, "total" to items.sumOf { (it.int("quantity") ?: 0) * (it.dbl("unit_cost") ?: 0.0) }).without("purchase_receipt_items").stripCost(ctx)
        }, q, total))
    }

    /** Sugerencia de reorden: productos bajo mínimo agrupados por proveedor. */
    get("/purchases/suggestions") {
        val ctx = call.require("purchases.read")
        val rows = db.selectAll("products", "id, name, sku, stock, low_stock_threshold, max_stock, cost_price, supplier_id, suppliers(id, name)", order = "stock") { org(ctx); isNull("deleted_at"); eq("is_active", true) }
        val rotation = db.rpcObject("bi_inventory_rotation", jsonOf("p_org" to ctx.organizationId, "p_days" to 30, "p_dead_days" to 90)).arr("rows")?.associate { it.jsonObject.str("product_id") to it.jsonObject } ?: emptyMap()
        val needed = rows.mapNotNull { p ->
            val stock = p.int("stock") ?: 0; val min = p.int("low_stock_threshold") ?: 3; val max = p.int("max_stock") ?: (min * 4)
            val daily = rotation[p.str("id")]?.dbl("avg_daily_sales") ?: 0.0
            val coverDays = if (daily > 0) (stock / daily) else null
            if (stock > min && (coverDays == null || coverDays > 14)) null
            else p.with("suggested_qty" to maxOf(max - stock, 1), "days_of_stock" to coverDays?.let { Math.round(it) }, "avg_daily_sales" to daily, "supplier_name" to p.obj("suppliers")?.str("name")).without("suppliers").stripCost(ctx)
        }
        call.respond(jsonOf("by_supplier" to needed.groupBy { it.str("supplier_id") ?: "none" }.map { (sid, items) -> jsonOf("supplier_id" to sid.takeIf { it != "none" }, "supplier_name" to (items.first().str("supplier_name") ?: "Sin proveedor"), "items" to items) }, "total" to needed.size))
    }
}
