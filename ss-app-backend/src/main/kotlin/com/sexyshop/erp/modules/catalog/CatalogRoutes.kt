package com.sexyshop.erp.modules.catalog

import com.sexyshop.erp.core.*
import io.ktor.http.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*

/**
 * Catálogo: productos (+ variantes), categorías jerárquicas, marcas y proveedores.
 * El costo solo viaja a quien tiene `products.cost.read`.
 */
class CatalogService(private val db: Db) {
    companion object {
        val PRODUCT_FIELDS = listOf("name", "short_name", "slug", "description", "price", "old_price", "cost_price", "category_id", "brand_id", "supplier_id",
            "tax_rate_id", "sku", "barcode", "unit", "low_stock_threshold", "max_stock", "status", "badge", "weight", "length", "width", "height", "display_order")
        val VARIANT_FIELDS = listOf("sku", "barcode", "name", "attributes", "price", "cost_price", "image_url", "is_active", "display_order")
        val CATEGORY_FIELDS = listOf("name", "slug", "icon", "parent_id", "description", "display_order", "is_active")
        val BRAND_FIELDS = listOf("name", "slug", "logo_url", "description", "website", "is_active")
        val SUPPLIER_FIELDS = listOf("code", "name", "rfc", "contact_name", "phone", "email", "website", "street", "neighborhood", "zip", "city", "state", "country", "payment_terms", "lead_time_days", "status", "notes")
        const val PRODUCT_COLUMNS = "*, categories(id, name, icon, parent_id), brands(id, name), suppliers(id, name), tax_rates(id, code, rate), product_images(id, image_url, is_primary, display_order)"
    }

    fun shapeProduct(p: JsonObject, auth: AuthContext): JsonObject {
        val images = p.arr("product_images")?.map { it.jsonObject }?.sortedWith(compareByDescending<JsonObject> { it.bool("is_primary") == true }.thenBy { it.int("display_order") ?: 0 }) ?: emptyList()
        val price = p.dbl("price") ?: 0.0; val cost = p.dbl("cost_price") ?: 0.0
        val stock = p.int("stock") ?: 0; val min = p.int("low_stock_threshold") ?: 3; val max = p.int("max_stock")
        val status = when {
            stock <= 0 -> "OUT"; stock <= Math.ceil(min * 0.5) -> "CRITICAL"; stock <= min -> "LOW"; max != null && stock > max -> "EXCESS"; else -> "HEALTHY"
        }
        return p.with(
            "category" to p.obj("categories"), "brand" to p.obj("brands"), "supplier" to p.obj("suppliers"), "tax_rate" to p.obj("tax_rates"),
            "image_url" to images.firstOrNull()?.str("image_url"), "images" to images,
            "margin" to if (price > 0) Math.round((price - cost) / price * 1000) / 10.0 else null,
            "stock_status" to status, "min_stock" to min,
        ).without("categories", "brands", "suppliers", "tax_rates", "product_images").stripCost(auth)
    }

    /** Agrega warehouse_stock (existencia en un almacén, todas las variantes) a una lista de productos. */
    suspend fun withWarehouseStock(list: List<JsonObject>, warehouseId: String?): List<JsonObject> {
        if (warehouseId.isNullOrBlank() || list.isEmpty()) return list
        val ids = list.mapNotNull { it.str("id") }
        val byProduct = db.selectAll("inventory_levels", "product_id, quantity") { eq("warehouse_id", warehouseId); isIn("product_id", ids) }
            .groupBy { it.str("product_id") }.mapValues { (_, v) -> v.sumOf { it.int("quantity") ?: 0 } }
        return list.map { it.with("warehouse_stock" to (byProduct[it.str("id")] ?: 0)) }
    }

