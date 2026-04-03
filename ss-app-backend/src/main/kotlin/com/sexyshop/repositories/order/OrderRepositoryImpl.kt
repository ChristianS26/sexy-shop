package com.sexyshop.repositories.order

import com.sexyshop.models.order.Order
import com.sexyshop.models.order.OrderItem
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order as QueryOrder

class OrderRepositoryImpl(
    private val supabase: SupabaseClient,
) : OrderRepository {

    override suspend fun getAll(status: String?): List<Order> {
        return supabase.from("orders")
            .select {
                if (status != null) {
                    filter { eq("status", status) }
                }
                order("created_at", QueryOrder.DESCENDING)
            }
            .decodeList<Order>()
    }

    override suspend fun getById(id: String): Order? {
        return supabase.from("orders")
            .select {
                filter { eq("id", id) }
            }
            .decodeSingleOrNull<Order>()
    }

    override suspend fun create(order: Order): Order {
        supabase.from("orders").insert(order)
        return supabase.from("orders")
            .select {
                order("created_at", QueryOrder.DESCENDING)
                limit(1)
            }
            .decodeSingle<Order>()
    }

    override suspend fun updateStatus(id: String, status: String): Order {
        supabase.from("orders")
            .update(mapOf("status" to status)) {
                filter { eq("id", id) }
            }
        return supabase.from("orders")
            .select {
                filter { eq("id", id) }
            }
            .decodeSingle<Order>()
    }

    override suspend fun createItems(items: List<OrderItem>) {
        supabase.from("order_items")
            .insert(items)
    }

    override suspend fun getItemsByOrderId(orderId: String): List<OrderItem> {
        return supabase.from("order_items")
            .select {
                filter { eq("order_id", orderId) }
            }
            .decodeList<OrderItem>()
    }
}
