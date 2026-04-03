package com.sexyshop.di

import com.sexyshop.repositories.order.OrderRepository
import com.sexyshop.repositories.order.OrderRepositoryImpl
import com.sexyshop.services.order.OrderService
import org.koin.dsl.module

val orderModule = module {
    single<OrderRepository> { OrderRepositoryImpl(get()) }
    single { OrderService(get(), get()) }
}
