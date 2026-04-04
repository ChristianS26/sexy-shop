package com.sexyshop.services.order

import com.sexyshop.models.order.Order
import com.sexyshop.models.order.OrderEvent
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
        // Look up products, validate stock, and calculate totals
        val products = request.items.map { itemReq ->
            val product = productRepository.getById(itemReq.productId)
                ?: throw NoSuchElementException("Producto no encontrado: ${itemReq.productId}")
            require(product.isActive) { "Producto no disponible: ${product.name}" }
            require(product.stock >= itemReq.quantity) {
                "Stock insuficiente para ${product.name}. Disponible: ${product.stock}, solicitado: ${itemReq.quantity}"
            }
            product to itemReq.quantity
        }

        val orderItems = products.map { (product, qty) ->
            OrderItem(
                productId = product.id,
                productName = product.name,
                quantity = qty,
                unitPrice = product.price,
                subtotal = product.price * qty,
            )
        }

        val total = orderItems.sumOf { it.subtotal }

        // Deduct stock
        products.forEach { (product, qty) ->
            productRepository.updateStock(product.id, product.stock - qty)
        }

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

        // Log creation event
        orderRepository.createEvent(OrderEvent(
            orderId = order.id,
            eventType = "created",
            newValue = "pending",
            description = "Pedido creado",
        ))

        return order
    }

    suspend fun updateStatus(id: String, status: String): Order {
        val validStatuses = setOf("pending", "confirmed", "shipped", "delivered", "cancelled")
        require(status in validStatuses) { "Estado inválido: $status" }

        val (currentOrder, items) = getById(id)

        // Restore stock when cancelling
        if (status == "cancelled" && currentOrder.status != "cancelled") {
            items.forEach { item ->
                if (item.productId != null) {
                    val product = productRepository.getById(item.productId)
                    if (product != null) {
                        productRepository.updateStock(product.id, product.stock + item.quantity)
                    }
                }
            }
        }

        val updatedOrder = orderRepository.updateStatus(id, status)

        // Log status change event
        orderRepository.createEvent(OrderEvent(
            orderId = id,
            eventType = "status_change",
            oldValue = currentOrder.status,
            newValue = status,
            description = "Estado cambiado de ${currentOrder.status} a ${status}",
        ))

        return updatedOrder
    }

    suspend fun updateNotes(id: String, notes: String): Order {
        orderRepository.updateNotes(id, notes)
        orderRepository.createEvent(OrderEvent(
            orderId = id,
            eventType = "note_added",
            description = "Notas actualizadas",
        ))
        return orderRepository.getById(id) ?: throw NoSuchElementException("Order not found: $id")
    }

    suspend fun getTimeline(orderId: String): List<OrderEvent> {
        return orderRepository.getEventsByOrderId(orderId)
    }
}
