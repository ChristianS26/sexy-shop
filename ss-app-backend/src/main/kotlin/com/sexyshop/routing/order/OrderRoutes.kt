package com.sexyshop.routing.order

import com.sexyshop.models.order.OrderDetailResponse
import com.sexyshop.models.order.OrderNotesUpdate
import com.sexyshop.models.order.OrderRequest
import com.sexyshop.models.order.OrderStatusUpdate
import com.sexyshop.plugins.requireAdmin
import com.sexyshop.services.email.EmailService
import com.sexyshop.services.order.OrderService
import io.github.jan.supabase.SupabaseClient
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Route.orderRoutes(service: OrderService, emailService: EmailService, supabase: SupabaseClient) {
    route("/orders") {
        get {
            if (!call.requireAdmin(supabase)) return@get
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

            // Send email notifications
            try {
                val (fullOrder, items) = service.getById(order.id)
                emailService.sendNewOrderNotificationToAdmin(fullOrder, items)
                if (!request.customerEmail.isNullOrBlank()) {
                    emailService.sendOrderConfirmationToCustomer(fullOrder, items, request.customerEmail)
                }
            } catch (_: Exception) {}

            call.respond(HttpStatusCode.Created, order)
        }

        put("/{id}/status") {
            if (!call.requireAdmin(supabase)) return@put
            val id = call.parameters["id"]!!
            val update = call.receive<OrderStatusUpdate>()
            call.respond(service.updateStatus(id, update.status))
        }

        put("/{id}/notes") {
            if (!call.requireAdmin(supabase)) return@put
            val id = call.parameters["id"]!!
            val update = call.receive<OrderNotesUpdate>()
            call.respond(service.updateNotes(id, update.notes))
        }

        get("/{id}/timeline") {
            if (!call.requireAdmin(supabase)) return@get
            val id = call.parameters["id"]!!
            call.respond(service.getTimeline(id))
        }
    }
}