    suspend fun product(auth: AuthContext, id: String): JsonObject {
        val p = db.one("products", PRODUCT_COLUMNS) { eq("id", id); org(auth); isNull("deleted_at") } ?: throw ErpException.notFound("Producto no encontrado.")
        val variants = db.selectAll("product_variants", order = "display_order") { eq("product_id", id); isNull("deleted_at") }
        val levels = db.selectAll("inventory_levels", "warehouse_id, variant_id, quantity, warehouses(name)") { eq("product_id", id) }
        return shapeProduct(p, auth).with(
            "variants" to variants.map { it.stripCost(auth) },
            "stock_by_warehouse" to levels.map { l -> l.with("warehouse_name" to l.obj("warehouses")?.str("name")).without("warehouses") },
        )
    }

    fun validateProduct(body: JsonObject, creating: Boolean) = validate {
        if (creating) { notBlank(body.str("name"), "name", "El nombre"); positive(body.dbl("price"), "price", "El precio"); notBlank(body.str("category_id"), "category_id", "La categoría") }
        if (!creating && body.containsKey("name")) notBlank(body.str("name"), "name", "El nombre")
        if (!creating && body.containsKey("price")) positive(body.dbl("price"), "price", "El precio")
        nonNegative(body.dbl("price"), "price", "El precio"); nonNegative(body.dbl("cost_price"), "cost_price", "El costo"); nonNegative(body.dbl("old_price"), "old_price", "El precio anterior")
        maxLen(body.str("name"), 160, "name", "El nombre"); maxLen(body.str("sku"), 40, "sku", "El SKU"); maxLen(body.str("barcode"), 40, "barcode", "El código de barras")
        oneOf(body.str("status"), listOf("ACTIVE", "INACTIVE", "DISCONTINUED", "DRAFT"), "status", "El estado")
        require((body.int("low_stock_threshold") ?: 0) >= 0, "low_stock_threshold", "El stock mínimo no puede ser negativo.")
        require(body.int("max_stock") == null || body.int("max_stock")!! >= (body.int("low_stock_threshold") ?: 0), "max_stock", "El stock máximo debe ser mayor o igual al mínimo.")
    }
}

