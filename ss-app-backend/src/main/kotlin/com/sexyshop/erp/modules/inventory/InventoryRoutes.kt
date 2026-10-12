package com.sexyshop.erp.modules.inventory

import com.sexyshop.erp.core.*
import io.ktor.http.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*

/**
 * Inventario: existencias (vista v_stock), movimientos, ajustes, transferencias y conteos.
 * Toda modificación de existencias pasa por funciones SQL que registran el movimiento.
 */
fun Route.inventoryRoutes(db: Db, audit: AuditService) {

    get("/inventory/stock") {
        val ctx = call.require("inventory.read", "products.read")
        val q = PageQuery.from(call, "product_name", defaultDesc = false)
        val p = call.request.queryParameters
        val (rows, total) = db.list("v_stock", "*", q, {
            org(ctx)
            eqOpt("warehouse_id", p["warehouse"]); eqOpt("category_id", p["category"]); eqOpt("stock_status", p["status"]); eqOpt("brand_id", p["brand"])
            if (p["active"] != "false") eq("is_active", true)
            if (q.q != null) or { ilike("product_name", "%${q.q}%"); ilike("effective_sku", "%${q.q}%"); eq("barcode", q.q) }
        }, mapOf("product_name" to "product_name", "quantity" to "quantity", "stock_value" to "stock_value", "updated_at" to "updated_at", "category_name" to "category_name", "warehouse_name" to "warehouse_name", "stock_status" to "stock_status"))
        call.respond(paged(rows.map { it.stripCost(ctx) }, q, total))
    }

    get("/inventory/summary") {
        val ctx = call.require("inventory.read", "products.read")
        val warehouse = call.request.queryParameters["warehouse"]
        val rows = db.selectAll("v_stock", "quantity, stock_value, stock_status, warehouse_id, warehouse_name") { org(ctx); eq("is_active", true); eqOpt("warehouse_id", warehouse) }
        val byStatus: Map<String, JsonObject> = rows.groupBy { it.str("stock_status") ?: "UNKNOWN" }.mapValues { (_, v) -> jsonOf("items" to v.size, "units" to v.sumOf { it.int("quantity") ?: 0 }, "value" to v.sumOf { it.dbl("stock_value") ?: 0.0 }) }
        val byWarehouse = rows.groupBy { it.str("warehouse_id") }.map { (id, v) -> jsonOf("warehouse_id" to id, "name" to v.first().str("warehouse_name"), "units" to v.sumOf { it.int("quantity") ?: 0 }, "value" to v.sumOf { it.dbl("stock_value") ?: 0.0 }, "items" to v.size) }
        val out = jsonOf("by_status" to byStatus, "by_warehouse" to byWarehouse, "units" to rows.sumOf { it.int("quantity") ?: 0 }, "value" to rows.sumOf { it.dbl("stock_value") ?: 0.0 }, "items" to rows.size)
        call.respond(if (ctx.has("products.cost.read")) out else out.without("value").with("by_status" to JsonObject(byStatus.mapValues { it.value.without("value") }), "by_warehouse" to byWarehouse.map { it.without("value") }))
    }

    get("/inventory/movements") {
        val ctx = call.require("inventory.read")
        val q = PageQuery.from(call, "created_at")
        val p = call.request.queryParameters
        val (rows, total) = db.list("inventory_movements", "*, products(name, sku), product_variants(name), warehouses(name), users(first_name, last_name)", q, {
            org(ctx)
            eqOpt("product_id", p["product"]); eqOpt("warehouse_id", p["warehouse"]); eqOpt("movement_type", p["type"]); eqOpt("reference_type", p["reference_type"]); eqOpt("reference_id", p["reference_id"]); eqOpt("user_id", p["user"])
            dateRange("created_at", p["from"], p["to"])
            if (q.q != null) or { ilike("reference", "%${q.q}%"); ilike("reason", "%${q.q}%") }
        }, mapOf("created_at" to "created_at", "quantity" to "quantity", "movement_type" to "movement_type", "reference" to "reference"))
        call.respond(paged(rows.map { shapeMovement(it).stripCost(ctx) }, q, total))
    }

    get("/inventory/alerts") {
        val ctx = call.require("inventory.read", "alerts.read")
        val warehouse = call.request.queryParameters["warehouse"]
        // Una fila por producto × almacén, igual que Existencias y el dashboard: lo agotado en una sucursal es accionable.
        val rows = db.selectAll("v_stock", "product_id, variant_id, product_name, variant_name, effective_sku, sku, quantity, min_stock, max_stock, unit_price, unit_cost, stock_value, stock_status, warehouse_id, warehouse_name, branch_id, category_id, category_name", order = "quantity") {
            org(ctx); eq("is_active", true); eqOpt("warehouse_id", warehouse); isIn("stock_status", listOf("OUT", "CRITICAL", "LOW", "EXCESS"))
        }
        val productIds = rows.mapNotNull { it.str("product_id") }.distinct()
        val suppliers = if (productIds.isEmpty()) emptyMap() else db.selectAll("products", "id, supplier_id, suppliers(name)") { org(ctx); isIn("id", productIds) }
            .associate { it.str("id")!! to (it.str("supplier_id") to it.obj("suppliers")?.str("name")) }
        val shaped = rows.map { r ->
            val stock = r.int("quantity") ?: 0; val min = r.int("min_stock") ?: 3; val max = r.int("max_stock"); val status = r.str("stock_status") ?: "HEALTHY"
            val sup = suppliers[r.str("product_id")]
            jsonOf(
                "id" to r.str("product_id"), "variant_id" to r.str("variant_id"), "name" to listOfNotNull(r.str("product_name"), r.str("variant_name")).joinToString(" · "),
                "sku" to (r.str("effective_sku") ?: r.str("sku")), "stock" to stock, "min_stock" to min, "max_stock" to max, "price" to r.dbl("unit_price"), "cost_price" to r.dbl("unit_cost"), "stock_value" to r.dbl("stock_value"),
                "stock_status" to status, "warehouse_id" to r.str("warehouse_id"), "warehouse_name" to r.str("warehouse_name"), "branch_id" to r.str("branch_id"),
                "category_id" to r.str("category_id"), "category_name" to r.str("category_name"), "supplier_id" to sup?.first, "supplier_name" to sup?.second,
                "suggested_order" to if (status in setOf("OUT", "CRITICAL", "LOW")) ((max ?: (min * 3)) - stock).coerceAtLeast(1) else 0,
            ).stripCost(ctx)
        }
        val rotation = db.rpcObject("bi_inventory_rotation", jsonOf("p_org" to ctx.organizationId, "p_days" to 90, "p_dead_days" to 90))
        val dead = rotation.arr("rows")?.map { it.jsonObject }?.filter { it.str("classification") in setOf("DEAD", "SLOW") }?.take(50)?.map { it.stripCost(ctx) } ?: emptyList()
        call.respond(jsonOf("stock" to shaped, "slow" to dead, "summary" to jsonOf(
            "out" to shaped.count { it.str("stock_status") == "OUT" }, "critical" to shaped.count { it.str("stock_status") == "CRITICAL" },
            "low" to shaped.count { it.str("stock_status") == "LOW" }, "excess" to shaped.count { it.str("stock_status") == "EXCESS" },
            "dead" to (rotation.obj("summary")?.int("dead_count") ?: 0), "slow" to (rotation.obj("summary")?.int("slow_count") ?: 0),
            "dead_value" to if (ctx.has("products.cost.read")) rotation.obj("summary")?.dbl("dead_value") else null,
        )))
    }

    // ---------------------------------------------------------------- Ajustes
    get("/inventory/adjustments") {
        val ctx = call.require("inventory.read")
        val q = PageQuery.from(call, "created_at")
        val (rows, total) = db.list("inventory_adjustments", "*, warehouses(name), creator:users!inventory_adjustments_created_by_fkey(first_name, last_name), inventory_adjustment_items(id, product_id, variant_id, quantity, unit_cost, products(name, sku), product_variants(name))", q, {
            org(ctx); eqOpt("warehouse_id", call.request.queryParameters["warehouse"]); eqOpt("adjustment_type", call.request.queryParameters["type"])
            if (q.q != null) or { ilike("reference", "%${q.q}%"); ilike("reason", "%${q.q}%") }
        }, mapOf("created_at" to "created_at", "reference" to "reference"))
        call.respond(paged(rows.map { it.stripCost(ctx) }, q, total))
    }
    post("/inventory/adjustments") {
        val ctx = call.require("inventory.adjust")
        val body = call.receiveOrThrow<JsonObject>()
        val type = body.str("adjustment_type") ?: body.str("type")
        val items = body.arr("items") ?: JsonArray(emptyList())
        validate {
            oneOf(type, listOf("ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGE", "LOSS", "INITIAL_STOCK"), "type", "El tipo de ajuste"); require(type != null, "type", "El tipo de ajuste es obligatorio.")
            notBlank(body.str("reason"), "reason", "El motivo"); require(items.isNotEmpty(), "items", "Agrega al menos un producto.")
            notBlank(body.str("warehouse_id"), "warehouse_id", "El almacén")
        }
        val wh = db.one("warehouses", "id, branch_id") { eq("id", body.str("warehouse_id")!!); org(ctx) } ?: throw ErpException.notFound("Almacén no encontrado.")
        if (!ctx.canAccessBranch(wh.str("branch_id")!!)) throw ErpException.forbidden("No tienes acceso a ese almacén.")
        val res = db.rpcObject("apply_inventory_adjustment", jsonOf("p_org" to ctx.organizationId, "p_warehouse" to wh.str("id"), "p_type" to type, "p_reason" to body.str("reason"), "p_notes" to body.str("notes"), "p_items" to items, "p_user" to ctx.userId))
        call.respond(HttpStatusCode.Created, res)
    }

    // ---------------------------------------------------------------- Transferencias
    val transferCols = "*, from_warehouse:warehouses!inventory_transfers_from_warehouse_id_fkey(id, name, branch_id), to_warehouse:warehouses!inventory_transfers_to_warehouse_id_fkey(id, name, branch_id), inventory_transfer_items(id, product_id, variant_id, quantity, received_quantity, products(name, sku), product_variants(name))"
    get("/inventory/transfers") {
        val ctx = call.require("inventory.read")
        val q = PageQuery.from(call, "created_at")
        val (rows, total) = db.list("inventory_transfers", transferCols, q, {
            org(ctx); eqOpt("status", call.request.queryParameters["status"])
            if (q.q != null) ilike("reference", "%${q.q}%")
        }, mapOf("created_at" to "created_at", "status" to "status", "reference" to "reference"))
        call.respond(paged(rows, q, total))
    }
    get("/inventory/transfers/{id}") {
        val ctx = call.require("inventory.read")
        call.respond(db.one("inventory_transfers", transferCols) { eq("id", call.requiredParam("id")); org(ctx) } ?: throw ErpException.notFound())
    }
    post("/inventory/transfers") {
        val ctx = call.require("inventory.transfer")
        val body = call.receiveOrThrow<JsonObject>()
        val items = body.arr("items")?.map { it.jsonObject } ?: emptyList()
        validate {
            notBlank(body.str("from_warehouse_id"), "from_warehouse_id", "El almacén origen"); notBlank(body.str("to_warehouse_id"), "to_warehouse_id", "El almacén destino")
            require(body.str("from_warehouse_id") != body.str("to_warehouse_id"), "to_warehouse_id", "Origen y destino deben ser distintos.")
            require(items.isNotEmpty(), "items", "Agrega al menos un producto."); require(items.all { (it.int("quantity") ?: 0) > 0 }, "items", "Las cantidades deben ser mayores a 0.")
        }
        val folio = db.rpc("next_folio", jsonOf("p_org" to ctx.organizationId, "p_doc_type" to "TRF", "p_prefix" to "TRF")).jsonPrimitive.content
        val t = db.insert("inventory_transfers", jsonOf("organization_id" to ctx.organizationId, "reference" to folio, "from_warehouse_id" to body.str("from_warehouse_id"), "to_warehouse_id" to body.str("to_warehouse_id"), "notes" to body.str("notes"), "created_by" to ctx.userId))
        db.insertMany("inventory_transfer_items", items.map { jsonOf("transfer_id" to t.str("id"), "product_id" to it.str("product_id"), "variant_id" to it.str("variant_id"), "quantity" to it.int("quantity")) })
        audit.log(call, "inventory.transfer.create", "TRANSFER", t.str("id"), null, t.with("items" to items))
        val created = db.one("inventory_transfers", transferCols) { eq("id", t.str("id")!!) }!!
        if (body.bool("send") == true) {
            call.respond(HttpStatusCode.Created, db.rpcObject("send_transfer", jsonOf("p_transfer" to t.str("id"), "p_user" to ctx.userId)))
        } else call.respond(HttpStatusCode.Created, created)
    }
    patch("/inventory/transfers/{id}") {
        val ctx = call.require("inventory.transfer")
        val id = call.requiredParam("id")
        val t = db.one("inventory_transfers") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        if (t.str("status") != "DRAFT") throw ErpException.conflict("Solo se editan transferencias en borrador.")
        val body = call.receiveOrThrow<JsonObject>()
        body.arr("items")?.let { arr ->
            val items = arr.map { it.jsonObject }
            if (items.any { (it.int("quantity") ?: 0) <= 0 }) throw ErpException.badRequest("Las cantidades deben ser mayores a 0.")
            db.delete("inventory_transfer_items") { eq("transfer_id", id) }
            db.insertMany("inventory_transfer_items", items.map { jsonOf("transfer_id" to id, "product_id" to it.str("product_id"), "variant_id" to it.str("variant_id"), "quantity" to it.int("quantity")) })
        }
        val after = db.update("inventory_transfers", id, pick(body, listOf("notes", "to_warehouse_id", "from_warehouse_id")))
        audit.log(call, "inventory.transfer.update", "TRANSFER", id, t, after)
        call.respond(db.one("inventory_transfers", transferCols) { eq("id", id) }!!)
    }
    post("/inventory/transfers/{id}/send") {
        val ctx = call.require("inventory.transfer")
        call.respond(db.rpcObject("send_transfer", jsonOf("p_transfer" to call.requiredParam("id"), "p_user" to ctx.userId)))
    }
    post("/inventory/transfers/{id}/receive") {
        val ctx = call.require("inventory.transfer")
        val body = runCatching { call.receiveOrThrow<JsonObject>() }.getOrDefault(JsonObject(emptyMap()))
        call.respond(db.rpcObject("receive_transfer", jsonOf("p_transfer" to call.requiredParam("id"), "p_user" to ctx.userId, "p_items" to body["items"])))
    }
    post("/inventory/transfers/{id}/cancel") {
        val ctx = call.require("inventory.transfer")
        val body = runCatching { call.receiveOrThrow<JsonObject>() }.getOrDefault(JsonObject(emptyMap()))
        call.respond(db.rpcObject("cancel_transfer", jsonOf("p_transfer" to call.requiredParam("id"), "p_user" to ctx.userId, "p_reason" to body.str("reason"))))
    }

    // ---------------------------------------------------------------- Conteos
    val countCols = "*, warehouses(name), creator:users!inventory_counts_created_by_fkey(first_name, last_name)"
    get("/inventory/counts") {
        val ctx = call.require("inventory.read")
        val q = PageQuery.from(call, "created_at")
        val (rows, total) = db.list("inventory_counts", countCols, q, { org(ctx); eqOpt("status", call.request.queryParameters["status"]) }, mapOf("created_at" to "created_at", "status" to "status"))
        call.respond(paged(rows, q, total))
    }
    post("/inventory/counts") {
        val ctx = call.require("inventory.count")
        val body = call.receiveOrThrow<JsonObject>()
        validate { notBlank(body.str("warehouse_id"), "warehouse_id", "El almacén") }
        val c = db.rpcObject("start_inventory_count", jsonOf("p_org" to ctx.organizationId, "p_warehouse" to body.str("warehouse_id"), "p_user" to ctx.userId, "p_notes" to body.str("notes"), "p_category" to body.str("category_id")))
        audit.log(call, "inventory.count.start", "COUNT", c.str("id"), null, c)
        call.respond(HttpStatusCode.Created, c)
    }
    get("/inventory/counts/{id}") {
        val ctx = call.require("inventory.read")
        val id = call.requiredParam("id")
        val c = db.one("inventory_counts", countCols) { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        val items = db.selectAll("inventory_count_items", "*, products(name, sku, barcode), product_variants(name)") { eq("count_id", id) }
            .sortedBy { it.obj("products")?.str("name") }
        call.respond(c.with("items" to items, "progress" to jsonOf("total" to items.size, "counted" to items.count { it.int("counted_qty") != null }, "differences" to items.count { it.int("counted_qty") != null && it.int("counted_qty") != it.int("expected_qty") })))
    }
    patch("/inventory/counts/{id}/items") {
        val ctx = call.require("inventory.count")
        val id = call.requiredParam("id")
        val c = db.one("inventory_counts") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        if (c.str("status") != "OPEN") throw ErpException.conflict("El conteo ya fue cerrado.")
        val items = call.receiveOrThrow<JsonObject>().arr("items")?.map { it.jsonObject } ?: emptyList()
        for (it in items) {
            val qty = it.int("counted_qty")
            if (qty != null && qty < 0) throw ErpException.badRequest("Las cantidades contadas no pueden ser negativas.")
            db.update("inventory_count_items", it.str("id")!!, jsonOf("counted_qty" to qty))
        }
        call.respond(jsonOf("updated" to items.size))
    }
    post("/inventory/counts/{id}/finalize") {
        val ctx = call.require("inventory.count")
        call.respond(db.rpcObject("finalize_inventory_count", jsonOf("p_count" to call.requiredParam("id"), "p_user" to ctx.userId)))
    }
    post("/inventory/counts/{id}/cancel") {
        val ctx = call.require("inventory.count")
        val id = call.requiredParam("id")
        val c = db.one("inventory_counts") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        if (c.str("status") != "OPEN") throw ErpException.conflict("El conteo ya fue cerrado.")
        val after = db.update("inventory_counts", id, jsonOf("status" to "CANCELLED"))
        audit.log(call, "inventory.count.cancel", "COUNT", id, c, after)
        call.respond(after)
    }
}

fun shapeMovement(m: JsonObject): JsonObject = m.with(
    "product_name" to m.obj("products")?.str("name"), "sku" to m.obj("products")?.str("sku"),
    "variant_name" to m.obj("product_variants")?.str("name"), "warehouse_name" to m.obj("warehouses")?.str("name"),
    "user_name" to m.obj("users")?.let { listOfNotNull(it.str("first_name"), it.str("last_name")).joinToString(" ") },
).without("products", "product_variants", "warehouses", "users")
