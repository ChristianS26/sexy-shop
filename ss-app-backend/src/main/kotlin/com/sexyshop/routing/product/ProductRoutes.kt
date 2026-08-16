package com.sexyshop.routing.product

import com.sexyshop.models.product.ProductPublicWithImages
import com.sexyshop.models.product.ProductReorderRequest
import com.sexyshop.models.product.ProductRequest
import com.sexyshop.models.product.ProductWithImages
import com.sexyshop.models.product.toPublic
import com.sexyshop.plugins.requireAdmin
import com.sexyshop.services.image.ImageService
import com.sexyshop.services.product.ProductService
import io.github.jan.supabase.SupabaseClient
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Route.productRoutes(service: ProductService, imageService: ImageService, supabase: SupabaseClient) {
    route("/products") {
        get {
            val categoryId = call.parameters["category"]
            val activeOnly = call.parameters["active"]?.toBooleanStrictOrNull() ?: true
            val withImages = call.parameters["images"]?.toBooleanStrictOrNull() ?: false
            val hasAuth = call.request.headers["Authorization"]?.startsWith("Bearer ") == true

            // ?images=true devuelve cada producto con sus imágenes ya adjuntas,
            // en vez de obligar a una petición por producto para la miniatura.
            // Sin credenciales responde la versión pública (sin costo, umbral
            // de stock ni medidas); con credenciales de admin, la completa.
            if (withImages && !hasAuth) {
                val products = service.getAll(categoryId, activeOnly)
                val porProducto = imageService.getAllGroupedByProduct()
                call.respond(products.map {
                    ProductPublicWithImages(it.toPublic(), porProducto[it.id] ?: emptyList())
                })
                return@get
            }

            if (withImages) {
                if (!call.requireAdmin(supabase)) return@get
                val products = service.getAll(categoryId, activeOnly)
                val porProducto = imageService.getAllGroupedByProduct()
                call.respond(products.map {
                    ProductWithImages(it, porProducto[it.id] ?: emptyList())
                })
                return@get
            }

            val products = service.getAll(categoryId, activeOnly)
            if (hasAuth) {
                call.respond(products)
            } else {
                call.respond(products.map { it.toPublic() })
            }
        }

        get("/{id}") {
            val id = call.parameters["id"]!!
            call.respond(service.getById(id))
        }

        post {
            if (!call.requireAdmin(supabase)) return@post
            val request = call.receive<ProductRequest>()
            call.respond(HttpStatusCode.Created, service.create(request))
        }

        put("/{id}") {
            if (!call.requireAdmin(supabase)) return@put
            val id = call.parameters["id"]!!
            val request = call.receive<ProductRequest>()
            call.respond(service.update(id, request))
        }

        put("/reorder") {
            if (!call.requireAdmin(supabase)) return@put
            val request = call.receive<ProductReorderRequest>()
            service.reorder(request.productIds)
            call.respond(HttpStatusCode.NoContent)
        }

        put("/{id}/toggle-active") {
            if (!call.requireAdmin(supabase)) return@put
            val id = call.parameters["id"]!!
            val product = service.toggleActive(id)
            call.respond(product)
        }

        delete("/{id}") {
            if (!call.requireAdmin(supabase)) return@delete
            val id = call.parameters["id"]!!
            service.delete(id)
            call.respond(HttpStatusCode.NoContent)
        }

        get("/{id}/images") {
            val id = call.parameters["id"]!!
            call.respond(imageService.getByProductId(id))
        }
    }
}
