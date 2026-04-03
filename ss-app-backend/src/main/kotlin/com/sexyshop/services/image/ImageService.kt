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

        // Upload to Supabase Storage
        val bucket = supabase.storage.from(config.storageBucket)
        bucket.upload(storagePath, fileBytes)

        // Get public URL
        val imageUrl = bucket.publicUrl(storagePath)

        // Save reference in database
        val image = imageRepository.create(
            ProductImage(
                productId = productId,
                imageUrl = imageUrl,
                storagePath = storagePath,
                isPrimary = isPrimary,
            )
        )

        return ImageUploadResponse(id = image.id, imageUrl = image.imageUrl)
    }

    suspend fun delete(id: String) {
        val image = imageRepository.getById(id)
            ?: throw NoSuchElementException("Image not found: $id")

        // Delete from storage
        val bucket = supabase.storage.from(config.storageBucket)
        bucket.delete(image.storagePath)

        // Delete from database
        imageRepository.delete(id)
    }
}
