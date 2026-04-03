package com.sexyshop.repositories.product

import com.sexyshop.models.product.Product
import com.sexyshop.models.product.ProductRequest

interface ProductRepository {
    suspend fun getAll(categoryId: String? = null, activeOnly: Boolean = true): List<Product>
    suspend fun getById(id: String): Product?
    suspend fun create(request: ProductRequest): Product
    suspend fun update(id: String, request: ProductRequest): Product
    suspend fun deactivate(id: String)
    suspend fun updateStock(id: String, newStock: Int)
}
