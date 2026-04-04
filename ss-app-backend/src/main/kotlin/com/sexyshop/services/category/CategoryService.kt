package com.sexyshop.services.category

import com.sexyshop.models.category.Category
import com.sexyshop.models.category.CategoryRequest
import com.sexyshop.repositories.category.CategoryRepository

class CategoryService(
    private val repository: CategoryRepository,
) {
    suspend fun getAll(): List<Category> = repository.getAll()

    suspend fun getBySlug(slug: String): Category =
        repository.getBySlug(slug) ?: throw NoSuchElementException("Category not found: $slug")

    suspend fun create(request: CategoryRequest): Category {
        require(request.name.isNotBlank() && request.name.length <= 100) { "Category name required (max 100 chars)" }
        require(request.slug.isNotBlank() && request.slug.length <= 50) { "Category slug required (max 50 chars)" }
        require(request.icon.length <= 4) { "Icon max 4 chars" }
        return repository.create(request)
    }

    suspend fun update(id: String, request: CategoryRequest): Category {
        require(request.name.isNotBlank() && request.name.length <= 100) { "Category name required (max 100 chars)" }
        require(request.slug.isNotBlank() && request.slug.length <= 50) { "Category slug required (max 50 chars)" }
        require(request.icon.length <= 4) { "Icon max 4 chars" }
        return repository.update(id, request)
    }

    suspend fun delete(id: String) = repository.delete(id)
}
