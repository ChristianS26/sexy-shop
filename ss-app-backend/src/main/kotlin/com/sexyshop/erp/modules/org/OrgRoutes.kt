package com.sexyshop.erp.modules.org

import com.sexyshop.erp.core.*
import io.ktor.http.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*

/**
 * Organización, sucursales, almacenes, cajas, métodos de pago, impuestos, roles y settings.
 */
class OrgService(private val db: Db, private val audit: AuditService, private val erpAuth: ErpAuth) {

    suspend fun settings(orgId: String): JsonObject {
        val rows = db.selectAll("organization_settings", "key, value, updated_at") { eq("organization_id", orgId) }
        return JsonObject(rows.associate { it.str("key")!! to (it["value"] ?: JsonNull) })
    }

    suspend fun saveSetting(orgId: String, userId: String, key: String, value: JsonElement) {
        if (key !in ALLOWED_SETTING_KEYS) throw ErpException.badRequest("Clave de configuración no permitida.")
        db.upsert("organization_settings", jsonOf("organization_id" to orgId, "key" to key, "value" to value, "updated_at" to nowIso(), "updated_by" to userId))
    }

    companion object {
        val ALLOWED_SETTING_KEYS = setOf("company", "locale", "tax", "ticket", "inventory", "alerts", "security", "sales", "notifications")
        val BRANCH_FIELDS = listOf("code", "name", "phone", "email", "street", "ext_number", "neighborhood", "zip", "city", "state", "is_active", "is_default")
        val WAREHOUSE_FIELDS = listOf("branch_id", "code", "name", "is_default", "is_default_online", "is_active")
        val REGISTER_FIELDS = listOf("branch_id", "code", "name", "is_active")
        val PAYMENT_FIELDS = listOf("code", "name", "is_cash", "fee_pct", "requires_reference", "is_active", "display_order")
        val TAX_FIELDS = listOf("code", "name", "rate", "is_default", "is_active")
        val ROLE_FIELDS = listOf("code", "name", "description", "max_discount_pct")
    }
}

