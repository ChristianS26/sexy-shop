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

    @Serializable
    private data class StockUpdate(val stock: Int)

    @Serializable
    private data class ActiveUpdate(@SerialName("is_active") val isActive: Boolean)

    @Serializable
    private data class DisplayOrderUpdate(@SerialName("display_order") val displayOrder: Int)

    override suspend fun getAll(categoryId: String?, activeOnly: Boolean): List<Product> {
        return supabase.from("products")
            .select {
                if (activeOnly) {
                    filter { eq("is_active", true) }
                }
                if (categoryId != null) {
                    filter { eq("category_id", categoryId) }
                }
                order("display_order", Order.ASCENDING)
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

    override suspend fun activate(id: String) {
        supabase.from("products")
            .update(ActiveUpdate(true)) {
                filter { eq("id", id) }
            }
    }

    override suspend fun deactivate(id: String) {
        supabase.from("products")
            .update(ActiveUpdate(false)) {
                filter { eq("id", id) }
            }
    }

    override suspend fun updateStock(id: String, newStock: Int) {
        supabase.from("products")
            .update(StockUpdate(newStock)) {
                filter { eq("id", id) }
            }
    }

    override suspend fun updateDisplayOrder(id: String, displayOrder: Int) {
        supabase.from("products")
            .update(DisplayOrderUpdate(displayOrder)) {
                filter { eq("id", id) }
            }
    }
}
