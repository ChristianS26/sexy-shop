package com.sexyshop.plugins

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.plugins.cors.routing.*

fun Application.configureCors() {
    install(CORS) {
        allowHost("christians26.github.io", schemes = listOf("https"))
        allowHost("ss-app-backend-production.up.railway.app", schemes = listOf("https"))
        allowHost("localhost:8080", schemes = listOf("http"))
        allowHeader(HttpHeaders.ContentType)
        allowHeader(HttpHeaders.Authorization)
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
        allowMethod(HttpMethod.Options)
    }
}
