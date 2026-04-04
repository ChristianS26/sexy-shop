package com.sexyshop.routing.order

import com.sexyshop.models.order.OrderDetailResponse
import com.sexyshop.models.order.OrderNotesUpdate
import com.sexyshop.models.order.OrderRequest
import com.sexyshop.models.order.OrderStatusUpdate
import com.sexyshop.services.email.EmailService
import com.sexyshop.services.order.OrderService
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.launch

fun Route.orderRoutes(service: OrderService, emailService: EmailService) {
    route("/orders") {
        get {
            val status = call.parameters["status"]
            call.respond(service.getAll(status))
        }

        get("/{id}") {
            val id = call.parameters["id"]!!
            val (order, items) = service.getById(id)
            call.respond(OrderDetailResponse(order = order, items = items))
        }

        post {
            val request = call.receive<OrderRequest>()
            val order = service.create(request)
            call.respond(HttpStatusCode.Created, order)

            // Send emails in background (non-blocking)
            launch {
                try {
                    val (_, items) = service.getById(order.id)
                    emailService.sendNewOrderNotificationToAdmin(order, items)
                    // Send to customer if they provided a phone (we don't have email yet)
                } catch (_: Exception) {}
            }
        }

        put("/{id}/status") {
            val id = call.parameters["id"]!!
            val update = call.receive<OrderStatusUpdate>()
            call.respond(service.updateStatus(id, update.status))
        }

        put("/{id}/notes") {
            val id = call.parameters["id"]!!
            val update = call.receive<OrderNotesUpdate>()
            call.respond(service.updateNotes(id, update.notes))
        }

        get("/{id}/timeline") {
            val id = call.parameters["id"]!!
            call.respond(service.getTimeline(id))
        }
    }
}
