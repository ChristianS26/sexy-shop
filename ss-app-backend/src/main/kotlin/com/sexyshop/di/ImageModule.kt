package com.sexyshop.di

import com.sexyshop.repositories.image.ImageRepository
import com.sexyshop.repositories.image.ImageRepositoryImpl
import com.sexyshop.services.image.ImageService
import org.koin.dsl.module

val imageModule = module {
    single<ImageRepository> { ImageRepositoryImpl(get()) }
    single { ImageService(get(), get(), get()) }
}
