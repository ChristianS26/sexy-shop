package com.sexyshop.repositories.order

import com.sexyshop.models.order.Order
import com.sexyshop.models.order.OrderItem

interface OrderRepository {
    suspend fun getAll(status: String? = null): List<Order>
    suspend fun getById(id: String): Order?
    suspend fun create(order: Order): Order
    suspend fun updateStatus(id: String, status: String): Order
    suspend fun createItems(items: List<OrderItem>)
    suspend fun getItemsByOrderId(orderId: String): List<OrderItem>
}
