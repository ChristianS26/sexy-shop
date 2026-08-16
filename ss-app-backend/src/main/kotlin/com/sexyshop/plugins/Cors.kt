package com.sexyshop.plugins

import com.sexyshop.config.FrontendOrigins
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.plugins.cors.routing.*

fun Application.configureCors() {
    install(CORS) {
        // La lista vive en FrontendOrigins para no repetirla: la misma que
        // valida las back_urls de Mercado Pago.
        FrontendOrigins.asSchemeAndHost().forEach { (scheme, host) ->
            allowHost(host, schemes = listOf(scheme))
        }
        allowHeader(HttpHeaders.ContentType)
        allowHeader(HttpHeaders.Authorization)
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
        allowMethod(HttpMethod.Options)
    }
}
