package com.sexyshop.routing.settings

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.Serializable

@Serializable
data class Setting(val key: String, val value: String)

@Serializable
data class SettingUpdate(val value: String)

fun Route.settingsRoutes(supabase: SupabaseClient) {
    route("/settings") {
        get("/{key}") {
            val key = call.parameters["key"]!!
            val result = supabase.from("settings")
                .select { filter { eq("key", key) } }
                .decodeSingleOrNull<Setting>()

            if (result != null) {
                call.respond(result)
            } else {
                call.respond(HttpStatusCode.NotFound, mapOf("error" to "Setting not found"))
            }
        }

        put("/{key}") {
            val key = call.parameters["key"]!!
            val update = call.receive<SettingUpdate>()

            supabase.from("settings")
                .update(mapOf("value" to update.value)) {
                    filter { eq("key", key) }
                }

            call.respond(Setting(key = key, value = update.value))
        }
    }
}
