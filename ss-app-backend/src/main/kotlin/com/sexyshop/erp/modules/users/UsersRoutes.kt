package com.sexyshop.erp.modules.users

import com.sexyshop.erp.core.*
import io.ktor.client.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*
import org.slf4j.LoggerFactory

/**
 * Usuarios del ERP. Las credenciales viven en Supabase Auth (hash bcrypt, sesiones,
 * recuperación por correo, MFA). Aquí se orquesta el Admin API de GoTrue + tabla `users`.
 */
class GoTrueAdmin(private val http: HttpClient, private val supabaseUrl: String, private val serviceKey: String, private val anonKey: String?) {
    private val log = LoggerFactory.getLogger(GoTrueAdmin::class.java)

    private fun HttpRequestBuilder.adminHeaders() {
        header("apikey", serviceKey); header(HttpHeaders.Authorization, "Bearer $serviceKey"); contentType(ContentType.Application.Json)
    }

    suspend fun createUser(email: String, password: String, fullName: String): String {
        val res = http.post("$supabaseUrl/auth/v1/admin/users") {
            adminHeaders()
            setBody(jsonOf("email" to email, "password" to password, "email_confirm" to true, "user_metadata" to jsonOf("full_name" to fullName)).toString())
        }
        val body = res.bodyAsText()
        if (!res.status.isSuccess()) {
            log.warn("GoTrue createUser {}: {}", res.status, body.take(300))
            val msg = runCatching { erpJson.parseToJsonElement(body).jsonObject.let { it["msg"] ?: it["message"] ?: it["error_description"] }?.jsonPrimitive?.content }.getOrNull() ?: ""
            throw when {
                msg.contains("already", true) || msg.contains("exists", true) -> ErpException.conflict("Ya existe una cuenta con ese correo.", "EMAIL_EXISTS")
                msg.contains("password", true) -> ErpException.badRequest("La contraseña no cumple los requisitos (mínimo 8 caracteres).", "WEAK_PASSWORD")
                else -> ErpException.badRequest("No se pudo crear la cuenta de acceso.", "AUTH_CREATE")
            }
        }
        return erpJson.parseToJsonElement(body).jsonObject["id"]!!.jsonPrimitive.content
    }

    suspend fun updateUser(id: String, patch: JsonObject) {
        val res = http.put("$supabaseUrl/auth/v1/admin/users/$id") { adminHeaders(); setBody(patch.toString()) }
        if (!res.status.isSuccess()) { log.warn("GoTrue updateUser {}: {}", res.status, res.bodyAsText().take(300)); throw ErpException.badRequest("No se pudo actualizar la cuenta de acceso.", "AUTH_UPDATE") }
    }

    suspend fun deleteUser(id: String) {
        val res = http.delete("$supabaseUrl/auth/v1/admin/users/$id") { adminHeaders() }
        if (!res.status.isSuccess() && res.status != HttpStatusCode.NotFound) throw ErpException.badRequest("No se pudo eliminar la cuenta de acceso.", "AUTH_DELETE")
    }

    /** Envía el correo de recuperación de contraseña (GoTrue lo genera y lo manda). */
    suspend fun sendRecovery(email: String, redirectTo: String?) {
        val res = http.post("$supabaseUrl/auth/v1/recover") {
            header("apikey", anonKey ?: serviceKey); contentType(ContentType.Application.Json)
            setBody(jsonOf("email" to email, "gotrue_meta_security" to jsonOf()).let { if (redirectTo != null) it.with("redirect_to" to redirectTo) else it }.toString())
        }
        if (!res.status.isSuccess()) { log.warn("GoTrue recover {}: {}", res.status, res.bodyAsText().take(300)); throw ErpException.badRequest("No se pudo enviar el correo de recuperación.", "AUTH_RECOVER") }
    }
}

class UsersService(private val db: Db, private val gotrue: GoTrueAdmin, private val erpAuth: ErpAuth) {
    companion object {
        val FIELDS = listOf("first_name", "last_name", "email", "phone", "username", "default_branch_id", "avatar_url")
        const val COLUMNS = "*, user_roles(role_id, roles(id, code, name)), user_branches(branch_id, branches(id, code, name))"
    }

