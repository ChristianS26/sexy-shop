package com.sexyshop.models.category

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Category(
    val id: String = "",
    val name: String,
    val slug: String,
    val icon: String,
    @SerialName("display_order") val displayOrder: Int = 0,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class CategoryRequest(
    val name: String,
    val slug: String,
    val icon: String,
    @SerialName("display_order") val displayOrder: Int = 0,
)
