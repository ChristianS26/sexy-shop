package com.sexyshop.infrastructure.supabase

import com.sexyshop.config.SupabaseConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.storage.Storage

fun createSupabase(config: SupabaseConfig): SupabaseClient {
    return createSupabaseClient(
        supabaseUrl = config.url,
        supabaseKey = config.apiKey,
    ) {
        install(Postgrest)
        install(Storage)
    }
}
