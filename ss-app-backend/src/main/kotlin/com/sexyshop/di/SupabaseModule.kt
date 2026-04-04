package com.sexyshop.di

import com.sexyshop.config.AppConfig
import com.sexyshop.config.SupabaseConfig
import com.sexyshop.infrastructure.supabase.createSupabase
import org.koin.dsl.module

val supabaseModule = module {
    single {
        AppConfig(
            supabaseUrl = System.getenv("SUPABASE_URL") ?: error("SUPABASE_URL not set"),
            supabaseApiKey = System.getenv("SUPABASE_API_KEY") ?: error("SUPABASE_API_KEY not set"),
            supabaseBucket = System.getenv("SUPABASE_STORAGE_BUCKET") ?: "product-images",
            mpAccessToken = System.getenv("MP_ACCESS_TOKEN") ?: "",
            mpPublicKey = System.getenv("MP_PUBLIC_KEY") ?: "",
            mpWebhookSecret = System.getenv("MP_WEBHOOK_SECRET") ?: "",
            mpTestAccessToken = System.getenv("MP_TEST_ACCESS_TOKEN") ?: "",
            mpTestPublicKey = System.getenv("MP_TEST_PUBLIC_KEY") ?: "",
            mpTestMode = System.getenv("MP_TEST_MODE")?.toBooleanStrictOrNull() ?: false,
            resendApiKey = System.getenv("RESEND_API_KEY") ?: "",
            notificationEmail = System.getenv("NOTIFICATION_EMAIL") ?: "sexyshopguaymas@gmail.com",
            frontendUrl = System.getenv("FRONTEND_URL") ?: "https://christians26.github.io/sexy-shop",
            backendUrl = System.getenv("BACKEND_URL") ?: "https://ss-app-backend-production.up.railway.app",
            epackApiKey = System.getenv("EPACK_API_KEY") ?: "",
            shipperZip = System.getenv("SHIPPER_ZIP") ?: "85400",
        )
    }

    single {
        val app = get<AppConfig>()
        SupabaseConfig(
            url = app.supabaseUrl,
            apiKey = app.supabaseApiKey,
            storageBucket = app.supabaseBucket,
        )
    }

    single { createSupabase(get()) }
}
