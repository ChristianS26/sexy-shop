package com.sexyshop.repositories.shipment

import com.sexyshop.models.shipment.Shipment
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order

class ShipmentRepositoryImpl(
    private val supabase: SupabaseClient,
) : ShipmentRepository {

    override suspend fun getAll(): List<Shipment> {
        return supabase.from("shipments")
            .select()
            .decodeList<Shipment>()
    }

    override suspend fun getByOrderId(orderId: String): Shipment? {
        return supabase.from("shipments")
            .select {
                filter { eq("order_id", orderId) }
                order("created_at", Order.DESCENDING)
                limit(1)
            }
            .decodeSingleOrNull<Shipment>()
    }

    override suspend fun create(shipment: Shipment): Shipment {
        supabase.from("shipments").insert(shipment)
        return supabase.from("shipments")
            .select {
                filter { eq("order_id", shipment.orderId) }
                order("created_at", Order.DESCENDING)
                limit(1)
            }
            .decodeSingle<Shipment>()
    }
}
