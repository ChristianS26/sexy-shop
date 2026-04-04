package com.sexyshop.plugins

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
private data class ProfileCheck(val role: String)

private val verifiedTokens = java.util.concurrent.ConcurrentHashMap<String, Pair<String, Long>>()
private const val CACHE_DURATION_MS = 5 * 60 * 1000L // 5 minutes

suspend fun RoutingCall.requireAdmin(supabase: SupabaseClient): Boolean {
    val authHeader = request.headers["Authorization"]
    if (authHeader == null || !authHeader.startsWith("Bearer ")) {
        respond(HttpStatusCode.Unauthorized, mapOf("error" to "Authentication required"))
        return false
    }

    val token = authHeader.removePrefix("Bearer ").trim()

    // Check cache first
    val cached = verifiedTokens[token]
    if (cached != null && System.currentTimeMillis() - cached.second < CACHE_DURATION_MS) {
        if (cached.first == "admin") return true
        respond(HttpStatusCode.Forbidden, mapOf("error" to "Admin access required"))
        return false
    }

    try {
        // Decode JWT payload to get user ID
        val parts = token.split(".")
        if (parts.size != 3) {
            respond(HttpStatusCode.Unauthorized, mapOf("error" to "Invalid token"))
            return false
        }

        val payload = String(java.util.Base64.getUrlDecoder().decode(parts[1]))
        val json = Json.parseToJsonElement(payload).jsonObject
        val userId = json["sub"]?.jsonPrimitive?.content
        val exp = json["exp"]?.jsonPrimitive?.long

        if (userId == null) {
            respond(HttpStatusCode.Unauthorized, mapOf("error" to "Invalid token"))
            return false
        }

        // Check expiration
        if (exp != null && exp < System.currentTimeMillis() / 1000) {
            respond(HttpStatusCode.Unauthorized, mapOf("error" to "Token expired"))
            return false
        }

        // Verify user exists and is admin (using service_role key via Supabase client)
        val profiles = supabase.from("profiles")
            .select(columns = io.github.jan.supabase.postgrest.query.Columns.list("role")) {
                filter { eq("id", userId) }
            }
            .decodeList<ProfileCheck>()

        val profile = profiles.firstOrNull()
        val role = profile?.role ?: "none"

        // Cache the result
        verifiedTokens[token] = role to System.currentTimeMillis()

        // Clean old entries periodically
        if (verifiedTokens.size > 100) {
            val now = System.currentTimeMillis()
            verifiedTokens.entries.removeIf { now - it.value.second > CACHE_DURATION_MS }
        }

        if (role != "admin") {
            respond(HttpStatusCode.Forbidden, mapOf("error" to "Admin access required"))
            return false
        }

        return true
    } catch (e: Exception) {
        respond(HttpStatusCode.Unauthorized, mapOf("error" to "Authentication failed"))
        return false
    }
}
