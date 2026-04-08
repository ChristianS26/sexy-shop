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
    companion object {
        const val LOCAL_SHIPPING_COST = 60.0
        const val LOCAL_FREE_THRESHOLD = 400.0
        const val NATIONAL_SHIPPING_COST = 99.0

        /**
         * Server-side shipping calculation. Single source of truth — never trust
         * a shipping cost sent from the client. Rules:
         *  - local: 0 if subtotal >= 400, else 60
         *  - national: 99 (flat)
         */
        fun calculateShipping(deliveryMethod: String, subtotal: Double): Double = when (deliveryMethod) {
            "local" -> if (subtotal >= LOCAL_FREE_THRESHOLD) 0.0 else LOCAL_SHIPPING_COST
            "national" -> NATIONAL_SHIPPING_COST
            else -> NATIONAL_SHIPPING_COST
        }
    }

    suspend fun getAll(status: String? = null): List<Order> = orderRepository.getAll(status)

    suspend fun getById(id: String): Pair<Order, List<OrderItem>> {
        val order = orderRepository.getById(id)
            ?: throw NoSuchElementException("Order not found: $id")
        val items = orderRepository.getItemsByOrderId(id)
        return order to items
    }

    suspend fun create(request: OrderRequest): Order {
        // Validate required input fields
        require(request.customerName.isNotBlank()) { "Customer name required" }
        require(request.customerPhone.isNotBlank()) { "Customer phone required" }
        require(request.items.isNotEmpty()) { "At least one item required" }
        if (!request.customerEmail.isNullOrBlank()) {
            require(request.customerEmail.matches(Regex("^[^@\\s]{1,64}@[^@\\s]{1,255}$"))) { "Invalid email format" }
        }
        require(request.deliveryMethod in setOf("local", "national")) {
            "Invalid delivery_method: ${request.deliveryMethod}"
        }
        require(request.paymentMethod in setOf("cash", "transfer", "mp")) {
            "Invalid payment_method: ${request.paymentMethod}"
        }
        // Cash and transfer are only allowed for local deliveries
        if (request.paymentMethod in setOf("cash", "transfer")) {
            require(request.deliveryMethod == "local") {
                "Cash/transfer payment is only available for local deliveries"
            }
        }
        request.items.forEach { item ->
            require(item.quantity > 0) { "Quantity must be positive" }
        }

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

        val itemsSubtotal = orderItems.sumOf { it.subtotal }
        // Server-side calculation — never trust client values
        val shippingCost = calculateShipping(request.deliveryMethod, itemsSubtotal)
        val total = itemsSubtotal + shippingCost

        // Deduct stock
        products.forEach { (product, qty) ->
            productRepository.updateStock(product.id, product.stock - qty)
        }

        val order = orderRepository.create(
            Order(
                customerName = request.customerName,
                customerPhone = request.customerPhone,
                customerEmail = request.customerEmail,
                customerAddress = request.customerAddress,
                customerStreet = request.customerStreet,
                customerExtNum = request.customerExtNum,
                customerIntNum = request.customerIntNum,
                customerNeighborhood = request.customerNeighborhood,
                customerCity = request.customerCity,
                customerState = request.customerState,
                customerZip = request.customerZip,
                customerReferences = request.customerReferences,
                total = total,
                shippingCost = shippingCost,
                deliveryMethod = request.deliveryMethod,
                paymentMethod = request.paymentMethod,
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
