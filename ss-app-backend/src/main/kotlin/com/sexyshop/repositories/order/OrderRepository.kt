package com.sexyshop.repositories.order

import com.sexyshop.models.order.Order
import com.sexyshop.models.order.OrderEvent
import com.sexyshop.models.order.OrderItem

interface OrderRepository {
    suspend fun getAll(status: String? = null): List<Order>
    suspend fun getById(id: String): Order?
    suspend fun create(order: Order): Order
    suspend fun updateStatus(id: String, status: String): Order
    suspend fun createItems(items: List<OrderItem>)
    suspend fun getItemsByOrderId(orderId: String): List<OrderItem>
    suspend fun updateNotes(id: String, notes: String)
    suspend fun createEvent(event: OrderEvent)
    suspend fun getEventsByOrderId(orderId: String): List<OrderEvent>
}
