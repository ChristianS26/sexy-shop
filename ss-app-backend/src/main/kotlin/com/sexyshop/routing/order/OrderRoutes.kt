package com.sexyshop.routing.order

import com.sexyshop.models.order.DeliveryProofUpdate
import com.sexyshop.models.order.OrderDetailResponse
import com.sexyshop.models.order.OrderNotesUpdate
import com.sexyshop.models.order.OrderRequest
import com.sexyshop.models.order.OrderStatusUpdate
import com.sexyshop.plugins.requireAdmin
import com.sexyshop.services.email.EmailService
import com.sexyshop.services.image.ImageService
import com.sexyshop.services.order.OrderService
import io.github.jan.supabase.SupabaseClient
import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.utils.io.*
import org.slf4j.LoggerFactory

private val logger = LoggerFactory.getLogger("OrderRoutes")

fun Route.orderRoutes(
    service: OrderService,
    emailService: EmailService,
    imageService: ImageService,
    supabase: SupabaseClient,
) {
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
            // Los campos de conciliación con MP solo los llena el webhook de
            // pagos: desde el público se descartan para que nadie pueda
            // "reservar" un mp_payment_id y bloquear el pedido real del webhook.
            val received = call.receive<OrderRequest>()
            val request = received.copy(
                mpPaymentId = null,
                mpFee = null,
                mpNet = null,
                mpInstallments = null,
                mpMethod = null,
            )
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
            val anterior = runCatching { service.getById(id).first.status }.getOrNull()
            val order = service.updateStatus(id, update.status)

            // Los dos momentos que le importan al cliente: cuando la tienda
            // acepta su pedido y cuando lo cancela (ahí va su dinero de vuelta).
            if (anterior != update.status) {
                try {
                    val (full, items) = service.getById(id)
                    val email = full.customerEmail
                    if (!email.isNullOrBlank()) {
                        when (update.status) {
                            "confirmed" -> emailService.sendOrderConfirmationToCustomer(full, items, email)
                            "cancelled" -> emailService.sendOrderCancelledToCustomer(full, email)
                        }
                    }
                } catch (e: Exception) {
                    logger.error("No se pudo avisar al cliente del cambio a ${update.status} en el pedido $id", e)
                }
            }

            call.respond(order)
        }

        // Constancia de entrega. Deja el pedido en "delivered" y guarda quién lo
        // recibió: es lo que se enseña si el comprador desconoce el cargo.
        put("/{id}/delivery") {
            if (!call.requireAdmin(supabase)) return@put
            val id = call.parameters["id"]!!
            val update = call.receive<DeliveryProofUpdate>()
            call.respond(service.registrarEntrega(id, update.receivedBy, update.deliveryProofUrl))
        }

        // Foto del acuse (firma, paquete en la puerta, quien recibió).
        post("/{id}/delivery-proof") {
            if (!call.requireAdmin(supabase)) return@post
            val id = call.parameters["id"]!!
            var fileName: String? = null
            var fileBytes: ByteArray? = null

            call.receiveMultipart().forEachPart { part ->
                if (part is PartData.FileItem) {
                    fileName = part.originalFileName
                    fileBytes = part.provider().toByteArray()
                }
                part.dispose()
            }

            val bytes = requireNotNull(fileBytes) { "Falta el archivo" }
            val extension = (fileName ?: "").substringAfterLast('.', "").lowercase()
            require(extension in setOf("jpg", "jpeg", "png", "webp", "pdf")) {
                "Solo se acepta imagen (jpg, png, webp) o PDF"
            }
            require(bytes.size <= 10 * 1024 * 1024) { "El archivo debe pesar menos de 10 MB" }

            val url = imageService.subirComprobanteEntrega(id, fileName ?: "comprobante.jpg", bytes)
            call.respond(HttpStatusCode.Created, mapOf("url" to url))
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
