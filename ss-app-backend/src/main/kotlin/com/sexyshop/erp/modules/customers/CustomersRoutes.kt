package com.sexyshop.erp.modules.customers

import com.sexyshop.erp.core.*
import io.ktor.http.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*

/**
 * Clientes (datos mínimos, privados), direcciones y colonias normalizadas.
 * Cada acceso al expediente completo (Customer 360) queda auditado.
 */
/** Teléfono solo con dígitos (y + inicial). Valida 10 dígitos nacionales o con lada internacional. */
private fun normalizePhone(raw: String?): String? {
    if (raw.isNullOrBlank()) return null
    val p = raw.trim().let { if (it.startsWith("+")) "+" + it.drop(1).filter(Char::isDigit) else it.filter(Char::isDigit) }
    val digits = p.count(Char::isDigit)
    if (digits < 10 || digits > 13) throw ErpException(HttpStatusCode.UnprocessableEntity, "VALIDATION", "El teléfono debe tener 10 dígitos (ej. 622 123 4567).", JsonObject(mapOf("phone" to JsonPrimitive("El teléfono debe tener 10 dígitos (ej. 622 123 4567)."))))
    return p
}

fun Route.customersRoutes(db: Db, audit: AuditService) {
    val fields = listOf("first_name", "last_name", "phone", "email", "birthday", "notes", "source", "status", "accepts_marketing", "code")
    val addressFields = listOf("label", "street", "ext_number", "int_number", "neighborhood_text", "zip", "city", "state", "references_text", "is_default")

    get("/customers") {
        val ctx = call.require("customers.read")
        val q = PageQuery.from(call, "last_purchase_at")
        val p = call.request.queryParameters
        val (rows, total) = db.list("customers", "*, neighborhoods(name)", q, {
            org(ctx); isNull("deleted_at"); eqOpt("status", p["status"]); eqOpt("source", p["source"]); eqOpt("default_neighborhood_id", p["neighborhood"])
            if (p["with_purchases"] == "true") gt("purchases_count", 0)
            if (q.q != null) {
                val nq = java.text.Normalizer.normalize(q.q, java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}"), "").lowercase()
                ilike("search_text", "%${nq.replace("%", "").replace(",", " ")}%")
            }
        }, mapOf("last_purchase_at" to "last_purchase_at", "first_name" to "first_name", "total_spent" to "total_spent", "purchases_count" to "purchases_count", "created_at" to "created_at"))
        call.respond(paged(rows.map { it.with("neighborhood_name" to it.obj("neighborhoods")?.str("name")).without("neighborhoods", "search_text") }, q, total))
    }

    get("/customers/{id}") {
        val ctx = call.require("customers.read")
        val id = call.requiredParam("id")
        db.one("customers", "id") { eq("id", id); org(ctx); isNull("deleted_at") } ?: throw ErpException.notFound("Cliente no encontrado.")
        val c360 = db.rpcObject("bi_customer_360", jsonOf("p_customer" to id))
        audit.log(call, "customers.view", "CUSTOMER", id)
        call.respond(c360.stripCost(ctx))
    }

    post("/customers") {
        val ctx = call.require("customers.create")
        val body = call.receiveOrThrow<JsonObject>()
        val f = pick(body, fields)
        validate { notBlank(f.str("first_name"), "first_name", "El nombre"); email(f.str("email")); maxLen(f.str("notes"), 1000, "notes", "Las notas") }
        val phone = normalizePhone(f.str("phone"))
        if (!phone.isNullOrBlank()) db.one("customers", "id, first_name, last_name") { org(ctx); isNull("deleted_at"); eq("phone", phone) }?.let {
            val msg = "Ya existe un cliente con ese teléfono: ${listOfNotNull(it.str("first_name"), it.str("last_name")).joinToString(" ")}. Búscalo en lugar de crearlo de nuevo."
            throw ErpException(HttpStatusCode.Conflict, "PHONE_EXISTS", msg, JsonObject(mapOf("phone" to JsonPrimitive(msg))))
        }
        val row = db.insert("customers", f.with("organization_id" to ctx.organizationId, "created_by" to ctx.userId, "source" to (f.str("source") ?: "POS"), "phone" to phone))
        body.obj("address")?.let { a ->
            val af = pick(a, addressFields)
            if (af.values.any { it !is JsonNull }) db.insert("customer_addresses", af.with("customer_id" to row.str("id"), "is_default" to true))
        }
        audit.log(call, "customers.create", "CUSTOMER", row.str("id"), null, row.without("search_text"))
        call.respond(HttpStatusCode.Created, db.byId("customers", row.str("id")!!).without("search_text"))
    }

    patch("/customers/{id}") {
        val ctx = call.require("customers.update")
        val id = call.requiredParam("id")
        val before = db.one("customers") { eq("id", id); org(ctx); isNull("deleted_at") } ?: throw ErpException.notFound("Cliente no encontrado.")
        var f = pick(call.receiveOrThrow<JsonObject>(), fields)
        validate { if (f.containsKey("first_name")) notBlank(f.str("first_name"), "first_name", "El nombre"); email(f.str("email")); oneOf(f.str("status"), listOf("ACTIVE", "INACTIVE"), "status", "El estado") }
        if (f.containsKey("phone")) {
            val phone = normalizePhone(f.str("phone"))
            if (phone != null) db.one("customers", "id, first_name, last_name") { org(ctx); isNull("deleted_at"); eq("phone", phone); neq("id", id) }?.let {
                val msg = "Ese teléfono ya pertenece a ${listOfNotNull(it.str("first_name"), it.str("last_name")).joinToString(" ")}."
                throw ErpException(HttpStatusCode.Conflict, "PHONE_EXISTS", msg, JsonObject(mapOf("phone" to JsonPrimitive(msg))))
            }
            f = f.with("phone" to phone)
        }
        val after = db.update("customers", id, f)
        audit.log(call, "customers.update", "CUSTOMER", id, before.without("search_text"), after.without("search_text"))
        call.respond(after.without("search_text"))
    }

    delete("/customers/{id}") {
        val ctx = call.require("customers.delete")
        val id = call.requiredParam("id")
        val before = db.one("customers") { eq("id", id); org(ctx); isNull("deleted_at") } ?: throw ErpException.notFound("Cliente no encontrado.")
        // Soft delete + anonimización de contacto: el historial de ventas se conserva sin datos personales
        db.update("customers", id, jsonOf("deleted_at" to nowIso(), "deleted_by" to ctx.userId, "status" to "INACTIVE", "phone" to null, "email" to null, "notes" to null, "birthday" to null))
        db.delete("customer_addresses") { eq("customer_id", id) }
        audit.log(call, "customers.delete", "CUSTOMER", id, before.without("search_text"), null)
        call.respond(HttpStatusCode.NoContent)
    }

    post("/customers/{id}/addresses") {
        val ctx = call.require("customers.update", "customers.create")
        val id = call.requiredParam("id")
        db.one("customers", "id") { eq("id", id); org(ctx); isNull("deleted_at") } ?: throw ErpException.notFound("Cliente no encontrado.")
        val af = pick(call.receiveOrThrow<JsonObject>(), addressFields)
        validate { notBlank(af.str("neighborhood_text"), "neighborhood_text", "La colonia") }
        if (af.bool("is_default") == true) db.updateWhere("customer_addresses", jsonOf("is_default" to false)) { eq("customer_id", id) }
        val row = db.insert("customer_addresses", af.with("customer_id" to id))
        audit.log(call, "customers.address.create", "CUSTOMER", id, null, row)
        call.respond(HttpStatusCode.Created, row)
    }
    patch("/customers/addresses/{id}") {
        val ctx = call.require("customers.update")
        val id = call.requiredParam("id")
        val before = db.byId("customer_addresses", id)
        db.one("customers", "id") { eq("id", before.str("customer_id")!!); org(ctx) } ?: throw ErpException.notFound("Dirección no encontrada.")
        val af = pick(call.receiveOrThrow<JsonObject>(), addressFields)
        validate { if (af.containsKey("neighborhood_text")) notBlank(af.str("neighborhood_text"), "neighborhood_text", "La colonia") }
        if (af.bool("is_default") == true) db.updateWhere("customer_addresses", jsonOf("is_default" to false)) { eq("customer_id", before.str("customer_id")!!) }
        val after = db.update("customer_addresses", id, af)
        audit.log(call, "customers.address.update", "CUSTOMER", before.str("customer_id"), before, after)
        call.respond(after)
    }
    delete("/customers/addresses/{id}") {
        val ctx = call.require("customers.update")
        val id = call.requiredParam("id")
        val before = db.byId("customer_addresses", id)
        db.one("customers", "id") { eq("id", before.str("customer_id")!!); org(ctx) } ?: throw ErpException.notFound("Dirección no encontrada.")
        db.delete("customer_addresses") { eq("id", id) }
        audit.log(call, "customers.address.delete", "CUSTOMER", before.str("customer_id"), before, null)
        call.respond(HttpStatusCode.NoContent)
    }

    // ---------------------------------------------------------------- Colonias
    get("/neighborhoods") {
        val ctx = call.require("customers.read", "analytics.read")
        val rows = db.selectAll("neighborhoods", order = "name") { org(ctx); if (call.request.queryParameters["all"] != "true") eq("is_active", true) }
        val counts = db.selectAll("customers", "default_neighborhood_id") { org(ctx); isNull("deleted_at"); notNull("default_neighborhood_id") }.groupingBy { it.str("default_neighborhood_id") }.eachCount()
        call.respond(JsonArray(rows.map { it.with("customers" to (counts[it.str("id")] ?: 0)) }))
    }
    post("/neighborhoods") {
        val ctx = call.require("customers.update", "settings.manage")
        val body = call.receiveOrThrow<JsonObject>()
        validate { notBlank(body.str("name"), "name", "El nombre") }
        val id = db.rpc("resolve_neighborhood", jsonOf("p_org" to ctx.organizationId, "p_name" to body.str("name"), "p_zip" to body.str("zip"), "p_city" to body.str("city"), "p_state" to body.str("state"))).jsonPrimitive.content
        val row = db.update("neighborhoods", id, pick(body, listOf("zip", "lat", "lng", "aliases", "is_active")))
        audit.log(call, "neighborhoods.create", "NEIGHBORHOOD", id, null, row)
        call.respond(HttpStatusCode.Created, row)
    }
    patch("/neighborhoods/{id}") {
        val ctx = call.require("customers.update", "settings.manage")
        val id = call.requiredParam("id")
        val before = db.one("neighborhoods") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        val after = db.update("neighborhoods", id, pick(call.receiveOrThrow<JsonObject>(), listOf("name", "zip", "city", "state", "lat", "lng", "aliases", "is_active")))
        audit.log(call, "neighborhoods.update", "NEIGHBORHOOD", id, before, after)
        call.respond(after)
    }
    /** Fusiona la colonia {id} dentro de {target}: mueve direcciones, clientes y ventas; el nombre queda como alias. */
    post("/neighborhoods/{id}/merge") {
        val ctx = call.require("settings.manage")
        val id = call.requiredParam("id")
        val target = call.receiveOrThrow<JsonObject>().str("target_id") ?: throw ErpException.badRequest("Falta la colonia destino.")
        if (target == id) throw ErpException.badRequest("Elige una colonia distinta.")
        val src = db.one("neighborhoods") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        val dst = db.one("neighborhoods") { eq("id", target); org(ctx) } ?: throw ErpException.notFound("Colonia destino no encontrada.")
        db.updateWhere("customer_addresses", jsonOf("neighborhood_id" to target)) { eq("neighborhood_id", id) }
        db.updateWhere("customers", jsonOf("default_neighborhood_id" to target)) { eq("default_neighborhood_id", id) }
        db.updateWhere("sales", jsonOf("neighborhood_id" to target)) { eq("neighborhood_id", id) }
        db.updateWhere("sale_items", jsonOf("neighborhood_id" to target)) { eq("neighborhood_id", id) }
        val aliases = (dst.arr("aliases")?.map { it.jsonPrimitive.content } ?: emptyList()) + listOfNotNull(src.str("normalized_name")) + (src.arr("aliases")?.map { it.jsonPrimitive.content } ?: emptyList())
        db.update("neighborhoods", target, jsonOf("aliases" to aliases.distinct()))
        db.delete("neighborhoods") { eq("id", id) }
        audit.log(call, "neighborhoods.merge", "NEIGHBORHOOD", target, src, dst, jsonOf("merged_id" to id))
        call.respond(jsonOf("merged_into" to target, "aliases" to aliases.distinct()))
    }
}
