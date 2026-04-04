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
    @SerialName("customer_references") val customerReferences: String? = null,
    @SerialName("customer_email") val customerEmail: String? = null,
    val status: String = "pending",
    val total: Double,
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
    @SerialName("customer_references") val customerReferences: String? = null,
    val notes: String? = null,
    val items: List<OrderItemRequest>,
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
