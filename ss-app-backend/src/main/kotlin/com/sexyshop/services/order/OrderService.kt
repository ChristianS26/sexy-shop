package com.sexyshop.services.order

import com.sexyshop.models.order.Order
import com.sexyshop.models.order.OrderEvent
import com.sexyshop.models.order.OrderItem
import com.sexyshop.models.order.OrderRequest
import com.sexyshop.repositories.order.OrderRepository
import com.sexyshop.repositories.product.ProductRepository
import com.sexyshop.repositories.product.StockInsuficienteException

class OrderService(
    private val orderRepository: OrderRepository,
    private val productRepository: ProductRepository,
) {
    companion object {
        const val LOCAL_SHIPPING_COST = 60.0
        const val LOCAL_FREE_THRESHOLD = 400.0
        const val NATIONAL_SHIPPING_COST = 99.0

        // Válvula SOLO para probar pagos reales de bajo monto: si TODO el
        // carrito son productos con slug "prueba-*", el envío va en cero, así
        // el cargo es exactamente el precio del artículo. Ningún producto real
        // usa ese prefijo, así que no puede filtrarse a una venta de verdad.
        // Para quitarla: borra este bloque, sus dos usos y el producto de prueba.
        const val TEST_SLUG_PREFIX = "prueba-"

        fun esCarritoDePrueba(slugs: List<String>): Boolean =
            slugs.isNotEmpty() && slugs.all { it.startsWith(TEST_SLUG_PREFIX) }

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

    /** ¿Ese pago de Mercado Pago ya generó un pedido? */
    suspend fun existePorPagoMp(mpPaymentId: String): Boolean =
        orderRepository.getByMpPaymentId(mpPaymentId) != null

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

        // Look up products, validate stock, and calculate totals.
        // El stock se valida contra el total pedido del producto y no renglón
        // por renglón, por si el mismo producto llega repetido en el carrito.
        val pedidoPorProducto = request.items.groupBy { it.productId }
            .mapValues { (_, items) -> items.sumOf { it.quantity } }

        val products = request.items.map { itemReq ->
            val product = productRepository.getById(itemReq.productId)
                ?: throw NoSuchElementException("Producto no encontrado: ${itemReq.productId}")
            require(product.isActive) { "Producto no disponible: ${product.name}" }
            val totalPedido = pedidoPorProducto[product.id] ?: itemReq.quantity
            require(product.stock >= totalPedido) {
                "Stock insuficiente para ${product.name}. Disponible: ${product.stock}, solicitado: $totalPedido"
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
        // Server-side calculation — never trust client values. El mismo criterio
        // que en create-preference, para que el total del pedido coincida con
        // lo que Mercado Pago cobró.
        val shippingCost = if (esCarritoDePrueba(products.map { it.first.slug })) 0.0
            else calculateShipping(request.deliveryMethod, itemsSubtotal)
        val total = itemsSubtotal + shippingCost

        // Descuento atómico. Si a mitad del carrito ya no alcanza (otra compra
        // se adelantó entre la validación y esto), se devuelve lo ya descontado
        // y se aborta: peor sería dejar medio pedido cobrado.
        val porProducto = pedidoPorProducto.map { (productId, qty) ->
            products.first { it.first.id == productId }.first to qty
        }
        val descontados = mutableListOf<Pair<String, Int>>()
        try {
            porProducto.forEach { (product, qty) ->
                productRepository.descontarStock(product.id, qty)
                descontados.add(product.id to qty)
            }
        } catch (e: StockInsuficienteException) {
            descontados.forEach { (id, qty) ->
                runCatching { productRepository.devolverStock(id, qty) }
            }
            val agotado = porProducto.firstOrNull { it.first.id == e.productId }?.first?.name ?: "un producto"
            throw IllegalArgumentException("Se acabó el inventario de $agotado mientras completabas la compra")
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
                // Conciliación con MP (los manda el webhook de pagos)
                mpPaymentId = request.mpPaymentId,
                mpFee = request.mpFee,
                mpNet = request.mpNet,
                mpInstallments = request.mpInstallments,
                mpMethod = request.mpMethod,
                termsAcceptedAt = request.termsAcceptedAt,
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

        // Restore stock when cancelling — reposición atómica, sin leer-y-escribir
        if (status == "cancelled" && currentOrder.status != "cancelled") {
            items.forEach { item ->
                if (item.productId != null) {
                    runCatching { productRepository.devolverStock(item.productId, item.quantity) }
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

    /**
     * Marca el pedido como entregado dejando constancia de quién lo recibió.
     * Es la prueba que pide Mercado Pago si el comprador desconoce el cargo:
     * sin ella, un "nunca me llegó" no se puede contradecir.
     */
    suspend fun registrarEntrega(id: String, receivedBy: String, proofUrl: String?): Order {
        val quienRecibio = receivedBy.trim()
        require(quienRecibio.isNotEmpty()) { "Falta quién recibió el pedido" }

        val (actual, _) = getById(id)
        require(actual.status != "cancelled") { "Un pedido cancelado no se puede marcar como entregado" }

        val entregadoEn = java.time.Instant.now().toString()
        val actualizado = orderRepository.marcarEntregado(id, quienRecibio, proofUrl?.takeIf { it.isNotBlank() }, entregadoEn)

        orderRepository.createEvent(OrderEvent(
            orderId = id,
            eventType = "status_change",
            oldValue = actual.status,
            newValue = "delivered",
            description = "Entregado — recibió: $quienRecibio" + if (proofUrl.isNullOrBlank()) "" else " (con comprobante)",
        ))

        return actualizado
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
