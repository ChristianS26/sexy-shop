package com.sexyshop.repositories.image

import com.sexyshop.models.image.ProductImage
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order

class ImageRepositoryImpl(
    private val supabase: SupabaseClient,
) : ImageRepository {

    override suspend fun getByProductId(productId: String): List<ProductImage> {
        return supabase.from("product_images")
            .select {
                filter { eq("product_id", productId) }
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

    override suspend fun update(id: String, fields: Map<String, Any>) {
        supabase.from("product_images")
            .update(fields) {
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
