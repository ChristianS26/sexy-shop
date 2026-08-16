package com.sexyshop.models.order

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Order(
    val id: String = "",
    @SerialName("customer_name") val customerName: String,
    @SerialName("customer_phone") val customerPhone: String,
    @SerialName("customer_address") val customerAddress: String? = null,
    @SerialName("customer_street") val customerStreet: String? = null,
    @SerialName("customer_neighborhood") val customerNeighborhood: String? = null,
    @SerialName("customer_city") val customerCity: String? = null,
    @SerialName("customer_state") val customerState: String? = null,
    @SerialName("customer_zip") val customerZip: String? = null,
    @SerialName("customer_ext_num") val customerExtNum: String? = null,
    @SerialName("customer_int_num") val customerIntNum: String? = null,
    @SerialName("customer_references") val customerReferences: String? = null,
    @SerialName("customer_email") val customerEmail: String? = null,
    val status: String = "pending",
    val total: Double,
    @SerialName("shipping_cost") val shippingCost: Double = 0.0,
    @SerialName("delivery_method") val deliveryMethod: String = "national",
    @SerialName("payment_method") val paymentMethod: String = "cash",
    // Conciliación con Mercado Pago: lo que cobró MP y lo que quedó neto
    @SerialName("mp_payment_id") val mpPaymentId: String? = null,
    @SerialName("mp_fee") val mpFee: Double? = null,
    @SerialName("mp_net") val mpNet: Double? = null,
    @SerialName("mp_installments") val mpInstallments: Int? = null,
    @SerialName("mp_method") val mpMethod: String? = null,
    // Evidencia para una disputa o contracargo: cuándo aceptó los términos y
    // constancia de que el pedido llegó. El sello de aceptación lo pone el
    // servidor, nunca el navegador.
    @SerialName("terms_accepted_at") val termsAcceptedAt: String? = null,
    @SerialName("delivered_at") val deliveredAt: String? = null,
    @SerialName("received_by") val receivedBy: String? = null,
    @SerialName("delivery_proof_url") val deliveryProofUrl: String? = null,
    val notes: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class OrderItem(
    val id: String = "",
    @SerialName("order_id") val orderId: String = "",
    @SerialName("product_id") val productId: String? = null,
    @SerialName("product_name") val productName: String,
    val quantity: Int,
    @SerialName("unit_price") val unitPrice: Double,
    val subtotal: Double,
)

@Serializable
data class OrderRequest(
    @SerialName("customer_name") val customerName: String,
    @SerialName("customer_phone") val customerPhone: String,
    @SerialName("customer_email") val customerEmail: String? = null,
    @SerialName("customer_address") val customerAddress: String? = null,
    @SerialName("customer_street") val customerStreet: String? = null,
    @SerialName("customer_neighborhood") val customerNeighborhood: String? = null,
    @SerialName("customer_city") val customerCity: String? = null,
    @SerialName("customer_state") val customerState: String? = null,
    @SerialName("customer_zip") val customerZip: String? = null,
    @SerialName("customer_ext_num") val customerExtNum: String? = null,
    @SerialName("customer_int_num") val customerIntNum: String? = null,
    @SerialName("customer_references") val customerReferences: String? = null,
    @SerialName("delivery_method") val deliveryMethod: String = "national",
    @SerialName("payment_method") val paymentMethod: String = "cash",
    // Conciliación con MP — solo los llena el webhook de pagos, nunca el
    // público (OrderRoutes los limpia antes de crear el pedido).
    @SerialName("mp_payment_id") val mpPaymentId: String? = null,
    @SerialName("mp_fee") val mpFee: Double? = null,
    @SerialName("mp_net") val mpNet: Double? = null,
    @SerialName("mp_installments") val mpInstallments: Int? = null,
    @SerialName("mp_method") val mpMethod: String? = null,
    // El comprador marcó la casilla de términos (checkout local). El sello de
    // hora lo pone el servidor en OrderRoutes/PaymentRoutes, nunca el cliente.
    @SerialName("terms_accepted") val termsAccepted: Boolean = false,
    // Solo llega por flujos internos (webhook de MP con el sello del servidor).
    @SerialName("terms_accepted_at") val termsAcceptedAt: String? = null,
    val notes: String? = null,
    val items: List<OrderItemRequest>,
)

/** Constancia de entrega: lo que se enseña si el comprador desconoce el cargo. */
@Serializable
data class DeliveryProofUpdate(
    @SerialName("received_by") val receivedBy: String,
    @SerialName("delivery_proof_url") val deliveryProofUrl: String? = null,
)

@Serializable
data class OrderItemRequest(
    @SerialName("product_id") val productId: String,
    val quantity: Int,
)

@Serializable
data class OrderStatusUpdate(
    val status: String,
)

@Serializable
data class OrderDetailResponse(
    val order: Order,
    val items: List<OrderItem>,
)
