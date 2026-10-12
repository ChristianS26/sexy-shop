package com.sexyshop.plugins

import com.sexyshop.erp.core.ErpAuth
import com.sexyshop.erp.core.TokenVerifier
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.Serializable
import org.koin.core.context.GlobalContext

@Serializable
private data class ProfileCheck(val role: String)

private val verifiedRoles = java.util.concurrent.ConcurrentHashMap<String, Pair<Boolean, Long>>()
private const val CACHE_DURATION_MS = 5 * 60 * 1000L

/**
 * Guardia del admin legado y de las rutas de imágenes. Antes solo decodificaba el payload del
 * JWT sin verificar la firma: cualquiera podía forjar un token. Ahora la verificación la hace
 * GoTrue ([TokenVerifier]). Acepta a quien tenga `profiles.role = admin` (admin legado) o a un
 * usuario del ERP con permiso de edición de productos.
 */
suspend fun RoutingCall.requireAdmin(supabase: SupabaseClient): Boolean {
    val authHeader = request.headers["Authorization"]
    if (authHeader == null || !authHeader.startsWith("Bearer ")) {
        respond(HttpStatusCode.Unauthorized, mapOf("error" to "Authentication required"))
        return false
    }
    val token = authHeader.removePrefix("Bearer ").trim()

    verifiedRoles[token]?.let { (ok, at) ->
        if (System.currentTimeMillis() - at < CACHE_DURATION_MS) {
            if (ok) return true
            respond(HttpStatusCode.Forbidden, mapOf("error" to "Admin access required")); return false
        }
    }

    val koin = GlobalContext.get()
    val verifier = koin.get<TokenVerifier>()
    val userId = verifier.verify(token)?.first
    if (userId == null) {
        respond(HttpStatusCode.Unauthorized, mapOf("error" to "Invalid token"))
        return false
    }

    val isLegacyAdmin = runCatching {
        supabase.from("profiles").select(columns = io.github.jan.supabase.postgrest.query.Columns.list("role")) { filter { eq("id", userId) } }
            .decodeList<ProfileCheck>().firstOrNull()?.role == "admin"
    }.getOrDefault(false)
    val isErpEditor = if (isLegacyAdmin) true else runCatching {
        koin.get<ErpAuth>().contextFor(userId)?.let { it.status == "ACTIVE" && it.hasAny("products.update", "products.create") } ?: false
    }.getOrDefault(false)

    val ok = isLegacyAdmin || isErpEditor
    if (verifiedRoles.size > 200) { val now = System.currentTimeMillis(); verifiedRoles.entries.removeIf { now - it.value.second > CACHE_DURATION_MS } }
    verifiedRoles[token] = ok to System.currentTimeMillis()
    if (!ok) {
        respond(HttpStatusCode.Forbidden, mapOf("error" to "Admin access required"))
        return false
    }
    return true
}
