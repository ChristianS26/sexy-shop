package com.sexyshop.plugins

import com.sexyshop.erp.core.ErpException
import com.sexyshop.erp.core.ErrorBody
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.plugins.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.plugins.statuspages.*
import io.ktor.server.response.*
import kotlinx.serialization.json.Json

fun Application.configureSerialization() {
    install(ContentNegotiation) {
        json(Json {
            prettyPrint = false
            isLenient = true
            ignoreUnknownKeys = true
            encodeDefaults = true
        })
    }

    install(StatusPages) {
        // Errores de negocio del ERP: código estable + mensaje legible, nunca detalles técnicos
        exception<ErpException> { call, cause ->
            call.respond(cause.status, ErrorBody(cause.message, cause.code, cause.details))
        }
        exception<BadRequestException> { call, _ ->
            call.respond(HttpStatusCode.BadRequest, ErrorBody("Los datos enviados no son válidos.", "BAD_REQUEST"))
        }
        exception<IllegalArgumentException> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to (cause.message ?: "Bad request")))
        }
        exception<NoSuchElementException> { call, cause ->
            call.respond(HttpStatusCode.NotFound, mapOf("error" to (cause.message ?: "Not found")))
        }
        exception<Exception> { call, cause ->
            call.application.log.error("Unhandled exception on ${call.request.local.method.value} ${call.request.local.uri}", cause)
            if (call.request.local.uri.startsWith("/api/erp")) {
                call.respond(HttpStatusCode.InternalServerError, ErrorBody("Algo salió mal de nuestro lado. Intenta de nuevo en un momento.", "INTERNAL"))
            } else {
                call.respond(HttpStatusCode.InternalServerError, mapOf("error" to "Internal server error"))
            }
        }
    }
}