fun Route.orgRoutes(db: Db, service: OrgService, audit: AuditService, erpAuth: ErpAuth) {

    // ---- Organización + settings ------------------------------------------------
    get("/org") {
        val ctx = call.require()
        val org = db.byId("organizations", ctx.organizationId)
        call.respond(org.with("settings" to service.settings(ctx.organizationId)))
    }
    patch("/org") {
        val ctx = call.require("settings.manage")
        val body = pick(call.receiveOrThrow<JsonObject>(), listOf("name", "legal_name", "rfc", "tagline", "logo_url", "timezone", "currency"))
        val before = db.byId("organizations", ctx.organizationId)
        val after = db.update("organizations", ctx.organizationId, body)
        audit.log(call, "settings.org.update", "ORGANIZATION", ctx.organizationId, before, after)
        erpAuth.invalidate()
        call.respond(after)
    }
    get("/settings") { call.respond(service.settings(call.require().organizationId)) }
    put("/settings/{key}") {
        val ctx = call.require("settings.manage")
        val key = call.requiredParam("key")
        if (key == "security" && !ctx.has("settings.system")) throw ErpException.forbidden("Solo un super administrador cambia la configuración de seguridad.")
        val value = call.receiveOrThrow<JsonElement>()
        val before = service.settings(ctx.organizationId)[key]
        service.saveSetting(ctx.organizationId, ctx.userId, key, value)
        audit.log(call, "settings.update", "SETTING", key, before, value)
        call.respond(jsonOf("key" to key, "value" to value))
    }

    // ---- Catálogos de estructura: genérico ------------------------------------
    fun Route.simpleCatalog(path: String, table: String, fields: List<String>, perm: String, order: String = "name", extraValidate: (JsonObject) -> Unit = {}) {
        get(path) {
            val ctx = call.require()
            val all = call.request.queryParameters["all"] == "true"
            call.respond(JsonArray(db.selectAll(table, order = order) { org(ctx); if (!all && fields.contains("is_active")) eq("is_active", true) }))
        }
        post(path) {
            val ctx = call.require(perm)
            val body = pick(call.receiveOrThrow<JsonObject>(), fields)
            validate { notBlank(body.str("name"), "name", "El nombre"); if ("code" in fields) notBlank(body.str("code"), "code", "El código") }
            extraValidate(body)
            val row = db.insert(table, body.with("organization_id" to ctx.organizationId))
            audit.log(call, "$table.create", table.uppercase(), row.str("id"), null, row)
            erpAuth.invalidate()
            call.respond(HttpStatusCode.Created, row)
        }
        patch("$path/{id}") {
            val ctx = call.require(perm)
            val id = call.requiredParam("id")
            val body = pick(call.receiveOrThrow<JsonObject>(), fields)
            extraValidate(body)
            val before = db.one(table) { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
            val after = db.update(table, id, body)
            audit.log(call, "$table.update", table.uppercase(), id, before, after)
            erpAuth.invalidate()
            call.respond(after)
        }
    }

    simpleCatalog("/branches", "branches", OrgService.BRANCH_FIELDS, "branches.manage")
    simpleCatalog("/warehouses", "warehouses", OrgService.WAREHOUSE_FIELDS, "branches.manage")
    simpleCatalog("/cash-registers", "cash_registers", OrgService.REGISTER_FIELDS, "branches.manage")
    simpleCatalog("/payment-methods", "payment_methods", OrgService.PAYMENT_FIELDS, "settings.manage", order = "display_order")
    simpleCatalog("/tax-rates", "tax_rates", OrgService.TAX_FIELDS, "settings.manage", order = "code") { b ->
        validate { val r = b.dbl("rate"); require(r == null || (r >= 0 && r < 1), "rate", "La tasa debe estar entre 0 y 0.99 (16 % = 0.16).") }
    }

    // ---- Roles y permisos ------------------------------------------------------
    get("/permissions") { call.require(); call.respond(JsonArray(db.selectAll("permissions", order = "module"))) }
    get("/roles") {
        val ctx = call.require()
        val roles = db.selectAll("roles", "*, role_permissions(permission_code)", order = "code") { or { isNull("organization_id"); eq("organization_id", ctx.organizationId) } }
        call.respond(JsonArray(roles.map { r -> r.with("permissions" to r.arr("role_permissions")?.map { it.jsonObject.str("permission_code") }).without("role_permissions") }))
    }
    post("/roles") {
        val ctx = call.require("roles.manage")
        val body = call.receiveOrThrow<JsonObject>()
        val fields = pick(body, OrgService.ROLE_FIELDS)
        validate { notBlank(fields.str("code"), "code", "El código"); notBlank(fields.str("name"), "name", "El nombre") }
        val role = db.insert("roles", fields.with("organization_id" to ctx.organizationId, "code" to fields.str("code")!!.uppercase().replace(Regex("[^A-Z0-9_]"), "_")))
        val perms = body.arr("permissions")?.map { it.jsonPrimitive.content } ?: emptyList()
        db.insertMany("role_permissions", perms.map { jsonOf("role_id" to role.str("id"), "permission_code" to it) })
        audit.log(call, "roles.create", "ROLE", role.str("id"), null, role.with("permissions" to perms))
        call.respond(HttpStatusCode.Created, role.with("permissions" to perms))
    }
    patch("/roles/{id}") {
        val ctx = call.require("roles.manage")
        val id = call.requiredParam("id")
        val role = db.byId("roles", id)
        if (role.bool("is_system") == true && !ctx.has("settings.system")) throw ErpException.forbidden("Los roles del sistema solo los edita un super administrador.")
        if (role.str("organization_id") != null && role.str("organization_id") != ctx.organizationId) throw ErpException.notFound()
        val body = call.receiveOrThrow<JsonObject>()
        val fields = pick(body, OrgService.ROLE_FIELDS - "code")
        val after = if (fields.isNotEmpty()) db.update("roles", id, fields) else role
        body.arr("permissions")?.let { arr ->
            val perms = arr.map { it.jsonPrimitive.content }.toSet()
            db.delete("role_permissions") { eq("role_id", id) }
            db.insertMany("role_permissions", perms.map { jsonOf("role_id" to id, "permission_code" to it) })
        }
        audit.log(call, "roles.update", "ROLE", id, role, after.with("permissions" to body["permissions"]))
        erpAuth.invalidate()
        call.respond(after)
    }
    delete("/roles/{id}") {
        val ctx = call.require("roles.manage")
        val id = call.requiredParam("id")
        val role = db.byId("roles", id)
        if (role.bool("is_system") == true) throw ErpException.forbidden("Los roles del sistema no se eliminan.")
        if (db.count("user_roles") { eq("role_id", id) } > 0) throw ErpException.conflict("Hay usuarios con este rol. Reasígnalos antes de eliminarlo.")
        db.delete("roles") { eq("id", id); eq("organization_id", ctx.organizationId) }
        audit.log(call, "roles.delete", "ROLE", id, role, null)
        call.respond(HttpStatusCode.NoContent)
    }
}
