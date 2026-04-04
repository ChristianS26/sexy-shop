package com.sexyshop.routing.category

import com.sexyshop.models.category.CategoryRequest
import com.sexyshop.plugins.requireAdmin
import com.sexyshop.services.category.CategoryService
import io.github.jan.supabase.SupabaseClient
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Route.categoryRoutes(service: CategoryService, supabase: SupabaseClient) {
    route("/categories") {
        get {
            call.respond(service.getAll())
        }

        get("/{slug}") {
            val slug = call.parameters["slug"]!!
            call.respond(service.getBySlug(slug))
        }

        post {
            if (!call.requireAdmin(supabase)) return@post
            val request = call.receive<CategoryRequest>()
            call.respond(HttpStatusCode.Created, service.create(request))
        }

        put("/{id}") {
            if (!call.requireAdmin(supabase)) return@put
            val id = call.parameters["id"]!!
            val request = call.receive<CategoryRequest>()
            call.respond(service.update(id, request))
        }

        delete("/{id}") {
            if (!call.requireAdmin(supabase)) return@delete
            val id = call.parameters["id"]!!
            service.delete(id)
            call.respond(HttpStatusCode.NoContent)
        }
    }
}
