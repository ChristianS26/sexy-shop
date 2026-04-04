package com.sexyshop.di

import com.sexyshop.repositories.shipment.ShipmentRepository
import com.sexyshop.repositories.shipment.ShipmentRepositoryImpl
import org.koin.dsl.module

val shipmentModule = module {
    single<ShipmentRepository> { ShipmentRepositoryImpl(get()) }
}
