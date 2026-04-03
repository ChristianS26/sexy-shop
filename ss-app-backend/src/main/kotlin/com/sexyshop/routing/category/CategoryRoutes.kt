package com.sexyshop.routing.category

import com.sexyshop.models.category.CategoryRequest
import com.sexyshop.services.category.CategoryService
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Route.categoryRoutes(service: CategoryService) {
    route("/categories") {
        get {
            call.respond(service.getAll())
        }

        get("/{slug}") {
            val slug = call.parameters["slug"]!!
            call.respond(service.getBySlug(slug))
        }

        post {
            val request = call.receive<CategoryRequest>()
            call.respond(HttpStatusCode.Created, service.create(request))
        }

        put("/{id}") {
            val id = call.parameters["id"]!!
            val request = call.receive<CategoryRequest>()
            call.respond(service.update(id, request))
        }

        delete("/{id}") {
            val id = call.parameters["id"]!!
            service.delete(id)
            call.respond(HttpStatusCode.NoContent)
        }
    }
}
