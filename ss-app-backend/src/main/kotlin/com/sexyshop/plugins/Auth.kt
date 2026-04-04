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

suspend fun RoutingCall.requireAdmin(supabase: SupabaseClient): Boolean {
    val authHeader = request.headers["Authorization"]
    if (authHeader == null || !authHeader.startsWith("Bearer ")) {
        respond(HttpStatusCode.Unauthorized, mapOf("error" to "Authentication required"))
        return false
    }

    val token = authHeader.removePrefix("Bearer ").trim()

    // Decode JWT payload (base64) to get user ID
    try {
        val parts = token.split(".")
        if (parts.size != 3) {
            respond(HttpStatusCode.Unauthorized, mapOf("error" to "Invalid token"))
            return false
        }

        // Decode payload
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

        // Check if user is admin in profiles table
        val profiles = supabase.from("profiles")
            .select {
                filter { eq("id", userId) }
            }
            .decodeList<ProfileCheck>()

        val profile = profiles.firstOrNull()
        if (profile == null || profile.role != "admin") {
            respond(HttpStatusCode.Forbidden, mapOf("error" to "Admin access required"))
            return false
        }

        return true
    } catch (e: Exception) {
        respond(HttpStatusCode.Unauthorized, mapOf("error" to "Authentication failed"))
        return false
    }
}
