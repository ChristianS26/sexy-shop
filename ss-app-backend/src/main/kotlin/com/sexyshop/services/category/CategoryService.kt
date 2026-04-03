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

    suspend fun create(request: CategoryRequest): Category = repository.create(request)

    suspend fun update(id: String, request: CategoryRequest): Category = repository.update(id, request)

    suspend fun delete(id: String) = repository.delete(id)
}
