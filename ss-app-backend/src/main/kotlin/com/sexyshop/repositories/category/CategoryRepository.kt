package com.sexyshop.repositories.category

import com.sexyshop.models.category.Category
import com.sexyshop.models.category.CategoryRequest

interface CategoryRepository {
    suspend fun getAll(): List<Category>
    suspend fun getBySlug(slug: String): Category?
    suspend fun create(request: CategoryRequest): Category
    suspend fun update(id: String, request: CategoryRequest): Category
    suspend fun delete(id: String)
}
