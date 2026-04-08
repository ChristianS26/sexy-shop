package com.sexyshop.services.product

import com.sexyshop.models.product.Product
import com.sexyshop.models.product.ProductRequest
import com.sexyshop.models.product.ProductWithImages
import com.sexyshop.repositories.image.ImageRepository
import com.sexyshop.repositories.product.ProductRepository
import com.sexyshop.services.image.ImageService

class ProductService(
    private val productRepository: ProductRepository,
    private val imageRepository: ImageRepository,
    private val imageService: ImageService,
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
        require(request.name.isNotBlank() && request.name.length <= 255) { "Product name required (max 255 chars)" }
        require(request.slug.isNotBlank() && request.slug.length <= 100) { "Product slug required (max 100 chars)" }
        require(request.price > 0 && request.price <= 999999.99) { "Price must be between 0.01 and 999,999.99" }
        require(request.stock >= 0 && request.stock <= 1000000) { "Stock must be 0-1,000,000" }
        require(request.costPrice >= 0) { "Cost price must be non-negative" }
        require(request.description == null || request.description.length <= 2000) { "Description max 2000 chars" }
        return productRepository.create(request)
    }

    suspend fun update(id: String, request: ProductRequest): Product {
        require(request.name.isNotBlank() && request.name.length <= 255) { "Product name required (max 255 chars)" }
        require(request.slug.isNotBlank() && request.slug.length <= 100) { "Product slug required (max 100 chars)" }
        require(request.price > 0 && request.price <= 999999.99) { "Price must be between 0.01 and 999,999.99" }
        require(request.stock >= 0 && request.stock <= 1000000) { "Stock must be 0-1,000,000" }
        require(request.costPrice >= 0) { "Cost price must be non-negative" }
        require(request.description == null || request.description.length <= 2000) { "Description max 2000 chars" }
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

    /**
     * Hard delete a product. Removes its storage files first (best-effort),
     * then drops the row. Cascading FKs handle product_images automatically;
     * order_items keep the snapshotted product_name/price but lose the FK.
     */
    suspend fun delete(id: String) {
        // Verify it exists; throw NoSuchElementException if not so the route returns 404
        productRepository.getById(id) ?: throw NoSuchElementException("Product not found: $id")
        imageService.deleteAllStorageFilesForProduct(id)
        productRepository.delete(id)
    }

    suspend fun reorder(productIds: List<String>) {
        productIds.forEachIndexed { index, id ->
            productRepository.updateDisplayOrder(id, index)
        }
    }
}
