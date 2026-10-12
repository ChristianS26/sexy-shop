package com.sexyshop.erp.core

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.plugins.*
import io.ktor.server.request.*
import io.ktor.util.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

/**
 * Contexto de autenticación de una petición al ERP. Lo construye [ErpAuth] a partir de
 * la función SQL `auth_context(user_id)` y vive en los atributos del call.
 */
data class AuthContext(
    val userId: String,
    val organizationId: String,
    val firstName: String,
    val lastName: String,
    val email: String,
    val username: String,
    val status: String,
    val defaultBranchId: String?,
    val roles: List<RoleRef>,
    val permissions: Set<String>,
    val branches: List<BranchRef>,
    /** null = sin límite */
    val maxDiscountPct: Double?,
    val organization: JsonObject,
    val raw: JsonObject,
) {
    val fullName get() = listOf(firstName, lastName).filter { it.isNotBlank() }.joinToString(" ")
    val timezone get() = organization["timezone"]?.jsonPrimitive?.contentOrNull ?: "America/Hermosillo"
    fun has(permission: String) = permission in permissions
    fun hasAny(vararg perms: String) = perms.any { it in permissions }
    fun canAccessBranch(branchId: String) = branches.any { it.id == branchId } || hasAny("branches.manage", "settings.system")
    val isSuperAdmin get() = roles.any { it.code == "SUPER_ADMIN" }

    companion object {
        fun fromJson(j: JsonObject): AuthContext {
            val u = j["user"]!!.jsonObject
            return AuthContext(
                userId = u["id"]!!.jsonPrimitive.content,
                organizationId = u["organization_id"]!!.jsonPrimitive.content,
                firstName = u["first_name"]?.jsonPrimitive?.contentOrNull ?: "",
                lastName = u["last_name"]?.jsonPrimitive?.contentOrNull ?: "",
                email = u["email"]?.jsonPrimitive?.contentOrNull ?: "",
                username = u["username"]?.jsonPrimitive?.contentOrNull ?: "",
                status = u["status"]?.jsonPrimitive?.contentOrNull ?: "ACTIVE",
                defaultBranchId = u["default_branch_id"]?.jsonPrimitive?.contentOrNull,
                roles = j["roles"]?.jsonArray?.map { r ->
                    val o = r.jsonObject
                    RoleRef(o["id"]!!.jsonPrimitive.content, o["code"]!!.jsonPrimitive.content, o["name"]!!.jsonPrimitive.content, o["max_discount_pct"]?.jsonPrimitive?.doubleOrNull)
                } ?: emptyList(),
                permissions = j["permissions"]?.jsonArray?.map { it.jsonPrimitive.content }?.toSet() ?: emptySet(),
                branches = j["branches"]?.jsonArray?.map { b ->
                    val o = b.jsonObject
                    BranchRef(o["id"]!!.jsonPrimitive.content, o["code"]!!.jsonPrimitive.content, o["name"]!!.jsonPrimitive.content)
                } ?: emptyList(),
                maxDiscountPct = j["max_discount_pct"]?.jsonPrimitive?.doubleOrNull,
                organization = j["organization"]?.jsonObject ?: JsonObject(emptyMap()),
                raw = j,
            )
        }
    }
}

@Serializable data class RoleRef(val id: String, val code: String, val name: String, val maxDiscountPct: Double? = null)
@Serializable data class BranchRef(val id: String, val code: String, val name: String)

val AuthContextKey = AttributeKey<AuthContext>("erp.auth")
val ApplicationCall.erpAuth: AuthContext get() = attributes[AuthContextKey]
val ApplicationCall.erpAuthOrNull: AuthContext? get() = attributes.getOrNull(AuthContextKey)
val ApplicationCall.clientIp: String get() = request.headers["X-Forwarded-For"]?.split(",")?.firstOrNull()?.trim() ?: request.origin.remoteHost

/**
 * Error de negocio con código estable (para el frontend) y mensaje legible para la persona.
 * Nunca lleva detalles técnicos: esos van al log.
 */
class ErpException(
    val status: HttpStatusCode,
    val code: String,
    override val message: String,
    val details: JsonElement? = null,
) : RuntimeException(message) {
    companion object {
        fun badRequest(message: String, code: String = "BAD_REQUEST", details: JsonElement? = null) = ErpException(HttpStatusCode.BadRequest, code, message, details)
        fun notFound(message: String = "No encontramos lo que buscas.") = ErpException(HttpStatusCode.NotFound, "NOT_FOUND", message)
        fun forbidden(message: String = "No tienes permiso para realizar esta acción.") = ErpException(HttpStatusCode.Forbidden, "FORBIDDEN", message)
        fun unauthorized(message: String = "Tu sesión no es válida. Inicia sesión de nuevo.") = ErpException(HttpStatusCode.Unauthorized, "UNAUTHORIZED", message)
        fun conflict(message: String, code: String = "CONFLICT") = ErpException(HttpStatusCode.Conflict, code, message)
    }
}

@Serializable
data class ErrorBody(val error: String, val code: String, val details: JsonElement? = null)

@Serializable
data class Paged<T>(val data: List<T>, val page: Int, val size: Int, val total: Long, val pages: Int)

