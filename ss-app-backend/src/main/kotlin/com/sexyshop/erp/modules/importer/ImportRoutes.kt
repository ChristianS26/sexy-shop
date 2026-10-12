package com.sexyshop.erp.modules.importer

import com.sexyshop.erp.core.*
import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.utils.io.*
import kotlinx.serialization.json.*
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream

/**
 * Importación masiva (productos, clientes, proveedores, inventario inicial) desde CSV o XLSX.
 * Flujo: preview (valida y reporta errores por fila) -> commit (solo filas válidas).
 */
object TabularParser {
    fun parse(bytes: ByteArray, filename: String?): List<Map<String, String>> =
        if (filename?.lowercase()?.endsWith(".xlsx") == true || bytes.size > 4 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte()) parseXlsx(bytes) else parseCsv(String(bytes, Charsets.UTF_8))

    fun parseCsv(text: String): List<Map<String, String>> {
        val rows = mutableListOf<List<String>>()
        val cur = StringBuilder(); var inQuotes = false; var row = mutableListOf<String>()
        val t = text.removePrefix("﻿")
        val sep = if (t.lineSequence().firstOrNull()?.count { it == ';' } ?: 0 > (t.lineSequence().firstOrNull()?.count { it == ',' } ?: 0)) ';' else ','
        var i = 0
        while (i < t.length) {
            val c = t[i]
            when {
                inQuotes && c == '"' && i + 1 < t.length && t[i + 1] == '"' -> { cur.append('"'); i++ }
                c == '"' -> inQuotes = !inQuotes
                !inQuotes && c == sep -> { row.add(cur.toString()); cur.clear() }
                !inQuotes && (c == '\n' || c == '\r') -> { if (c == '\r' && i + 1 < t.length && t[i + 1] == '\n') i++; row.add(cur.toString()); cur.clear(); if (row.any { it.isNotBlank() }) rows.add(row); row = mutableListOf() }
                else -> cur.append(c)
            }
            i++
        }
        if (cur.isNotEmpty() || row.isNotEmpty()) { row.add(cur.toString()); if (row.any { it.isNotBlank() }) rows.add(row) }
        if (rows.isEmpty()) return emptyList()
        val headers = rows.first().map { normalizeHeader(it) }
        return rows.drop(1).map { r -> headers.indices.associate { headers[it] to (r.getOrNull(it)?.trim() ?: "") } }
    }

    /** Lector mínimo de XLSX: primera hoja, sharedStrings e inlineStr. */
    fun parseXlsx(bytes: ByteArray): List<Map<String, String>> {
        var shared = listOf<String>(); var sheet: String? = null
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            var e = zip.nextEntry
            while (e != null) {
                val content = zip.readBytes().toString(Charsets.UTF_8)
                if (e.name == "xl/sharedStrings.xml") shared = Regex("<si>(.*?)</si>", RegexOption.DOT_MATCHES_ALL).findAll(content).map { m -> Regex("<t[^>]*>(.*?)</t>", RegexOption.DOT_MATCHES_ALL).findAll(m.groupValues[1]).joinToString("") { unxml(it.groupValues[1]) } }.toList()
                if (e.name == "xl/worksheets/sheet1.xml") sheet = content
                e = zip.nextEntry
            }
        }
        val xml = sheet ?: return emptyList()
        val rows = Regex("<row[^>]*>(.*?)</row>", RegexOption.DOT_MATCHES_ALL).findAll(xml).map { rm ->
            val cells = mutableMapOf<Int, String>()
            Regex("<c r=\"([A-Z]+)\\d+\"([^>]*?)(?:/>|>(.*?)</c>)", RegexOption.DOT_MATCHES_ALL).findAll(rm.groupValues[1]).forEach { cm ->
                val col = cm.groupValues[1].fold(0) { acc, ch -> acc * 26 + (ch - 'A' + 1) } - 1
                val attrs = cm.groupValues[2]; val inner = cm.groupValues[3]
                val v = Regex("<v>(.*?)</v>", RegexOption.DOT_MATCHES_ALL).find(inner)?.groupValues?.get(1)
                val value = when {
                    attrs.contains("t=\"s\"") -> v?.toIntOrNull()?.let { shared.getOrNull(it) } ?: ""
                    attrs.contains("t=\"inlineStr\"") -> Regex("<t[^>]*>(.*?)</t>", RegexOption.DOT_MATCHES_ALL).find(inner)?.groupValues?.get(1)?.let(::unxml) ?: ""
                    else -> v?.let(::unxml) ?: ""
                }
                cells[col] = value
            }
            cells
        }.filter { it.values.any { v -> v.isNotBlank() } }.toList()
        if (rows.isEmpty()) return emptyList()
        val headerCells = rows.first(); val maxCol = headerCells.keys.maxOrNull() ?: 0
        val headers = (0..maxCol).map { normalizeHeader(headerCells[it] ?: "col$it") }
        return rows.drop(1).map { r -> headers.indices.associate { headers[it] to (r[it]?.trim() ?: "") } }
    }

    fun normalizeHeader(h: String) = java.text.Normalizer.normalize(h.trim().lowercase(), java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}"), "").replace(Regex("[^a-z0-9]+"), "_").trim('_')
    private fun unxml(s: String) = s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

