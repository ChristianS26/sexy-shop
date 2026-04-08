package com.sexyshop.di

import com.sexyshop.repositories.product.ProductRepository
import com.sexyshop.repositories.product.ProductRepositoryImpl
import com.sexyshop.services.product.ProductService
import org.koin.dsl.module

val productModule = module {
    single<ProductRepository> { ProductRepositoryImpl(get()) }
    single { ProductService(get(), get(), get()) }
}
