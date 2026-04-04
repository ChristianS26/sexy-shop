package com.sexyshop.models.order

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class OrderEvent(
    val id: String = "",
    @SerialName("order_id") val orderId: String = "",
    @SerialName("event_type") val eventType: String,
    @SerialName("old_value") val oldValue: String? = null,
    @SerialName("new_value") val newValue: String? = null,
    val description: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class OrderNotesUpdate(
    val notes: String,
)
