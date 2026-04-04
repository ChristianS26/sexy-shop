package com.sexyshop.routing.image

import com.sexyshop.models.image.ImageReorderRequest
import com.sexyshop.plugins.requireAdmin
import com.sexyshop.services.image.ImageService
import io.github.jan.supabase.SupabaseClient
import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.utils.io.*

fun Route.imageRoutes(service: ImageService, supabase: SupabaseClient) {
    route("/images") {
        post("/upload") {
            if (!call.requireAdmin(supabase)) return@post
            val multipart = call.receiveMultipart()
            var productId: String? = null
            var isPrimary = false
            var fileName: String? = null
            var fileBytes: ByteArray? = null
            var contentType: String? = null

            multipart.forEachPart { part ->
                when (part) {
                    is PartData.FormItem -> {
                        when (part.name) {
                            "productId" -> productId = part.value
                            "isPrimary" -> isPrimary = part.value.toBooleanStrictOrNull() ?: false
                        }
                    }
                    is PartData.FileItem -> {
                        fileName = part.originalFileName
                        contentType = part.contentType?.toString() ?: "image/jpeg"
                        fileBytes = part.provider().toByteArray()
                    }
                    else -> {}
                }
                part.dispose()
            }

            requireNotNull(productId) { "productId is required" }
            requireNotNull(fileBytes) { "file is required" }

            // Validate file type
            val allowedExtensions = setOf("jpg", "jpeg", "png", "webp", "gif")
            val extension = (fileName ?: "").substringAfterLast('.', "").lowercase()
            require(extension in allowedExtensions) { "Only image files allowed (jpg, png, webp, gif)" }

            // Validate file size (5MB max)
            require(fileBytes!!.size <= 5 * 1024 * 1024) { "File size must be under 5MB" }

            val response = service.upload(
                productId = productId!!,
                fileName = fileName ?: "image.jpg",
                fileBytes = fileBytes!!,
                contentType = contentType ?: "image/jpeg",
                isPrimary = isPrimary,
            )

            call.respond(HttpStatusCode.Created, response)
        }

        put("/reorder") {
            if (!call.requireAdmin(supabase)) return@put
            val request = call.receive<ImageReorderRequest>()
            service.reorder(request.imageIds)
            call.respond(HttpStatusCode.NoContent)
        }

        delete("/{id}") {
            if (!call.requireAdmin(supabase)) return@delete
            val id = call.parameters["id"]!!
            service.delete(id)
            call.respond(HttpStatusCode.NoContent)
        }
    }
}
