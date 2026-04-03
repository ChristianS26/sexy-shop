package com.sexyshop.services.order

import com.sexyshop.models.order.Order
import com.sexyshop.models.order.OrderItem
import com.sexyshop.models.order.OrderRequest
import com.sexyshop.repositories.order.OrderRepository
import com.sexyshop.repositories.product.ProductRepository

class OrderService(
    private val orderRepository: OrderRepository,
    private val productRepository: ProductRepository,
) {
    suspend fun getAll(status: String? = null): List<Order> = orderRepository.getAll(status)

    suspend fun getById(id: String): Pair<Order, List<OrderItem>> {
        val order = orderRepository.getById(id)
            ?: throw NoSuchElementException("Order not found: $id")
        val items = orderRepository.getItemsByOrderId(id)
        return order to items
    }

    suspend fun create(request: OrderRequest): Order {
        // Look up products and calculate totals
        val orderItems = request.items.map { itemReq ->
            val product = productRepository.getById(itemReq.productId)
                ?: throw NoSuchElementException("Product not found: ${itemReq.productId}")
            OrderItem(
                productId = product.id,
                productName = product.name,
                quantity = itemReq.quantity,
                unitPrice = product.price,
                subtotal = product.price * itemReq.quantity,
            )
        }

        val total = orderItems.sumOf { it.subtotal }

        val order = orderRepository.create(
            Order(
                customerName = request.customerName,
                customerPhone = request.customerPhone,
                customerAddress = request.customerAddress,
                total = total,
                notes = request.notes,
            )
        )

        val itemsWithOrderId = orderItems.map { it.copy(orderId = order.id) }
        orderRepository.createItems(itemsWithOrderId)

        return order
    }

    suspend fun updateStatus(id: String, status: String): Order {
        val validStatuses = setOf("pending", "confirmed", "shipped", "delivered", "cancelled")
        require(status in validStatuses) { "Invalid status: $status. Valid: $validStatuses" }
        return orderRepository.updateStatus(id, status)
    }
}
