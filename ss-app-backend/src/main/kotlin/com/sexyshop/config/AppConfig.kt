package com.sexyshop.config

data class AppConfig(
    val supabaseUrl: String,
    val supabaseApiKey: String,
    val supabaseBucket: String,
    val mpAccessToken: String,
    val mpPublicKey: String,
    val frontendUrl: String,
)
