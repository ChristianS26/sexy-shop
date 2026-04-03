package com.sexyshop.di

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
}
