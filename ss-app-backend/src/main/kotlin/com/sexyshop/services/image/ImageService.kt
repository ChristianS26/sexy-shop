package com.sexyshop.services.image

import com.sexyshop.config.SupabaseConfig
import com.sexyshop.models.image.ImageUploadResponse
import com.sexyshop.models.image.ProductImage
import com.sexyshop.repositories.image.ImageRepository
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.storage.storage
import java.util.UUID

class ImageService(
    private val imageRepository: ImageRepository,
    private val supabase: SupabaseClient,
    private val config: SupabaseConfig,
) {
    suspend fun getByProductId(productId: String): List<ProductImage> =
        imageRepository.getByProductId(productId)

    suspend fun upload(
        productId: String,
        fileName: String,
        fileBytes: ByteArray,
        contentType: String,
        isPrimary: Boolean = false,
    ): ImageUploadResponse {
        val extension = fileName.substringAfterLast('.', "jpg")
        val storagePath = "products/$productId/${UUID.randomUUID()}.$extension"

        val bucket = supabase.storage.from(config.storageBucket)
        bucket.upload(storagePath, fileBytes)

        val imageUrl = bucket.publicUrl(storagePath)

        // Set display_order to next available
        val existing = imageRepository.getByProductId(productId)
        val nextOrder = if (existing.isEmpty()) 0 else existing.maxOf { it.displayOrder } + 1

        val image = imageRepository.create(
            ProductImage(
                productId = productId,
                imageUrl = imageUrl,
                storagePath = storagePath,
                isPrimary = isPrimary,
                displayOrder = nextOrder,
            )
        )

        return ImageUploadResponse(id = image.id, imageUrl = image.imageUrl)
    }

    suspend fun reorder(imageIds: List<String>) {
        imageIds.forEachIndexed { index, id ->
            imageRepository.updateDisplayOrder(id, index)
        }
    }

    suspend fun delete(id: String) {
        val image = imageRepository.getById(id)
            ?: throw NoSuchElementException("Image not found: $id")

        val bucket = supabase.storage.from(config.storageBucket)
        bucket.delete(image.storagePath)

        imageRepository.delete(id)

        // Re-index remaining images
        val remaining = imageRepository.getByProductId(image.productId)
        remaining.forEachIndexed { index, img ->
            imageRepository.updateDisplayOrder(img.id, index)
        }
    }
}
