package com.sexyshop.routing.payment

import com.sexyshop.config.AppConfig
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

fun Route.paymentRoutes(config: AppConfig) {
    route("/payments") {
        post("/create-preference") {
            if (config.mpAccessToken.isEmpty()) {
                call.respond(HttpStatusCode.ServiceUnavailable, mapOf("error" to "Mercado Pago not configured"))
                return@post
            }

            val request = call.receive<CreatePreferenceRequest>()

            // Build MP preference payload
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

            // Store order data as external_reference (JSON string with customer info)
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
            }

            // Call MP API
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
                    call.application.log.error("MP error: $errorBody")
                    call.respond(HttpStatusCode.BadGateway, mapOf("error" to "Error creating payment preference"))
                }
            } finally {
                client.close()
            }
        }

        // MP public key for frontend
        get("/config") {
            call.respond(mapOf("public_key" to config.mpPublicKey))
        }
    }
}
