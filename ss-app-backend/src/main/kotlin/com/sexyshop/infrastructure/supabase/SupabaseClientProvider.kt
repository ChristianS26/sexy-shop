package com.sexyshop.infrastructure.supabase

import com.sexyshop.config.SupabaseConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.storage.Storage
import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.*
import io.ktor.http.*

fun createSupabase(config: SupabaseConfig): SupabaseClient {
    return createSupabaseClient(
        supabaseUrl = config.url,
        supabaseKey = config.apiKey,
    ) {
        install(Postgrest)
        install(Storage)
        httpEngine = CIO.create()
        defaultRequest {
            headers.append(HttpHeaders.ContentType, "application/json; charset=utf-8")
        }
    }
}
