package com.sexyshop

import com.sexyshop.di.*
import com.sexyshop.plugins.configureCors
import com.sexyshop.plugins.configureSerialization
import com.sexyshop.routing.configureRouting
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import org.koin.ktor.plugin.Koin
import org.koin.logger.slf4jLogger

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    embeddedServer(Netty, port = port, module = Application::module)
        .start(wait = true)
}

fun Application.module() {
    install(Koin) {
        slf4jLogger()
        modules(
            coreModule,
            supabaseModule,
            categoryModule,
            productModule,
            orderModule,
            imageModule,
        )
    }

    configureSerialization()
    configureCors()
    configureRouting()
}
