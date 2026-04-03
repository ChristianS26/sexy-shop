package com.sexyshop.routing.product

import com.sexyshop.models.product.ProductRequest
import com.sexyshop.services.product.ProductService
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Route.productRoutes(service: ProductService) {
    route("/products") {
        get {
            val categoryId = call.parameters["category"]
            val activeOnly = call.parameters["active"]?.toBooleanStrictOrNull() ?: true
            call.respond(service.getAll(categoryId, activeOnly))
        }

        get("/{id}") {
            val id = call.parameters["id"]!!
            call.respond(service.getById(id))
        }

        post {
            val request = call.receive<ProductRequest>()
            call.respond(HttpStatusCode.Created, service.create(request))
        }

        put("/{id}") {
            val id = call.parameters["id"]!!
            val request = call.receive<ProductRequest>()
            call.respond(service.update(id, request))
        }

        delete("/{id}") {
            val id = call.parameters["id"]!!
            service.deactivate(id)
            call.respond(HttpStatusCode.NoContent)
        }
    }
}