class ImportService(private val db: Db) {
    data class Spec(val entity: String, val permission: String, val required: List<String>, val aliases: Map<String, List<String>>)

    val specs = mapOf(
        "products" to Spec("products", "products.import", listOf("name", "price"), mapOf("name" to listOf("nombre", "producto"), "price" to listOf("precio", "precio_venta"), "cost_price" to listOf("costo", "cost"), "sku" to listOf("codigo", "clave"), "barcode" to listOf("codigo_de_barras", "ean", "upc"),
            "category" to listOf("categoria"), "brand" to listOf("marca"), "supplier" to listOf("proveedor"), "description" to listOf("descripcion"), "low_stock_threshold" to listOf("stock_minimo", "minimo"), "max_stock" to listOf("stock_maximo", "maximo"), "stock" to listOf("existencia", "inventario", "cantidad"), "unit" to listOf("unidad"))),
        "customers" to Spec("customers", "customers.create", listOf("first_name"), mapOf("first_name" to listOf("nombre"), "last_name" to listOf("apellidos", "apellido"), "phone" to listOf("telefono", "celular", "whatsapp"), "email" to listOf("correo"), "neighborhood" to listOf("colonia"), "street" to listOf("calle", "direccion"), "ext_number" to listOf("numero"), "zip" to listOf("cp", "codigo_postal"), "city" to listOf("ciudad"), "state" to listOf("estado"), "notes" to listOf("notas"))),
        "suppliers" to Spec("suppliers", "suppliers.manage", listOf("name"), mapOf("name" to listOf("nombre", "proveedor"), "contact_name" to listOf("contacto"), "phone" to listOf("telefono"), "email" to listOf("correo"), "city" to listOf("ciudad"), "state" to listOf("estado"), "notes" to listOf("notas"))),
        "inventory" to Spec("inventory", "inventory.adjust", listOf("quantity"), mapOf("sku" to listOf("codigo", "clave"), "barcode" to listOf("codigo_de_barras"), "quantity" to listOf("cantidad", "existencia", "stock"), "unit_cost" to listOf("costo"))),
    )

    private fun pickField(row: Map<String, String>, field: String, spec: Spec): String? {
        val keys = listOf(field) + (spec.aliases[field] ?: emptyList())
        return keys.firstNotNullOfOrNull { k -> row[k]?.takeIf { it.isNotBlank() } }
    }

