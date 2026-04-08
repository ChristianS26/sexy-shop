package com.sexyshop.routing.product

import com.sexyshop.models.product.ProductReorderRequest
import com.sexyshop.models.product.ProductRequest
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
            val products = service.getAll(categoryId, activeOnly)
            val hasAuth = call.request.headers["Authorization"]?.startsWith("Bearer ") == true
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
