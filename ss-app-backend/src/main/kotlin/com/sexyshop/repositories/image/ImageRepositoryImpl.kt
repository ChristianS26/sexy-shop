package com.sexyshop.repositories.image

import com.sexyshop.models.image.ProductImage
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

class ImageRepositoryImpl(
    private val supabase: SupabaseClient,
) : ImageRepository {

    @Serializable
    private data class DisplayOrderUpdate(
        @SerialName("display_order") val displayOrder: Int,
    )

    override suspend fun getByProductId(productId: String): List<ProductImage> {
        return supabase.from("product_images")
            .select {
                filter { eq("product_id", productId) }
                order("display_order", Order.ASCENDING)
            }
            .decodeList<ProductImage>()
    }

    /**
     * Todas las imágenes de un jalón. La tienda y el admin necesitaban la
     * miniatura de cada producto y hacían una petición por producto (N+1);
     * con esto son dos.
     */
    override suspend fun getAll(): List<ProductImage> {
        return supabase.from("product_images")
            .select {
                order("display_order", Order.ASCENDING)
            }
            .decodeList<ProductImage>()
    }

    override suspend fun getById(id: String): ProductImage? {
        return supabase.from("product_images")
            .select {
                filter { eq("id", id) }
            }
            .decodeSingleOrNull<ProductImage>()
    }

    override suspend fun create(image: ProductImage): ProductImage {
        supabase.from("product_images").insert(image)
        return supabase.from("product_images")
            .select {
                filter { eq("product_id", image.productId) }
                order("created_at", Order.DESCENDING)
                limit(1)
            }
            .decodeSingle<ProductImage>()
    }

    override suspend fun updateDisplayOrder(id: String, displayOrder: Int) {
        supabase.from("product_images")
            .update(DisplayOrderUpdate(displayOrder)) {
                filter { eq("id", id) }
            }
    }

    override suspend fun delete(id: String) {
        supabase.from("product_images")
            .delete {
                filter { eq("id", id) }
            }
    }
}