/** Parámetros de paginación/orden server-side. */
data class PageQuery(val page: Int, val size: Int, val sort: String?, val desc: Boolean, val q: String?) {
    val from get() = (page - 1) * size
    val to get() = from + size - 1
    companion object {
        fun from(call: ApplicationCall, defaultSort: String? = null, defaultDesc: Boolean = true, maxSize: Int = 200): PageQuery {
            val p = call.request.queryParameters
            val page = p["page"]?.toIntOrNull()?.coerceAtLeast(1) ?: 1
            val size = p["size"]?.toIntOrNull()?.coerceIn(1, maxSize) ?: 25
            val sortRaw = p["sort"]?.takeIf { it.isNotBlank() }
            val desc = when {
                sortRaw == null -> defaultDesc
                sortRaw.startsWith("-") -> true
                p["dir"] != null -> p["dir"].equals("desc", true)
                else -> false
            }
            val sort = sortRaw?.removePrefix("-") ?: defaultSort
            return PageQuery(page, size, sort, desc, p["q"]?.trim()?.takeIf { it.isNotEmpty() })
        }
    }
}

fun <T> paged(data: List<T>, q: PageQuery, total: Long) = Paged(data, q.page, q.size, total, if (total == 0L) 0 else ((total + q.size - 1) / q.size).toInt())

/** Lectura segura del cuerpo JSON con mensajes amables. */
suspend inline fun <reified T : Any> ApplicationCall.receiveOrThrow(): T = try {
    receive<T>()
} catch (e: ErpException) {
    throw e
} catch (e: Exception) {
    throw ErpException.badRequest("Los datos enviados no son válidos.", "INVALID_BODY")
}

fun ApplicationCall.requiredParam(name: String): String =
    parameters[name]?.takeIf { it.isNotBlank() } ?: throw ErpException.badRequest("Falta el parámetro $name.")

fun String?.uuidOrNull(): String? = this?.takeIf { Regex("^[0-9a-fA-F-]{36}$").matches(it) }
fun String?.requireUuid(field: String): String = this.uuidOrNull() ?: throw ErpException.badRequest("El campo $field no es válido.")

// --- Validación ligera -------------------------------------------------------
class Validator {
    private val errors = mutableMapOf<String, String>()
    fun require(cond: Boolean, field: String, message: String) { if (!cond) errors.putIfAbsent(field, message) }
    fun notBlank(value: String?, field: String, label: String = field) = require(!value.isNullOrBlank(), field, "$label es obligatorio.")
    fun positive(value: Double?, field: String, label: String = field) = require(value != null && value > 0, field, "$label debe ser mayor a 0.")
    fun nonNegative(value: Double?, field: String, label: String = field) = require(value == null || value >= 0, field, "$label no puede ser negativo.")
    fun email(value: String?, field: String = "email") = require(value.isNullOrBlank() || Regex("^[^@\\s]{1,64}@[^@\\s]{1,255}$").matches(value!!), field, "El correo no es válido.")
    fun maxLen(value: String?, max: Int, field: String, label: String = field) = require(value == null || value.length <= max, field, "$label no puede exceder $max caracteres.")
    fun oneOf(value: String?, allowed: Collection<String>, field: String, label: String = field) = require(value == null || value in allowed, field, "$label no es válido.")
    fun throwIfInvalid() {
        if (errors.isNotEmpty()) throw ErpException(
            HttpStatusCode.UnprocessableEntity, "VALIDATION",
            errors.values.first(),
            JsonObject(errors.mapValues { JsonPrimitive(it.value) }),
        )
    }
}

inline fun validate(block: Validator.() -> Unit) = Validator().apply(block).throwIfInvalid()

// --- JSON helpers --------------------------------------------------------------
val erpJson = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true; isLenient = true }

fun JsonObject.str(key: String): String? = this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.contentOrNull }
fun JsonObject.dbl(key: String): Double? = this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.doubleOrNull }
fun JsonObject.int(key: String): Int? = this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.intOrNull }
fun JsonObject.bool(key: String): Boolean? = this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.booleanOrNull }
fun JsonObject.obj(key: String): JsonObject? = this[key]?.let { if (it is JsonObject) it else null }
fun JsonObject.arr(key: String): JsonArray? = this[key]?.let { if (it is JsonArray) it else null }

fun jsonOf(vararg pairs: Pair<String, Any?>): JsonObject = buildJsonObject {
    pairs.forEach { (k, v) -> put(k, v.toJsonElement()) }
}

fun Any?.toJsonElement(): JsonElement = when (this) {
    null -> JsonNull
    is JsonElement -> this
    is String -> JsonPrimitive(this)
    is Number -> JsonPrimitive(this)
    is Boolean -> JsonPrimitive(this)
    is Map<*, *> -> JsonObject(entries.associate { (k, v) -> k.toString() to v.toJsonElement() })
    is Iterable<*> -> JsonArray(map { it.toJsonElement() })
    is Array<*> -> JsonArray(map { it.toJsonElement() })
    else -> JsonPrimitive(toString())
}

/** Quita campos restringidos (costo/margen) cuando el usuario no tiene permiso. */
fun JsonObject.stripCost(auth: AuthContext): JsonObject =
    if (auth.has("products.cost.read")) this
    else JsonObject(filterKeys { it !in COST_FIELDS })

val COST_FIELDS = setOf("cost_price", "unit_cost", "total_cost", "margin", "margin_pct", "gross_profit", "cogs", "stock_value", "net_revenue")
