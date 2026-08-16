package com.sexyshop.repositories.product

import com.sexyshop.models.product.Product
import com.sexyshop.models.product.ProductRequest

interface ProductRepository {
    suspend fun getAll(categoryId: String? = null, activeOnly: Boolean = true): List<Product>
    suspend fun getById(id: String): Product?
    suspend fun create(request: ProductRequest): Product
    suspend fun update(id: String, request: ProductRequest): Product
    suspend fun activate(id: String)
    suspend fun deactivate(id: String)
    suspend fun delete(id: String)
    /** Descuento atómico. Truena con StockInsuficienteException si no alcanza. */
    suspend fun descontarStock(id: String, cantidad: Int): Int
    suspend fun devolverStock(id: String, cantidad: Int): Int
    suspend fun updateStock(id: String, newStock: Int)
    suspend fun updateDisplayOrder(id: String, displayOrder: Int)
}
