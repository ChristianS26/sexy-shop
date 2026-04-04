package com.sexyshop.services.product

import com.sexyshop.models.product.Product
import com.sexyshop.models.product.ProductRequest
import com.sexyshop.models.product.ProductWithImages
import com.sexyshop.repositories.image.ImageRepository
import com.sexyshop.repositories.product.ProductRepository

class ProductService(
    private val productRepository: ProductRepository,
    private val imageRepository: ImageRepository,
) {
    suspend fun getAll(categoryId: String? = null, activeOnly: Boolean = true): List<Product> =
        productRepository.getAll(categoryId, activeOnly)

    suspend fun getById(id: String): ProductWithImages {
        val product = productRepository.getById(id)
            ?: throw NoSuchElementException("Product not found: $id")
        val images = imageRepository.getByProductId(id)
        return ProductWithImages(product = product, images = images)
    }

    suspend fun create(request: ProductRequest): Product {
        require(request.name.isNotBlank()) { "Product name required" }
        require(request.slug.isNotBlank()) { "Product slug required" }
        require(request.price > 0) { "Price must be positive" }
        require(request.stock >= 0) { "Stock must be non-negative" }
        return productRepository.create(request)
    }

    suspend fun update(id: String, request: ProductRequest): Product {
        require(request.name.isNotBlank()) { "Product name required" }
        require(request.slug.isNotBlank()) { "Product slug required" }
        require(request.price > 0) { "Price must be positive" }
        require(request.stock >= 0) { "Stock must be non-negative" }
        return productRepository.update(id, request)
    }

    suspend fun toggleActive(id: String): Product {
        val product = productRepository.getById(id)
            ?: throw NoSuchElementException("Product not found: $id")
        if (product.isActive) {
            productRepository.deactivate(id)
        } else {
            productRepository.activate(id)
        }
        return productRepository.getById(id)!!
    }

    suspend fun deactivate(id: String) = productRepository.deactivate(id)

    suspend fun reorder(productIds: List<String>) {
        productIds.forEachIndexed { index, id ->
            productRepository.updateDisplayOrder(id, index)
        }
    }
}
