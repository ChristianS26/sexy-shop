package com.sexyshop.repositories.product

import com.sexyshop.models.product.Product
import com.sexyshop.models.product.ProductRequest
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

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
        // Build the payload manually with JsonObject so nullable fields are sent
        // explicitly as `null` instead of being omitted by supabase-kt's default
        // serializer (which uses explicitNulls = false). Without this, clearing
        // a field like `badge` from a value to "Ninguno" wouldn't actually update
        // the column — Supabase would treat the missing key as "leave unchanged".
        val payload = buildJsonObject {
            put("name", request.name)
            put("slug", request.slug)
            put("description", request.description?.let { JsonPrimitive(it) } ?: JsonNull)
            put("price", request.price)
            put("old_price", request.oldPrice?.let { JsonPrimitive(it) } ?: JsonNull)
            put("category_id", request.categoryId)
            put("stock", request.stock)
            put("cost_price", request.costPrice)
            put("low_stock_threshold", request.lowStockThreshold?.let { JsonPrimitive(it) } ?: JsonNull)
            put("weight", request.weight?.let { JsonPrimitive(it) } ?: JsonNull)
            put("length", request.length?.let { JsonPrimitive(it) } ?: JsonNull)
            put("width", request.width?.let { JsonPrimitive(it) } ?: JsonNull)
            put("height", request.height?.let { JsonPrimitive(it) } ?: JsonNull)
            put("badge", request.badge?.let { JsonPrimitive(it) } ?: JsonNull)
            put("is_active", request.isActive)
            put("display_order", request.displayOrder)
        }
        supabase.from("products")
            .update(payload) {
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

    override suspend fun delete(id: String) {
        // Hard delete. Foreign keys are configured so this is safe:
        // - product_images: ON DELETE CASCADE (image rows are removed)
        // - order_items: ON DELETE SET NULL (order history preserved with the
        //   product_name/quantity/price snapshot already stored on the row)
        supabase.from("products").delete {
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