    fun shape(u: JsonObject): JsonObject = u
        .with(
            "roles" to u.arr("user_roles")?.mapNotNull { it.jsonObject.obj("roles") },
            "branches" to u.arr("user_branches")?.mapNotNull { it.jsonObject.obj("branches") },
        ).without("user_roles", "user_branches")

    suspend fun get(ctx: AuthContext, id: String): JsonObject =
        db.one("users", COLUMNS) { eq("id", id); org(ctx); isNull("deleted_at") }?.let(::shape) ?: throw ErpException.notFound("Usuario no encontrado.")

    suspend fun assignRoles(userId: String, roleIds: List<String>?, branchIds: List<String>?) {
        if (roleIds != null) {
            db.delete("user_roles") { eq("user_id", userId) }
            db.insertMany("user_roles", roleIds.distinct().map { jsonOf("user_id" to userId, "role_id" to it) })
        }
        if (branchIds != null) {
            db.delete("user_branches") { eq("user_id", userId) }
            db.insertMany("user_branches", branchIds.distinct().map { jsonOf("user_id" to userId, "branch_id" to it) })
        }
        erpAuth.invalidate(userId)
    }

    fun guardRoleEscalation(ctx: AuthContext, roleCodes: List<String>) {
        if ("SUPER_ADMIN" in roleCodes && !ctx.isSuperAdmin) throw ErpException.forbidden("Solo un super administrador puede otorgar ese rol.")
    }
}