fun Route.catalogRoutes(db: Db, service: CatalogService, audit: AuditService) {

    // ---------------------------------------------------------------- Productos
    get("/products") {
        val ctx = call.require("products.read")
        val q = PageQuery.from(call, "name", defaultDesc = false)
        val p = call.request.queryParameters
        val stockStatus = p["stock_status"]
        val (rows, total) = db.list("products", CatalogService.PRODUCT_COLUMNS, q, {
            org(ctx); isNull("deleted_at")
            eqOpt("category_id", p["category"]); eqOpt("brand_id", p["brand"]); eqOpt("supplier_id", p["supplier"]); eqOpt("status", p["status"])
            if (p["active"] == "true") eq("is_active", true)
            if (q.q != null) {
                val nq = java.text.Normalizer.normalize(q.q, java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}"), "").lowercase().trim()
                or { ilike("search_text", "%${nq.replace("%", "").replace(",", " ")}%"); eq("barcode", q.q); ilike("sku", q.q) }
            }
            when (stockStatus) { "OUT" -> lte("stock", 0); "LOW" -> { gt("stock", 0); lte("stock", 5) }; "HEALTHY" -> gt("stock", 5); null, "" -> {} }
        }, mapOf("name" to "name", "price" to "price", "stock" to "stock", "sku" to "sku", "created_at" to "created_at", "updated_at" to "updated_at", "cost_price" to "cost_price", "status" to "status"))
        val shaped = rows.map { service.shapeProduct(it, ctx) }.let { list ->
            // el filtro de semáforo exacto se aplica tras calcular con el mínimo por producto
            if (stockStatus in setOf("LOW", "CRITICAL", "EXCESS")) list.filter { it.str("stock_status") == stockStatus } else list
        }
        call.respond(paged(service.withWarehouseStock(shaped, p["warehouse"]), q, total))
    }

    /** Búsqueda rápida para POS: código de barras o SKU exacto, luego nombre. */
    get("/products/lookup") {
        val ctx = call.require("products.read")
        val code = call.request.queryParameters["code"]?.trim() ?: throw ErpException.badRequest("Falta el código.")
        val wh = call.request.queryParameters["warehouse"]
        val byVariant = db.one("product_variants", "*, products(${CatalogService.PRODUCT_COLUMNS})") { isNull("deleted_at"); eq("is_active", true); or { eq("barcode", code); ilike("sku", code) } }
        if (byVariant != null && byVariant.obj("products")?.str("organization_id") == ctx.organizationId) {
            val prod = service.withWarehouseStock(listOf(service.shapeProduct(byVariant.obj("products")!!, ctx)), wh).first()
            call.respond(jsonOf("match" to "variant", "product" to prod, "variant" to byVariant.without("products").stripCost(ctx)))
            return@get
        }
        val product = db.one("products", CatalogService.PRODUCT_COLUMNS) { org(ctx); isNull("deleted_at"); or { eq("barcode", code); ilike("sku", code) } }
        if (product != null) {
            val variants = if (product.bool("has_variants") == true) db.selectAll("product_variants", order = "display_order") { eq("product_id", product.str("id")!!); isNull("deleted_at"); eq("is_active", true) } else emptyList()
            call.respond(jsonOf("match" to "product", "product" to service.withWarehouseStock(listOf(service.shapeProduct(product, ctx)), wh).first(), "variants" to variants.map { it.stripCost(ctx) }))
            return@get
        }
        val res = db.rpcObject("global_search", jsonOf("p_org" to ctx.organizationId, "p_q" to code, "p_limit" to 8))
        call.respond(jsonOf("match" to "search", "products" to res["products"]))
    }

    get("/products/{id}") { call.respond(service.product(call.require("products.read"), call.requiredParam("id"))) }

    get("/products/{id}/quick") {
        val ctx = call.require("products.read")
        val id = call.requiredParam("id")
        val product = service.product(ctx, id)
        val history = db.rpcObject("bi_product_history", jsonOf("p_product" to id, "p_weeks" to 12, "p_tz" to ctx.timezone))
        call.respond(jsonOf("product" to product, "history" to history.stripCost(ctx)))
    }

    post("/products") {
        val ctx = call.require("products.create")
        val body = pick(call.receiveOrThrow<JsonObject>(), CatalogService.PRODUCT_FIELDS)
        service.validateProduct(body, creating = true)
        val slug = body.str("slug")?.let(::slugify) ?: slugify(body.str("name")!!)
        val finalSlug = if (db.count("products") { eq("slug", slug) } > 0) "$slug-${System.currentTimeMillis() % 100000}" else slug
        val row = db.insert("products", body.with("organization_id" to ctx.organizationId, "slug" to finalSlug, "created_by" to ctx.userId, "updated_by" to ctx.userId, "stock" to 0,
            "sku" to (body.str("sku") ?: nextSku(db, ctx)), "status" to (body.str("status") ?: "ACTIVE")))
        audit.log(call, "products.create", "PRODUCT", row.str("id"), null, row)
        call.respond(HttpStatusCode.Created, service.product(ctx, row.str("id")!!))
    }

    patch("/products/{id}") {
        val ctx = call.require("products.update")
        val id = call.requiredParam("id")
        val before = db.one("products") { eq("id", id); org(ctx); isNull("deleted_at") } ?: throw ErpException.notFound("Producto no encontrado.")
        var body = pick(call.receiveOrThrow<JsonObject>(), CatalogService.PRODUCT_FIELDS)
        if (!ctx.has("products.cost.read")) body = body.without("cost_price")
        service.validateProduct(body, creating = false)
        if (body.str("slug") != null) body = body.with("slug" to slugify(body.str("slug")!!))
        val after = db.update("products", id, body.with("updated_by" to ctx.userId))
        val priceChanged = body.containsKey("price") && body.dbl("price") != before.dbl("price")
        val costChanged = body.containsKey("cost_price") && body.dbl("cost_price") != before.dbl("cost_price")
        audit.log(call, if (priceChanged || costChanged) "products.price.update" else "products.update", "PRODUCT", id, before, after,
            jsonOf("price_changed" to priceChanged, "cost_changed" to costChanged))
        call.respond(service.product(ctx, id))
    }

    delete("/products/{id}") {
        val ctx = call.require("products.delete")
        val id = call.requiredParam("id")
        val before = db.one("products") { eq("id", id); org(ctx); isNull("deleted_at") } ?: throw ErpException.notFound("Producto no encontrado.")
        val hasSales = db.count("sale_items") { eq("product_id", id) } > 0 || db.count("order_items") { eq("product_id", id) } > 0
        val hasStock = (before.int("stock") ?: 0) > 0
        val hasHistory = db.count("inventory_movements") { eq("product_id", id) } > 0 || db.count("purchase_order_items") { eq("product_id", id) } > 0
        if (hasSales || hasStock || hasHistory) {
            // Soft delete: conserva historial. Se desactiva y se oculta.
            db.update("products", id, jsonOf("deleted_at" to nowIso(), "deleted_by" to ctx.userId, "status" to "INACTIVE", "is_active" to false))
            audit.log(call, "products.delete", "PRODUCT", id, before, null, jsonOf("soft" to true, "reason" to if (hasSales) "has_sales" else if (hasStock) "has_stock" else "has_history"))
            val why = when { hasSales -> "tiene ventas"; hasStock -> "aún tiene existencia"; else -> "tiene movimientos de inventario o compras" }
            call.respond(jsonOf("deleted" to true, "soft" to true, "message" to "“${before.str("name")}” $why, así que se desactivó y se ocultó para conservar el historial."))
        } else {
            db.delete("product_variants") { eq("product_id", id) }
            db.delete("inventory_levels") { eq("product_id", id) }
            db.delete("products") { eq("id", id) }
            audit.log(call, "products.delete", "PRODUCT", id, before, null, jsonOf("soft" to false))
            call.respond(jsonOf("deleted" to true, "soft" to false, "message" to "“${before.str("name")}” se eliminó definitivamente."))
        }
    }

    // Variantes
    post("/products/{id}/variants") {
        val ctx = call.require("products.update")
        val productId = call.requiredParam("id")
        db.one("products", "id") { eq("id", productId); org(ctx) } ?: throw ErpException.notFound("Producto no encontrado.")
        val body = pick(call.receiveOrThrow<JsonObject>(), CatalogService.VARIANT_FIELDS)
        validate { notBlank(body.str("name"), "name", "El nombre de la variante"); nonNegative(body.dbl("price"), "price", "El precio") }
        val row = db.insert("product_variants", body.with("product_id" to productId))
        audit.log(call, "products.variant.create", "PRODUCT", productId, null, row)
        call.respond(HttpStatusCode.Created, row.stripCost(ctx))
    }
    patch("/variants/{id}") {
        val ctx = call.require("products.update")
        val id = call.requiredParam("id")
        val before = db.byId("product_variants", id)
        var body = pick(call.receiveOrThrow<JsonObject>(), CatalogService.VARIANT_FIELDS)
        validate { if (body.containsKey("name")) notBlank(body.str("name"), "name", "El nombre de la variante"); nonNegative(body.dbl("price"), "price", "El precio") }
        if (!ctx.has("products.cost.read")) body = body.without("cost_price")
        val after = db.update("product_variants", id, body)
        audit.log(call, "products.variant.update", "PRODUCT", before.str("product_id"), before, after)
        call.respond(after.stripCost(ctx))
    }
    delete("/variants/{id}") {
        val ctx = call.require("products.update")
        val id = call.requiredParam("id")
        val before = db.byId("product_variants", id)
        val used = db.count("sale_items") { eq("variant_id", id) } > 0 || (db.one("inventory_levels", "quantity") { eq("variant_id", id); gt("quantity", 0) } != null)
        if (used) db.update("product_variants", id, jsonOf("deleted_at" to nowIso(), "is_active" to false)) else db.delete("product_variants") { eq("id", id) }
        audit.log(call, "products.variant.delete", "PRODUCT", before.str("product_id"), before, null)
        call.respond(HttpStatusCode.NoContent)
    }

    // ---------------------------------------------------------------- Categorías
    get("/categories") {
        val ctx = call.require("products.read")
        val rows = db.selectAll("categories", "*", order = "display_order") { org(ctx); isNull("deleted_at") }
        val counts = db.selectAll("products", "category_id") { org(ctx); isNull("deleted_at") }.groupingBy { it.str("category_id") }.eachCount()
        val withCounts = rows.map { it.with("product_count" to (counts[it.str("id")] ?: 0)) }
        val byParent = withCounts.groupBy { it.str("parent_id") }
        fun tree(parent: String?): List<JsonObject> = (byParent[parent] ?: emptyList()).map { c -> c.with("children" to tree(c.str("id"))) }
        call.respond(jsonOf("tree" to tree(null), "flat" to withCounts))
    }
    post("/categories") {
        val ctx = call.require("categories.manage")
        val body = pick(call.receiveOrThrow<JsonObject>(), CatalogService.CATEGORY_FIELDS)
        validate { notBlank(body.str("name"), "name", "El nombre") }
        val slug = body.str("slug")?.let(::slugify) ?: slugify(body.str("name")!!)
        val row = db.insert("categories", body.with("organization_id" to ctx.organizationId, "slug" to slug, "icon" to (body.str("icon") ?: "")))
        audit.log(call, "categories.create", "CATEGORY", row.str("id"), null, row)
        call.respond(HttpStatusCode.Created, row)
    }
    patch("/categories/{id}") {
        val ctx = call.require("categories.manage")
        val id = call.requiredParam("id")
        val before = db.one("categories") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        val body = pick(call.receiveOrThrow<JsonObject>(), CatalogService.CATEGORY_FIELDS)
        if (body.str("parent_id") == id) throw ErpException.badRequest("Una categoría no puede ser su propia categoría padre.")
        val after = db.update("categories", id, body)
        audit.log(call, "categories.update", "CATEGORY", id, before, after)
        call.respond(after)
    }
    delete("/categories/{id}") {
        val ctx = call.require("categories.manage")
        val id = call.requiredParam("id")
        val before = db.one("categories") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        if (db.count("products") { eq("category_id", id); isNull("deleted_at") } > 0) throw ErpException.conflict("La categoría tiene productos. Muévelos o desactívala.")
        if (db.count("categories") { eq("parent_id", id); isNull("deleted_at") } > 0) throw ErpException.conflict("La categoría tiene subcategorías.")
        db.update("categories", id, jsonOf("deleted_at" to nowIso(), "deleted_by" to ctx.userId, "is_active" to false))
        audit.log(call, "categories.delete", "CATEGORY", id, before, null)
        call.respond(HttpStatusCode.NoContent)
    }

    // ---------------------------------------------------------------- Marcas
    get("/brands") {
        val ctx = call.require("products.read")
        val rows = db.selectAll("brands", order = "name") { org(ctx); isNull("deleted_at") }
        val counts = db.selectAll("products", "brand_id") { org(ctx); isNull("deleted_at"); notNull("brand_id") }.groupingBy { it.str("brand_id") }.eachCount()
        call.respond(JsonArray(rows.map { it.with("product_count" to (counts[it.str("id")] ?: 0)) }))
    }
    post("/brands") {
        val ctx = call.require("brands.manage")
        val body = pick(call.receiveOrThrow<JsonObject>(), CatalogService.BRAND_FIELDS)
        validate { notBlank(body.str("name"), "name", "El nombre") }
        val row = db.insert("brands", body.with("organization_id" to ctx.organizationId, "slug" to (body.str("slug") ?: slugify(body.str("name")!!))))
        audit.log(call, "brands.create", "BRAND", row.str("id"), null, row)
        call.respond(HttpStatusCode.Created, row)
    }
    patch("/brands/{id}") {
        val ctx = call.require("brands.manage")
        val id = call.requiredParam("id")
        val before = db.one("brands") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        val after = db.update("brands", id, pick(call.receiveOrThrow<JsonObject>(), CatalogService.BRAND_FIELDS))
        audit.log(call, "brands.update", "BRAND", id, before, after)
        call.respond(after)
    }
    delete("/brands/{id}") {
        val ctx = call.require("brands.manage")
        val id = call.requiredParam("id")
        val before = db.one("brands") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        db.update("brands", id, jsonOf("deleted_at" to nowIso(), "deleted_by" to ctx.userId, "is_active" to false))
        audit.log(call, "brands.delete", "BRAND", id, before, null)
        call.respond(HttpStatusCode.NoContent)
    }

    // ---------------------------------------------------------------- Proveedores
    get("/suppliers") {
        val ctx = call.require("products.read", "suppliers.manage", "purchases.read")
        val q = PageQuery.from(call, "name", defaultDesc = false)
        val (rows, total) = db.list("suppliers", "*", q, {
            org(ctx); isNull("deleted_at"); eqOpt("status", call.request.queryParameters["status"])
            if (q.q != null) or { ilike("name", "%${q.q}%"); ilike("contact_name", "%${q.q}%"); ilike("email", "%${q.q}%"); ilike("code", "%${q.q}%") }
        }, mapOf("name" to "name", "created_at" to "created_at", "status" to "status", "city" to "city"))
        call.respond(paged(rows, q, total))
    }
    get("/suppliers/{id}") {
        val ctx = call.require("products.read", "suppliers.manage", "purchases.read")
        val id = call.requiredParam("id")
        val s = db.one("suppliers") { eq("id", id); org(ctx); isNull("deleted_at") } ?: throw ErpException.notFound("Proveedor no encontrado.")
        val products = db.selectAll("products", "id, name, sku, price, cost_price, stock", order = "name") { eq("supplier_id", id); isNull("deleted_at") }
        val orders = db.selectAll("purchase_orders", "id, folio, status, total, created_at, expected_date", order = "created_at", asc = false, limit = 20) { eq("supplier_id", id) }
        call.respond(s.with("products" to products.map { it.stripCost(ctx) }, "purchase_orders" to orders))
    }
    post("/suppliers") {
        val ctx = call.require("suppliers.manage")
        val body = pick(call.receiveOrThrow<JsonObject>(), CatalogService.SUPPLIER_FIELDS)
        validate { notBlank(body.str("name"), "name", "El nombre"); email(body.str("email")) }
        val row = db.insert("suppliers", body.with("organization_id" to ctx.organizationId))
        audit.log(call, "suppliers.create", "SUPPLIER", row.str("id"), null, row)
        call.respond(HttpStatusCode.Created, row)
    }
    patch("/suppliers/{id}") {
        val ctx = call.require("suppliers.manage")
        val id = call.requiredParam("id")
        val before = db.one("suppliers") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        val body = pick(call.receiveOrThrow<JsonObject>(), CatalogService.SUPPLIER_FIELDS)
        validate { email(body.str("email")); oneOf(body.str("status"), listOf("ACTIVE", "INACTIVE"), "status", "El estado") }
        val after = db.update("suppliers", id, body)
        audit.log(call, "suppliers.update", "SUPPLIER", id, before, after)
        call.respond(after)
    }
    delete("/suppliers/{id}") {
        val ctx = call.require("suppliers.manage")
        val id = call.requiredParam("id")
        val before = db.one("suppliers") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        db.update("suppliers", id, jsonOf("deleted_at" to nowIso(), "deleted_by" to ctx.userId, "status" to "INACTIVE"))
        audit.log(call, "suppliers.delete", "SUPPLIER", id, before, null)
        call.respond(HttpStatusCode.NoContent)
    }
}

private suspend fun nextSku(db: Db, ctx: AuthContext): String {
    val n = db.count("products") { org(ctx) } + 1
    return "SNR-" + n.toString().padStart(5, '0')
}
