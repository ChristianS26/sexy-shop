package com.sexyshop.erp.core

import io.ktor.client.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import kotlinx.serialization.json.*
import org.slf4j.LoggerFactory
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Verifica el token de Supabase Auth CONTRA GoTrue (firma incluida) en lugar de solo
 * decodificar el payload. El resultado se cachea 60 s por token.
 */
class TokenVerifier(private val http: HttpClient, private val supabaseUrl: String, private val serviceKey: String) {
    private val log = LoggerFactory.getLogger(TokenVerifier::class.java)
    private data class Entry(val userId: String?, val email: String?, val at: Long)
    private val cache = ConcurrentHashMap<String, Entry>()
    private val ttlMs = 60_000L

    suspend fun verify(token: String): Pair<String, String?>? {
        val key = sha256(token)
        cache[key]?.let { if (System.currentTimeMillis() - it.at < ttlMs) return it.userId?.let { id -> id to it.email } }
        if (!looksLikeJwt(token)) return null
        val result = runCatching {
            val res = http.get("$supabaseUrl/auth/v1/user") {
                header("apikey", serviceKey)
                header(HttpHeaders.Authorization, "Bearer $token")
            }
            if (res.status.value == 200) {
                val j = erpJson.parseToJsonElement(res.bodyAsText()).jsonObject
                (j["id"]?.jsonPrimitive?.contentOrNull) to (j["email"]?.jsonPrimitive?.contentOrNull)
            } else null to null
        }.getOrElse { e -> log.warn("GoTrue no disponible al verificar token: {}", e.message); return null }
        if (cache.size > 2000) cache.entries.removeIf { System.currentTimeMillis() - it.value.at > ttlMs }
        cache[key] = Entry(result.first, result.second, System.currentTimeMillis())
        return result.first?.let { it to result.second }
    }

    fun invalidate(token: String) { cache.remove(sha256(token)) }

    private fun looksLikeJwt(t: String): Boolean {
        val parts = t.split(".")
        if (parts.size != 3) return false
        return runCatching {
            val payload = String(java.util.Base64.getUrlDecoder().decode(parts[1]))
            val exp = erpJson.parseToJsonElement(payload).jsonObject["exp"]?.jsonPrimitive?.longOrNull
            exp == null || exp > System.currentTimeMillis() / 1000
        }.getOrDefault(false)
    }

    private fun sha256(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}

/** Construye y cachea el [AuthContext] (usuario ERP + permisos) a partir del user id verificado. */
open class ErpAuth(private val db: Db, private val verifier: TokenVerifier) {
    private val log = LoggerFactory.getLogger(ErpAuth::class.java)
    private data class Entry(val ctx: AuthContext, val at: Long)
    private val cache = ConcurrentHashMap<String, Entry>()
    private val ttlMs = 60_000L

    /** Resultado de autenticación: token inválido (userId null) vs. cuenta sin alta en el ERP (ctx null). */
    data class Result(val userId: String?, val ctx: AuthContext?)

    open suspend fun authenticate(call: ApplicationCall): Result {
        val header = call.request.headers[HttpHeaders.Authorization] ?: return Result(null, null)
        if (!header.startsWith("Bearer ")) return Result(null, null)
        val token = header.removePrefix("Bearer ").trim()
        val (userId, _) = verifier.verify(token) ?: return Result(null, null)
        return Result(userId, contextFor(userId))
    }

    suspend fun contextFor(userId: String): AuthContext? {
        cache[userId]?.let { if (System.currentTimeMillis() - it.at < ttlMs) return it.ctx }
        val j = db.rpc("auth_context", jsonOf("p_user" to userId))
        if (j !is JsonObject) return null
        val ctx = AuthContext.fromJson(j)
        cache[userId] = Entry(ctx, System.currentTimeMillis())
        return ctx
    }

    fun invalidate(userId: String? = null) { if (userId == null) cache.clear() else cache.remove(userId) }
}

val ErpAuthPlugin = createRouteScopedPlugin("ErpAuthPlugin", { ErpAuthConfig() }) {
    val auth = pluginConfig.auth ?: error("ErpAuthPlugin requiere ErpAuth")
    onCall { call ->
        val (userId, ctx) = auth.authenticate(call)
        if (userId == null) {
            call.respond(HttpStatusCode.Unauthorized, ErrorBody("Tu sesión no es válida o expiró. Inicia sesión de nuevo.", "UNAUTHORIZED"))
            return@onCall
        }
        if (ctx == null) {
            call.respond(HttpStatusCode.Forbidden, ErrorBody("Tu cuenta no está dada de alta en el ERP. Pide a un administrador que te registre.", "USER_NOT_FOUND"))
            return@onCall
        }
        if (ctx.status != "ACTIVE") {
            call.respond(HttpStatusCode.Forbidden, ErrorBody("Tu usuario está desactivado. Contacta a un administrador.", "USER_INACTIVE"))
            return@onCall
        }
        call.attributes.put(AuthContextKey, ctx)
    }
}

class ErpAuthConfig { var auth: ErpAuth? = null }

/** Autorización server-side: lanza 403 si falta el permiso. */
fun ApplicationCall.require(vararg anyOf: String): AuthContext {
    val ctx = erpAuthOrNull ?: throw ErpException.unauthorized()
    if (anyOf.isNotEmpty() && !ctx.hasAny(*anyOf)) throw ErpException.forbidden()
    return ctx
}

fun ApplicationCall.requireAll(vararg all: String): AuthContext {
    val ctx = erpAuthOrNull ?: throw ErpException.unauthorized()
    if (!all.all { ctx.has(it) }) throw ErpException.forbidden()
    return ctx
}

/** Sucursal efectiva de la petición: query/body > sucursal por defecto del usuario. */
fun ApplicationCall.branchOrDefault(explicit: String? = null): String {
    val ctx = erpAuth
    val b = explicit ?: request.queryParameters["branch"] ?: ctx.defaultBranchId ?: ctx.branches.firstOrNull()?.id
        ?: throw ErpException.badRequest("No tienes una sucursal asignada.", "NO_BRANCH")
    if (!ctx.canAccessBranch(b)) throw ErpException.forbidden("No tienes acceso a esa sucursal.")
    return b
}
