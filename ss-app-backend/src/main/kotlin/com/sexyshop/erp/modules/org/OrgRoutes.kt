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
        (value as? JsonObject)?.let { v -> validateSetting(key, v) }
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
    /** Permisos válidos y sin escalamiento: solo el super administrador otorga lo que no tiene. */
    suspend fun checkRolePermissions(ctx: AuthContext, perms: Collection<String>) {
        if (perms.isEmpty()) return
        val known = db.selectAll("permissions", "code").mapNotNull { it.str("code") }.toSet()
        val unknown = perms.filter { it !in known }
        if (unknown.isNotEmpty()) throw ErpException.badRequest("Permisos desconocidos: ${unknown.take(3).joinToString(", ")}.", "PERMISO_INVALIDO")
        if (!ctx.isSuperAdmin) {
            val extra = perms.filter { it !in ctx.permissions }
            if (extra.isNotEmpty()) throw ErpException.forbidden("No puedes otorgar permisos que tu usuario no tiene: ${extra.take(3).joinToString(", ")}.")
        }
    }
    fun validateRole(fields: JsonObject, creating: Boolean) = validate {
        if (creating) { notBlank(fields.str("code"), "code", "El código"); require(fields.str("code").isNullOrBlank() || Regex("^[A-Za-z][A-Za-z0-9_ ]{1,29}$").matches(fields.str("code")!!), "code", "El código debe empezar con letra y usar solo letras, números o guion bajo (ej. CAJERO).") }
        if (creating || fields.containsKey("name")) notBlank(fields.str("name"), "name", "El nombre")
        val d = fields.dbl("max_discount_pct"); require(d == null || (d in 0.0..100.0), "max_discount_pct", "El descuento máximo debe estar entre 0 y 100 %.")
    }
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
        validateRole(fields, creating = true)
        checkRolePermissions(ctx, body.arr("permissions")?.map { it.jsonPrimitive.content } ?: emptyList())
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
        validateRole(fields, creating = false)
        body.arr("permissions")?.let { arr -> checkRolePermissions(ctx, arr.map { it.jsonPrimitive.content }) }
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
        if (role.str("organization_id") != ctx.organizationId) throw ErpException.notFound("Rol no encontrado.")
        if (role.bool("is_system") == true) throw ErpException.forbidden("Los roles del sistema no se eliminan.")
        val users = db.count("user_roles") { eq("role_id", id) }
        if (users > 0) throw ErpException.conflict("${users} usuario${if (users == 1L) "" else "s"} tiene${if (users == 1L) "" else "n"} el rol “${role.str("name")}”. Asígnales otro rol antes de eliminarlo.")
        db.delete("roles") { eq("id", id); eq("organization_id", ctx.organizationId) }
        audit.log(call, "roles.delete", "ROLE", id, role, null)
        call.respond(HttpStatusCode.NoContent)
    }
}


/** Valida los valores de configuración antes de guardarlos (zona horaria real, números en rango, opciones válidas). */
fun validateSetting(key: String, v: JsonObject) = validate {
    fun num(k: String) = v[k]?.let { (it as? JsonPrimitive)?.doubleOrNull }
    when (key) {
        "locale" -> {
            val tz = v.str("timezone"); require(tz.isNullOrBlank() || runCatching { java.time.ZoneId.of(tz) }.isSuccess, "timezone", "La zona horaria no es válida (ej. America/Hermosillo).")
            val cur = v.str("currency"); require(cur.isNullOrBlank() || Regex("^[A-Z]{3}$").matches(cur), "currency", "La moneda debe ser un código de 3 letras (ej. MXN).")
        }
        "inventory" -> {
            oneOf(v.str("cost_method"), listOf("LAST", "AVERAGE"), "cost_method", "El método de costo")
            require((num("default_min_stock") ?: 0.0) >= 0, "default_min_stock", "El stock mínimo no puede ser negativo.")
            require((num("dead_stock_days") ?: 1.0) >= 1, "dead_stock_days", "Los días sin venta deben ser al menos 1.")
        }
        "sales" -> {
            val d = num("allow_cancel_days"); require(d == null || d in 0.0..365.0, "allow_cancel_days", "Los días para cancelar deben estar entre 0 y 365.")
            val p = v.str("folio_prefix"); require(p.isNullOrBlank() || Regex("^[A-Z0-9]{2,6}$").matches(p), "folio_prefix", "El prefijo de folio debe tener de 2 a 6 letras o números en mayúscula (ej. SON).")
        }
        "ticket" -> { val w = num("width_mm"); require(w == null || w in 48.0..216.0, "width_mm", "El ancho del ticket debe estar entre 48 y 216 mm (58 u 80 mm es lo común).") }
        "alerts" -> listOf("cash_difference_threshold", "cancellations_per_day", "discounts_pct_per_day", "returns_per_week").forEach { k -> require((num(k) ?: 0.0) >= 0, k, "Los umbrales de alertas no pueden ser negativos.") }
        "security" -> { val hrs = num("session_hours"); require(hrs == null || hrs in 1.0..720.0, "session_hours", "Las horas de sesión deben estar entre 1 y 720.") }
    }
}
