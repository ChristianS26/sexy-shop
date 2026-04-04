package com.sexyshop.routing.payment

import com.sexyshop.config.AppConfig
import com.sexyshop.models.order.OrderItemRequest
import com.sexyshop.models.order.OrderRequest
import com.sexyshop.services.order.OrderService
import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class CreatePreferenceRequest(
    val items: List<PreferenceItem>,
    @SerialName("customer_name") val customerName: String,
    @SerialName("customer_phone") val customerPhone: String,
    @SerialName("customer_address") val customerAddress: String? = null,
    @SerialName("customer_street") val customerStreet: String? = null,
    @SerialName("customer_neighborhood") val customerNeighborhood: String? = null,
    @SerialName("customer_city") val customerCity: String? = null,
    @SerialName("customer_state") val customerState: String? = null,
    @SerialName("customer_zip") val customerZip: String? = null,
    @SerialName("customer_references") val customerReferences: String? = null,
    val notes: String? = null,
)

@Serializable
data class PreferenceItem(
    @SerialName("product_id") val productId: String,
    val title: String,
    val quantity: Int,
    @SerialName("unit_price") val unitPrice: Double,
)

@Serializable
data class PreferenceResponse(
    val id: String,
    @SerialName("init_point") val initPoint: String,
)

fun Route.paymentRoutes(config: AppConfig, orderService: OrderService) {
    route("/payments") {
        post("/create-preference") {
            if (config.mpAccessToken.isEmpty()) {
                call.respond(HttpStatusCode.ServiceUnavailable, mapOf("error" to "Mercado Pago not configured"))
                return@post
            }

            val request = call.receive<CreatePreferenceRequest>()

            val mpItems = buildJsonArray {
                request.items.forEach { item ->
                    addJsonObject {
                        put("title", item.title)
                        put("quantity", item.quantity)
                        put("unit_price", item.unitPrice)
                        put("currency_id", "MXN")
                    }
                }
            }

            val orderMeta = buildJsonObject {
                put("customer_name", request.customerName)
                put("customer_phone", request.customerPhone)
                request.customerAddress?.let { put("customer_address", it) }
                request.customerStreet?.let { put("customer_street", it) }
                request.customerNeighborhood?.let { put("customer_neighborhood", it) }
                request.customerCity?.let { put("customer_city", it) }
                request.customerState?.let { put("customer_state", it) }
                request.customerZip?.let { put("customer_zip", it) }
                request.customerReferences?.let { put("customer_references", it) }
                request.notes?.let { put("notes", it) }
                put("items", buildJsonArray {
                    request.items.forEach { item ->
                        addJsonObject {
                            put("product_id", item.productId)
                            put("quantity", item.quantity)
                        }
                    }
                })
            }

            val mpPayload = buildJsonObject {
                put("items", mpItems)
                put("external_reference", orderMeta.toString())
                put("back_urls", buildJsonObject {
                    put("success", "${config.frontendUrl}/payment-success.html")
                    put("failure", "${config.frontendUrl}/payment-failure.html")
                    put("pending", "${config.frontendUrl}/payment-pending.html")
                })
                put("auto_return", "approved")
                put("statement_descriptor", "SEXY SHOP")
                put("notification_url", "https://ss-app-backend-production.up.railway.app/api/payments/webhook")
            }

            val client = HttpClient(CIO)
            try {
                val response = client.post("https://api.mercadopago.com/checkout/preferences") {
                    header("Authorization", "Bearer ${config.mpAccessToken}")
                    contentType(ContentType.Application.Json)
                    setBody(mpPayload.toString())
                }

                if (response.status.isSuccess()) {
                    val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
                    val prefId = body["id"]?.jsonPrimitive?.content ?: ""
                    val initPoint = body["init_point"]?.jsonPrimitive?.content ?: ""
                    call.respond(PreferenceResponse(id = prefId, initPoint = initPoint))
                } else {
                    val errorBody = response.bodyAsText()
                    call.application.log.error("MP preference error: $errorBody")
                    call.respond(HttpStatusCode.BadGateway, mapOf("error" to "Error creating payment preference"))
                }
            } finally {
                client.close()
            }
        }

        // Mercado Pago webhook
        post("/webhook") {
            val body = call.receiveText()
            call.application.log.info("MP webhook received: $body")

            // Respond 200 immediately (MP requires fast response)
            call.respond(HttpStatusCode.OK)

            // Parse webhook
            try {
                val json = Json.parseToJsonElement(body).jsonObject
                val type = json["type"]?.jsonPrimitive?.content
                val action = json["action"]?.jsonPrimitive?.content

                if (type == "payment" && action == "payment.created") {
                    val paymentId = json["data"]?.jsonObject?.get("id")?.jsonPrimitive?.content
                        ?: return@post

                    // Get payment details from MP API
                    val client = HttpClient(CIO)
                    try {
                        val paymentResponse = client.get("https://api.mercadopago.com/v1/payments/$paymentId") {
                            header("Authorization", "Bearer ${config.mpAccessToken}")
                        }

                        if (paymentResponse.status.isSuccess()) {
                            val payment = Json.parseToJsonElement(paymentResponse.bodyAsText()).jsonObject
                            val status = payment["status"]?.jsonPrimitive?.content

                            if (status == "approved") {
                                val externalRef = payment["external_reference"]?.jsonPrimitive?.content
                                if (externalRef != null) {
                                    createOrderFromPayment(externalRef, orderService, call)
                                }
                            }

                            call.application.log.info("MP payment $paymentId status: $status")
                        }
                    } finally {
                        client.close()
                    }
                }
            } catch (e: Exception) {
                call.application.log.error("Webhook processing error", e)
            }
        }

        get("/config") {
            call.respond(mapOf("public_key" to config.mpPublicKey))
        }
    }
}

private suspend fun createOrderFromPayment(
    externalReference: String,
    orderService: OrderService,
    call: io.ktor.server.routing.RoutingCall,
) {
    try {
        val meta = Json.parseToJsonElement(externalReference).jsonObject
        val items = meta["items"]?.jsonArray?.map { item ->
            val obj = item.jsonObject
            OrderItemRequest(
                productId = obj["product_id"]!!.jsonPrimitive.content,
                quantity = obj["quantity"]!!.jsonPrimitive.int,
            )
        } ?: return

        val orderRequest = OrderRequest(
            customerName = meta["customer_name"]!!.jsonPrimitive.content,
            customerPhone = meta["customer_phone"]!!.jsonPrimitive.content,
            customerAddress = meta["customer_address"]?.jsonPrimitive?.content,
            customerStreet = meta["customer_street"]?.jsonPrimitive?.content,
            customerNeighborhood = meta["customer_neighborhood"]?.jsonPrimitive?.content,
            customerCity = meta["customer_city"]?.jsonPrimitive?.content,
            customerState = meta["customer_state"]?.jsonPrimitive?.content,
            customerZip = meta["customer_zip"]?.jsonPrimitive?.content,
            customerReferences = meta["customer_references"]?.jsonPrimitive?.content,
            notes = (meta["notes"]?.jsonPrimitive?.content ?: "") + " [Pagado con Mercado Pago]",
            items = items,
        )

        val order = orderService.create(orderRequest)
        // Auto-confirm since payment is approved
        orderService.updateStatus(order.id, "confirmed")
        call.application.log.info("Order created from MP payment: ${order.id}")
    } catch (e: Exception) {
        call.application.log.error("Failed to create order from MP payment", e)
    }
}
