package com.sexyshop.routing.image

import com.sexyshop.models.image.ImageReorderRequest
import com.sexyshop.services.image.ImageService
import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.utils.io.*

fun Route.imageRoutes(service: ImageService) {
    route("/images") {
        post("/upload") {
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
            val request = call.receive<ImageReorderRequest>()
            service.reorder(request.imageIds)
            call.respond(HttpStatusCode.NoContent)
        }

        delete("/{id}") {
            val id = call.parameters["id"]!!
            service.delete(id)
            call.respond(HttpStatusCode.NoContent)
        }
    }
}
