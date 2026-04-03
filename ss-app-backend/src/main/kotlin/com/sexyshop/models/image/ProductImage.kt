package com.sexyshop.models.image

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ProductImage(
    val id: String = "",
    @SerialName("product_id") val productId: String,
    @SerialName("image_url") val imageUrl: String,
    @SerialName("storage_path") val storagePath: String,
    @SerialName("display_order") val displayOrder: Int = 0,
    @SerialName("is_primary") val isPrimary: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class ImageUploadResponse(
    val id: String,
    @SerialName("image_url") val imageUrl: String,
)
