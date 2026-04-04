package com.sexyshop.models.product

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Product(
    val id: String = "",
    val name: String,
    val slug: String,
    val description: String? = null,
    val price: Double,
    @SerialName("old_price") val oldPrice: Double? = null,
    @SerialName("category_id") val categoryId: String,
    val stock: Int = 0,
    @SerialName("cost_price") val costPrice: Double = 0.0,
    @SerialName("low_stock_threshold") val lowStockThreshold: Int? = null,
    val badge: String? = null,
    @SerialName("is_active") val isActive: Boolean = true,
    @SerialName("display_order") val displayOrder: Int = 0,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class ProductRequest(
    val name: String,
    val slug: String,
    val description: String? = null,
    val price: Double,
    @SerialName("old_price") val oldPrice: Double? = null,
    @SerialName("category_id") val categoryId: String,
    val stock: Int = 0,
    @SerialName("cost_price") val costPrice: Double = 0.0,
    @SerialName("low_stock_threshold") val lowStockThreshold: Int? = null,
    val badge: String? = null,
    @SerialName("is_active") val isActive: Boolean = true,
    @SerialName("display_order") val displayOrder: Int = 0,
)

@Serializable
data class ProductPublic(
    val id: String,
    val name: String,
    val slug: String,
    val description: String? = null,
    val price: Double,
    @SerialName("old_price") val oldPrice: Double? = null,
    @SerialName("category_id") val categoryId: String,
    val stock: Int = 0,
    val badge: String? = null,
    @SerialName("is_active") val isActive: Boolean = true,
    @SerialName("display_order") val displayOrder: Int = 0,
)

fun Product.toPublic() = ProductPublic(
    id = id, name = name, slug = slug, description = description,
    price = price, oldPrice = oldPrice, categoryId = categoryId,
    stock = stock, badge = badge, isActive = isActive, displayOrder = displayOrder,
)

@Serializable
data class ProductReorderRequest(
    @SerialName("product_ids") val productIds: List<String>,
)

@Serializable
data class ProductWithImages(
    val product: Product,
    val images: List<com.sexyshop.models.image.ProductImage> = emptyList(),
)