    suspend fun preview(ctx: AuthContext, entity: String, rows: List<Map<String, String>>): JsonObject {
        val spec = specs[entity] ?: throw ErpException.badRequest("Entidad de importación no soportada.")
        if (!ctx.has(spec.permission)) throw ErpException.forbidden()
        val existingSkus = if (entity in setOf("products", "inventory")) db.selectAll("products", "id, sku, barcode, name") { org(ctx); isNull("deleted_at") } else emptyList()
        val skuMap = existingSkus.associateBy { it.str("sku")?.uppercase() }
        val barcodeMap = existingSkus.filter { it.str("barcode") != null }.associateBy { it.str("barcode") }
        val categories = if (entity == "products") db.selectAll("categories", "id, name") { org(ctx); isNull("deleted_at") }.associateBy { it.str("name")?.lowercase() } else emptyMap()
        val brands = if (entity == "products") db.selectAll("brands", "id, name") { org(ctx); isNull("deleted_at") }.associateBy { it.str("name")?.lowercase() } else emptyMap()
        val suppliers = if (entity == "products") db.selectAll("suppliers", "id, name") { org(ctx); isNull("deleted_at") }.associateBy { it.str("name")?.lowercase() } else emptyMap()
        val existingPhones = if (entity == "customers") db.selectAll("customers", "phone") { org(ctx); isNull("deleted_at"); notNull("phone") }.mapNotNull { it.str("phone") }.toSet() else emptySet()
        val seenSku = mutableSetOf<String>(); val seenPhone = mutableSetOf<String>()

        val results = rows.mapIndexed { i, row ->
            val errors = mutableListOf<String>()
            val mapped = mutableMapOf<String, Any?>()
            val fieldsOf = (spec.required + spec.aliases.keys).distinct()
            for (f in fieldsOf) mapped[f] = pickField(row, f, spec)
            for (f in spec.required) if (mapped[f] == null) errors.add("Falta $f")
            when (entity) {
                "products" -> {
                    val price = (mapped["price"] as String?)?.replace("$", "")?.replace(",", "")?.toDoubleOrNull()
                    if (price == null || price <= 0) errors.add("Precio inválido") else mapped["price"] = price
                    mapped["cost_price"] = (mapped["cost_price"] as String?)?.replace("$", "")?.replace(",", "")?.toDoubleOrNull() ?: 0.0
                    val sku = (mapped["sku"] as String?)?.uppercase()
                    if (sku != null) { if (sku in seenSku) errors.add("SKU duplicado en el archivo"); seenSku.add(sku); if (skuMap.containsKey(sku)) mapped["_update_id"] = skuMap[sku]?.str("id") }
                    (mapped["barcode"] as String?)?.let { b -> if (barcodeMap.containsKey(b) && mapped["_update_id"] == null) errors.add("Código de barras ya existe en “${barcodeMap[b]?.str("name")}”") }
                    (mapped["category"] as String?)?.let { c -> val id = categories[c.lowercase()]?.str("id"); if (id == null) errors.add("Categoría “$c” no existe") else mapped["category_id"] = id }
                    if (mapped["category_id"] == null && mapped["_update_id"] == null) errors.add("Categoría requerida")
                    (mapped["brand"] as String?)?.let { b -> mapped["brand_id"] = brands[b.lowercase()]?.str("id") ?: run { errors.add("Marca “$b” no existe"); null } }
                    (mapped["supplier"] as String?)?.let { s -> mapped["supplier_id"] = suppliers[s.lowercase()]?.str("id") ?: run { errors.add("Proveedor “$s” no existe"); null } }
                    mapped["low_stock_threshold"] = (mapped["low_stock_threshold"] as String?)?.toIntOrNull()
                    mapped["max_stock"] = (mapped["max_stock"] as String?)?.toIntOrNull()
                    mapped["stock"] = (mapped["stock"] as String?)?.toIntOrNull()
                }
                "customers" -> {
                    val phone = (mapped["phone"] as String?)?.replace(Regex("[^0-9+]"), "")
                    if (phone != null) { if (phone in existingPhones || phone in seenPhone) errors.add("Teléfono ya registrado"); seenPhone.add(phone); mapped["phone"] = phone }
                    (mapped["email"] as String?)?.let { if (!Regex("^[^@\\s]+@[^@\\s]+$").matches(it)) errors.add("Correo inválido") }
                }
                "inventory" -> {
                    val sku = (mapped["sku"] as String?)?.uppercase(); val bc = mapped["barcode"] as String?
                    val p = sku?.let { skuMap[it] } ?: bc?.let { barcodeMap[it] }
                    if (p == null) errors.add("Producto no encontrado (SKU/código)") else { mapped["product_id"] = p.str("id"); mapped["product_name"] = p.str("name") }
                    val qty = (mapped["quantity"] as String?)?.toIntOrNull(); if (qty == null || qty < 0) errors.add("Cantidad inválida") else mapped["quantity"] = qty
                    mapped["unit_cost"] = (mapped["unit_cost"] as String?)?.replace("$", "")?.replace(",", "")?.toDoubleOrNull()
                }
            }
            jsonOf("row" to i + 2, "valid" to errors.isEmpty(), "errors" to errors, "data" to JsonObject(mapped.filterKeys { !it.startsWith("_") || it == "_update_id" }.mapValues { it.value.toJsonElement() }))
        }
        return jsonOf("entity" to entity, "total" to results.size, "valid" to results.count { it.bool("valid") == true }, "invalid" to results.count { it.bool("valid") != true }, "rows" to results)
    }

