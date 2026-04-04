package com.sexyshop.repositories.shipment

import com.sexyshop.models.shipment.Shipment

interface ShipmentRepository {
    suspend fun getAll(): List<Shipment>
    suspend fun getByOrderId(orderId: String): Shipment?
    suspend fun create(shipment: Shipment): Shipment
}
