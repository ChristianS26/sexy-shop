package com.sexyshop.config

data class AppConfig(
    val supabaseUrl: String,
    val supabaseApiKey: String,
    val supabaseBucket: String,
    val mpAccessToken: String,
    val mpPublicKey: String,
    val mpWebhookSecret: String,
    val mpTestAccessToken: String,
    val mpTestPublicKey: String,
    val mpTestMode: Boolean,
    val resendApiKey: String,
    val notificationEmail: String,
    val frontendUrl: String,
    val backendUrl: String,
    val epackApiKey: String,
    val enviaApiKey: String,
    val shipperZip: String,
)