fun Route.usersRoutes(db: Db, service: UsersService, gotrue: GoTrueAdmin, audit: AuditService, erpAuth: ErpAuth) {

    get("/users") {
        val ctx = call.require("users.read")
        val q = PageQuery.from(call, "created_at")
        val status = call.request.queryParameters["status"]
        val (rows, total) = db.list("users", UsersService.COLUMNS, q, {
            org(ctx); isNull("deleted_at"); eqOpt("status", status)
            if (q.q != null) or { ilike("first_name", "%${q.q}%"); ilike("last_name", "%${q.q}%"); ilike("email", "%${q.q}%"); ilike("username", "%${q.q}%") }
        }, mapOf("created_at" to "created_at", "first_name" to "first_name", "email" to "email", "last_login_at" to "last_login_at", "status" to "status"))
        call.respond(paged(rows.map(service::shape), q, total))
    }

    get("/users/{id}") { call.respond(service.get(call.require("users.read"), call.requiredParam("id"))) }

    post("/users") {
        val ctx = call.require("users.create")
        val body = call.receiveOrThrow<JsonObject>()
        val fields = pick(body, UsersService.FIELDS)
        val password = body.str("password")
        validate {
            notBlank(fields.str("first_name"), "first_name", "El nombre")
            notBlank(fields.str("email"), "email", "El correo"); email(fields.str("email"))
            notBlank(fields.str("username"), "username", "El usuario")
            require(password != null && password.length >= 8, "password", "La contraseña debe tener al menos 8 caracteres.")
        }
        val roleIds = body.arr("role_ids")?.map { it.jsonPrimitive.content } ?: emptyList()
        val branchIds = body.arr("branch_ids")?.map { it.jsonPrimitive.content } ?: listOfNotNull(fields.str("default_branch_id"))
        val roles = if (roleIds.isEmpty()) emptyList() else db.selectAll("roles", "id, code") { isIn("id", roleIds) }
        service.guardRoleEscalation(ctx, roles.mapNotNull { it.str("code") })
        if (db.count("users") { org(ctx); isNull("deleted_at"); ilike("username", fields.str("username")!!) } > 0) throw ErpException.conflict("Ese nombre de usuario ya está en uso.", "USERNAME_EXISTS")

        val authId = gotrue.createUser(fields.str("email")!!, password!!, listOfNotNull(fields.str("first_name"), fields.str("last_name")).joinToString(" "))
        val user = try {
            db.insert("users", fields.with("id" to authId, "organization_id" to ctx.organizationId, "created_by" to ctx.userId, "status" to "ACTIVE"))
        } catch (e: Exception) {
            runCatching { gotrue.deleteUser(authId) }
            throw e
        }
        service.assignRoles(authId, roleIds, branchIds)
        val full = service.get(ctx, authId)
        audit.log(call, "users.create", "USER", authId, null, full)
        call.respond(HttpStatusCode.Created, full)
    }

    patch("/users/{id}") {
        val ctx = call.require("users.update")
        val id = call.requiredParam("id")
        val before = service.get(ctx, id)
        val body = call.receiveOrThrow<JsonObject>()
        val fields = pick(body, UsersService.FIELDS)
        validate { email(fields.str("email")) }
        if (fields.isNotEmpty()) db.update("users", id, fields)
        if (fields.str("email") != null && fields.str("email") != before.str("email")) gotrue.updateUser(id, jsonOf("email" to fields.str("email"), "email_confirm" to true))
        val roleIds = body.arr("role_ids")?.map { it.jsonPrimitive.content }
        if (roleIds != null) {
            val roles = if (roleIds.isEmpty()) emptyList() else db.selectAll("roles", "id, code") { isIn("id", roleIds) }
            service.guardRoleEscalation(ctx, roles.mapNotNull { it.str("code") })
            if (id == ctx.userId && !ctx.isSuperAdmin && roles.none { it.str("code") in setOf("ADMIN", "SUPER_ADMIN") }) throw ErpException.forbidden("No puedes quitarte tu propio rol de administrador.")
        }
        service.assignRoles(id, roleIds, body.arr("branch_ids")?.map { it.jsonPrimitive.content })
        val after = service.get(ctx, id)
        audit.log(call, "users.update", "USER", id, before, after)
        call.respond(after)
    }

    post("/users/{id}/status") {
        val ctx = call.require("users.update")
        val id = call.requiredParam("id")
        val status = call.receiveOrThrow<JsonObject>().str("status")
        validate { oneOf(status, listOf("ACTIVE", "INACTIVE", "SUSPENDED"), "status", "El estado") }
        if (id == ctx.userId && status != "ACTIVE") throw ErpException.forbidden("No puedes desactivar tu propio usuario.")
        val before = service.get(ctx, id)
        db.update("users", id, jsonOf("status" to status))
        gotrue.updateUser(id, if (status == "ACTIVE") jsonOf("ban_duration" to "none") else jsonOf("ban_duration" to "876000h"))
        erpAuth.invalidate(id)
        val after = service.get(ctx, id)
        audit.log(call, "users.status", "USER", id, before, after)
        call.respond(after)
    }

    delete("/users/{id}") {
        val ctx = call.require("users.delete")
        val id = call.requiredParam("id")
        if (id == ctx.userId) throw ErpException.forbidden("No puedes eliminar tu propio usuario.")
        val before = service.get(ctx, id)
        val hasHistory = db.count("sales") { eq("seller_id", id) } > 0 || db.count("audit_logs") { eq("user_id", id) } > 0
        // Soft delete: el historial (ventas, auditoría) lo referencia
        db.update("users", id, jsonOf("deleted_at" to nowIso(), "deleted_by" to ctx.userId, "status" to "INACTIVE"))
        gotrue.updateUser(id, jsonOf("ban_duration" to "876000h"))
        erpAuth.invalidate(id)
        audit.log(call, "users.delete", "USER", id, before, null, jsonOf("soft" to true, "had_history" to hasHistory))
        call.respond(HttpStatusCode.NoContent)
    }

    post("/users/{id}/password") {
        val ctx = call.require("users.update")
        val id = call.requiredParam("id")
        val password = call.receiveOrThrow<JsonObject>().str("password")
        validate { require(password != null && password.length >= 8, "password", "La contraseña debe tener al menos 8 caracteres.") }
        service.get(ctx, id)
        gotrue.updateUser(id, jsonOf("password" to password))
        audit.log(call, "users.password.set", "USER", id)
        call.respond(jsonOf("ok" to true))
    }

    post("/users/{id}/recover") {
        val ctx = call.require("users.update")
        val user = service.get(ctx, call.requiredParam("id"))
        gotrue.sendRecovery(user.str("email")!!, call.request.queryParameters["redirect"])
        audit.log(call, "users.password.recover", "USER", user.str("id"))
        call.respond(jsonOf("ok" to true, "email" to user.str("email")))
    }
}
