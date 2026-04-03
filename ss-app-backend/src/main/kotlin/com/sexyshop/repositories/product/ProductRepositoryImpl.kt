package com.sexyshop.repositories.product

import com.sexyshop.models.product.Product
import com.sexyshop.models.product.ProductRequest
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

class ProductRepositoryImpl(
    private val supabase: SupabaseClient,
) : ProductRepository {

    override suspend fun getAll(categoryId: String?, activeOnly: Boolean): List<Product> {
        return supabase.from("products")
            .select {
                if (activeOnly) {
                    filter { eq("is_active", true) }
                }
                if (categoryId != null) {
                    filter { eq("category_id", categoryId) }
                }
                order("created_at", Order.DESCENDING)
            }
            .decodeList<Product>()
    }

    override suspend fun getById(id: String): Product? {
        return supabase.from("products")
            .select {
                filter { eq("id", id) }
            }
            .decodeSingleOrNull<Product>()
    }

    override suspend fun create(request: ProductRequest): Product {
        supabase.from("products").insert(request)
        return supabase.from("products")
            .select {
                filter { eq("slug", request.slug) }
            }
            .decodeSingle<Product>()
    }

    override suspend fun update(id: String, request: ProductRequest): Product {
        supabase.from("products")
            .update(request) {
                filter { eq("id", id) }
            }
        return supabase.from("products")
            .select {
                filter { eq("id", id) }
            }
            .decodeSingle<Product>()
    }

    override suspend fun deactivate(id: String) {
        supabase.from("products")
            .update(mapOf("is_active" to false)) {
                filter { eq("id", id) }
            }
    }

    override suspend fun updateStock(id: String, newStock: Int) {
        supabase.from("products")
            .update(mapOf("stock" to newStock)) {
                filter { eq("id", id) }
            }
    }
}
