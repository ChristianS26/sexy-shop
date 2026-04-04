package com.sexyshop.di

import com.sexyshop.services.email.EmailService
import kotlinx.serialization.json.Json
import org.koin.dsl.module

val coreModule = module {
    single {
        Json {
            prettyPrint = true
            isLenient = true
            ignoreUnknownKeys = true
        }
    }

    single { EmailService(get()) }
}
