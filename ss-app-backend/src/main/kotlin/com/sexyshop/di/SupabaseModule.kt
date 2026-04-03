package com.sexyshop.di

import com.sexyshop.config.SupabaseConfig
import com.sexyshop.infrastructure.supabase.createSupabase
import org.koin.dsl.module

val supabaseModule = module {
    single {
        SupabaseConfig(
            url = System.getenv("SUPABASE_URL") ?: error("SUPABASE_URL not set"),
            apiKey = System.getenv("SUPABASE_API_KEY") ?: error("SUPABASE_API_KEY not set"),
            storageBucket = System.getenv("SUPABASE_STORAGE_BUCKET") ?: "product-images",
        )
    }

    single { createSupabase(get()) }
}
