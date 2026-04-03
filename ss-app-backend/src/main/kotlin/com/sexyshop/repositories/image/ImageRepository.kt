package com.sexyshop.repositories.image

import com.sexyshop.models.image.ProductImage

interface ImageRepository {
    suspend fun getByProductId(productId: String): List<ProductImage>
    suspend fun getById(id: String): ProductImage?
    suspend fun create(image: ProductImage): ProductImage
    suspend fun update(id: String, fields: Map<String, Any>)
    suspend fun delete(id: String)
}