    suspend fun commit(ctx: AuthContext, entity: String, rows: List<JsonObject>, warehouseId: String?): JsonObject {
        val spec = specs[entity] ?: throw ErpException.badRequest("Entidad no soportada.")
        if (!ctx.has(spec.permission)) throw ErpException.forbidden()
        var created = 0; var updated = 0; val failed = mutableListOf<JsonObject>()
        when (entity) {
            "products" -> rows.forEach { r ->
                try {
                    val updateId = r.str("_update_id")
                    val base = pick(r, listOf("name", "price", "cost_price", "sku", "barcode", "category_id", "brand_id", "supplier_id", "description", "low_stock_threshold", "max_stock", "unit"))
                    if (updateId != null) { db.update("products", updateId, base.without("sku").with("updated_by" to ctx.userId)); updated++ }
                    else { db.insert("products", base.with("organization_id" to ctx.organizationId, "slug" to slugify(r.str("name")!!) + "-" + (System.nanoTime() % 100000), "created_by" to ctx.userId, "stock" to 0, "status" to "ACTIVE")); created++ }
                } catch (e: ErpException) { failed.add(jsonOf("row" to r["row"], "error" to e.message)) }
            }
            "customers" -> rows.forEach { r ->
                try {
                    val c = db.insert("customers", pick(r, listOf("first_name", "last_name", "phone", "email", "notes")).with("organization_id" to ctx.organizationId, "source" to "IMPORT", "created_by" to ctx.userId))
                    if (r.str("neighborhood") != null || r.str("street") != null) db.insert("customer_addresses", jsonOf("customer_id" to c.str("id"), "street" to r.str("street"), "ext_number" to r.str("ext_number"), "neighborhood_text" to r.str("neighborhood"), "zip" to r.str("zip"), "city" to (r.str("city") ?: "Guaymas"), "state" to (r.str("state") ?: "Sonora"), "is_default" to true))
                    created++
                } catch (e: ErpException) { failed.add(jsonOf("row" to r["row"], "error" to e.message)) }
            }
            "suppliers" -> rows.forEach { r ->
                try { db.insert("suppliers", pick(r, listOf("name", "contact_name", "phone", "email", "city", "state", "notes")).with("organization_id" to ctx.organizationId)); created++ } catch (e: ErpException) { failed.add(jsonOf("row" to r["row"], "error" to e.message)) }
            }
            "inventory" -> {
                val wh = warehouseId ?: throw ErpException.badRequest("Selecciona el almacén destino.")
                val items = rows.filter { it.str("product_id") != null && (it.int("quantity") ?: 0) > 0 }.map { jsonOf("product_id" to it.str("product_id"), "quantity" to it.int("quantity"), "unit_cost" to it.dbl("unit_cost")) }
                if (items.isNotEmpty()) db.rpcObject("apply_inventory_adjustment", jsonOf("p_org" to ctx.organizationId, "p_warehouse" to wh, "p_type" to "INITIAL_STOCK", "p_reason" to "Importación de inventario inicial", "p_notes" to null, "p_items" to items, "p_user" to ctx.userId))
                created = items.size
            }
        }
        return jsonOf("created" to created, "updated" to updated, "failed" to failed)
    }
}

fun Route.importRoutes(service: ImportService, audit: AuditService) {
    post("/import/{entity}/preview") {
        val ctx = call.require()
        val entity = call.requiredParam("entity")
        val contentType = call.request.contentType()
        val rows: List<Map<String, String>> = if (contentType.match(ContentType.MultiPart.FormData)) {
            var parsed: List<Map<String, String>> = emptyList()
            call.receiveMultipart().forEachPart { part ->
                if (part is PartData.FileItem) { val bytes = part.provider().toByteArray(); if (bytes.size > 5 * 1024 * 1024) throw ErpException.badRequest("El archivo excede 5 MB."); parsed = TabularParser.parse(bytes, part.originalFileName) }
                part.dispose()
            }
            parsed
        } else {
            val body = call.receiveOrThrow<JsonObject>()
            body.str("csv")?.let { TabularParser.parseCsv(it) } ?: body.arr("rows")?.map { r -> r.jsonObject.entries.associate { TabularParser.normalizeHeader(it.key) to (it.value.jsonPrimitive.contentOrNull ?: "") } } ?: emptyList()
        }
        if (rows.isEmpty()) throw ErpException.badRequest("El archivo no tiene filas. Verifica que la primera fila sean los encabezados.")
        if (rows.size > 5000) throw ErpException.badRequest("Máximo 5 000 filas por importación.")
        call.respond(service.preview(ctx, entity, rows))
    }
    post("/import/{entity}/commit") {
        val ctx = call.require()
        val entity = call.requiredParam("entity")
        val body = call.receiveOrThrow<JsonObject>()
        val rows = body.arr("rows")?.map { it.jsonObject } ?: emptyList()
        if (rows.isEmpty()) throw ErpException.badRequest("No hay filas válidas para importar.")
        val res = service.commit(ctx, entity, rows, body.str("warehouse_id"))
        audit.log(call, "import.$entity", "IMPORT", null, null, res)
        call.respond(res)
    }
}
