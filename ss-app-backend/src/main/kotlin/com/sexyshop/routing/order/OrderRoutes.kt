package com.sexyshop.routing.order

import com.sexyshop.models.order.OrderRequest
import com.sexyshop.models.order.OrderStatusUpdate
import com.sexyshop.services.order.OrderService
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import org.koin.ktor.ext.inject

fun Route.orderRoutes() {
    val service by inject<OrderService>()

    route("/orders") {
        get {
            val status = call.parameters["status"]
            call.respond(service.getAll(status))
        }

        get("/{id}") {
            val id = call.parameters["id"]!!
            val (order, items) = service.getById(id)
            call.respond(mapOf("order" to order, "items" to items))
        }

        post {
            val request = call.receive<OrderRequest>()
            call.respond(HttpStatusCode.Created, service.create(request))
        }

        put("/{id}/status") {
            val id = call.parameters["id"]!!
            val update = call.receive<OrderStatusUpdate>()
            call.respond(service.updateStatus(id, update.status))
        }
    }
}
