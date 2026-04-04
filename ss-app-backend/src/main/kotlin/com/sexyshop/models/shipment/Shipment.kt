package com.sexyshop.models.shipment

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Shipment(
    val id: String = "",
    @SerialName("order_id") val orderId: String,
    val carrier: String,
    val service: String,
    @SerialName("tracking_number") val trackingNumber: String,
    @SerialName("label_url") val labelUrl: String? = null,
    val cost: Double,
    val status: String = "created",
    @SerialName("created_at") val createdAt: String? = null,
)
