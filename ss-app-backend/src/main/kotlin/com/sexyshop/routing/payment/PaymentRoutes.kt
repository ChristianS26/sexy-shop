package com.sexyshop.routing.payment

import com.sexyshop.config.AppConfig
import com.sexyshop.models.order.OrderItemRequest
import com.sexyshop.models.order.OrderRequest
import com.sexyshop.services.email.EmailService
import com.sexyshop.services.order.OrderService
import com.sexyshop.services.product.ProductService
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
import org.slf4j.LoggerFactory

private val logger = LoggerFactory.getLogger("PaymentRoutes")
private val processedPayments = java.util.Collections.synchronizedSet(mutableSetOf<String>())

@Serializable
data class CreatePreferenceRequest(
    val items: List<PreferenceItem>,
    @SerialName("customer_name") val customerName: String,
    @SerialName("customer_phone") val customerPhone: String,
    @SerialName("customer_email") val customerEmail: String? = null,
    @SerialName("customer_address") val customerAddress: String? = null,
    @SerialName("customer_street") val customerStreet: String? = null,
    @SerialName("customer_ext_num") val customerExtNum: String? = null,
    @SerialName("customer_int_num") val customerIntNum: String? = null,
    @SerialName("customer_neighborhood") val customerNeighborhood: String? = null,
    @SerialName("customer_city") val customerCity: String? = null,
    @SerialName("customer_state") val customerState: String? = null,
    @SerialName("customer_zip") val customerZip: String? = null,
    @SerialName("customer_references") val customerReferences: String? = null,
    @SerialName("delivery_method") val deliveryMethod: String = "national",
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

fun Route.paymentRoutes(config: AppConfig, orderService: OrderService, emailService: EmailService, productService: ProductService) {
    // Select credentials based on test mode
    val activeToken = if (config.mpTestMode && config.mpTestAccessToken.isNotEmpty()) config.mpTestAccessToken else config.mpAccessToken
    val activePublicKey = if (config.mpTestMode && config.mpTestPublicKey.isNotEmpty()) config.mpTestPublicKey else config.mpPublicKey

    if (config.mpTestMode) {
        logger.info("Mercado Pago running in TEST MODE")
    }

    route("/payments") {
        post("/create-preference") {
            logger.info("MP create-preference called [build: payer-fix-v2]")
            if (activeToken.isEmpty()) {
                call.respond(HttpStatusCode.ServiceUnavailable, mapOf("error" to "Mercado Pago not configured"))
                return@post
            }

            val request = call.receive<CreatePreferenceRequest>()
            logger.info("MP request received: customerEmail present=${!request.customerEmail.isNullOrBlank()}, customerName=${request.customerName.isNotBlank()}, deliveryMethod=${request.deliveryMethod}")

            require(request.deliveryMethod in setOf("local", "national")) {
                "Invalid delivery_method: ${request.deliveryMethod}"
            }

            // Verify prices against database to prevent price manipulation
            val verifiedItems = request.items.map { item ->
                val productWithImages = productService.getById(item.productId)
                val product = productWithImages.product
                require(product.isActive) { "Product ${product.name} is not available" }
                require(product.stock >= item.quantity) { "Insufficient stock for ${product.name}" }
                item.copy(unitPrice = product.price, title = product.name)
            }

            // Server-side shipping calculation — never trust client values
            val itemsSubtotal = verifiedItems.sumOf { it.unitPrice * it.quantity }
            val shippingCost = OrderService.calculateShipping(request.deliveryMethod, itemsSubtotal)
            logger.info("MP shipping calculated: deliveryMethod=${request.deliveryMethod}, subtotal=$itemsSubtotal, shipping=$shippingCost")

            val mpItems = buildJsonArray {
                verifiedItems.forEach { item ->
                    addJsonObject {
                        put("title", item.title)
                        put("quantity", item.quantity)
                        put("unit_price", item.unitPrice)
                        put("currency_id", "MXN")
                    }
                }
                // Add shipping as a separate line item so the customer sees
                // the breakdown in MP's checkout and the total matches the cart.
                if (shippingCost > 0) {
                    addJsonObject {
                        put("title", if (request.deliveryMethod == "local") "Envío local (Guaymas)" else "Envío nacional")
                        put("quantity", 1)
                        put("unit_price", shippingCost)
                        put("currency_id", "MXN")
                    }
                }
            }

            val orderMeta = buildJsonObject {
                put("customer_name", request.customerName)
                put("customer_phone", request.customerPhone)
                request.customerEmail?.let { put("customer_email", it) }
                request.customerAddress?.let { put("customer_address", it) }
                request.customerStreet?.let { put("customer_street", it) }
                request.customerExtNum?.let { put("customer_ext_num", it) }
                request.customerIntNum?.let { put("customer_int_num", it) }
                request.customerNeighborhood?.let { put("customer_neighborhood", it) }
                request.customerCity?.let { put("customer_city", it) }
                request.customerState?.let { put("customer_state", it) }
                request.customerZip?.let { put("customer_zip", it) }
                request.customerReferences?.let { put("customer_references", it) }
                put("delivery_method", request.deliveryMethod)
                put("payment_method", "mp")
                request.notes?.let { put("notes", it) }
                put("items", buildJsonArray {
                    verifiedItems.forEach { item ->
                        addJsonObject {
                            put("product_id", item.productId)
                            put("quantity", item.quantity)
                        }
                    }
                })
            }

            // Build payer object — MP recommends sending at least email
            val nameParts = request.customerName.trim().split(" ", limit = 2)
            val firstName = nameParts.getOrNull(0) ?: ""
            val lastName = nameParts.getOrNull(1) ?: ""
            val phoneDigits = request.customerPhone.replace(Regex("[^0-9]"), "")
            val payerObj = buildJsonObject {
                if (!request.customerEmail.isNullOrBlank()) put("email", request.customerEmail)
                if (firstName.isNotBlank()) put("name", firstName)
                if (lastName.isNotBlank()) put("surname", lastName)
                if (phoneDigits.isNotBlank()) {
                    put("phone", buildJsonObject {
                        put("area_code", "52")
                        put("number", phoneDigits)
                    })
                }
                if (!request.customerStreet.isNullOrBlank()) {
                    put("address", buildJsonObject {
                        put("street_name", request.customerStreet)
                        if (!request.customerExtNum.isNullOrBlank()) {
                            request.customerExtNum.toIntOrNull()?.let { put("street_number", it) }
                        }
                        if (!request.customerZip.isNullOrBlank()) put("zip_code", request.customerZip)
                    })
                }
            }

            val mpPayload = buildJsonObject {
                put("items", mpItems)
                put("payer", payerObj)
                put("external_reference", orderMeta.toString())
                put("back_urls", buildJsonObject {
                    put("success", "${config.frontendUrl}/payment-success.html")
                    put("failure", "${config.frontendUrl}/payment-failure.html")
                    put("pending", "${config.frontendUrl}/payment-pending.html")
                })
                put("auto_return", "approved")
                put("statement_descriptor", "SEXY SHOP")
                put("notification_url", "${config.backendUrl}/api/payments/webhook")
            }

            val client = HttpClient(CIO)
            try {
                val response = client.post("https://api.mercadopago.com/checkout/preferences") {
                    header("Authorization", "Bearer $activeToken")
                    contentType(ContentType.Application.Json)
                    setBody(mpPayload.toString())
                }

                if (response.status.isSuccess()) {
                    val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
                    val prefId = body["id"]?.jsonPrimitive?.content ?: ""
                    val initPoint = if (config.mpTestMode) {
                        body["sandbox_init_point"]?.jsonPrimitive?.content ?: ""
                    } else {
                        body["init_point"]?.jsonPrimitive?.content ?: ""
                    }
                    call.respond(PreferenceResponse(id = prefId, initPoint = initPoint))
                } else {
                    val errorBody = response.bodyAsText()
                    logger.error("MP preference error: $errorBody")
                    call.respond(HttpStatusCode.BadGateway, mapOf("error" to "Error creating payment preference"))
                }
            } finally {
                client.close()
            }
        }

        // Mercado Pago webhook
        post("/webhook") {
            val body = call.receiveText()
            logger.info("MP webhook received: $body")

            // Verify webhook authenticity: we log signature headers for debugging,
            // but the real verification happens below when we call MP's API to GET
            // the payment and check status=approved. We never trust webhook data
            // directly — we always verify with Mercado Pago's API first.
            if (config.mpWebhookSecret.isNotEmpty()) {
                val xSignature = call.request.headers["x-signature"]
                val xRequestId = call.request.headers["x-request-id"]
                logger.info("Webhook headers: x-signature=$xSignature, x-request-id=$xRequestId")
            }

            // Respond 200 immediately (MP requires fast response)
            call.respond(HttpStatusCode.OK)

            // Parse and process
            try {
                val json = Json.parseToJsonElement(body).jsonObject
                val type = json["type"]?.jsonPrimitive?.content
                val action = json["action"]?.jsonPrimitive?.content

                if (type == "payment" && (action == "payment.created" || action == "payment.updated")) {
                    val paymentId = json["data"]?.jsonObject?.get("id")?.jsonPrimitive?.content
                        ?: return@post

                    // Prevent duplicate processing
                    if (paymentId in processedPayments) {
                        logger.info("Payment $paymentId already processed, skipping")
                        return@post
                    }
                    processedPayments.add(paymentId)

                    val client = HttpClient(CIO)
                    try {
                        val paymentResponse = client.get("https://api.mercadopago.com/v1/payments/$paymentId") {
                            header("Authorization", "Bearer $activeToken")
                        }

                        if (paymentResponse.status.isSuccess()) {
                            val payment = Json.parseToJsonElement(paymentResponse.bodyAsText()).jsonObject
                            val status = payment["status"]?.jsonPrimitive?.content

                            logger.info("MP payment $paymentId status: $status")

                            if (status == "approved") {
                                val externalRef = payment["external_reference"]?.jsonPrimitive?.content
                                if (externalRef != null) {
                                    createOrderFromPayment(externalRef, orderService, emailService)
                                }
                            }
                        }
                    } finally {
                        client.close()
                    }
                }
            } catch (e: Exception) {
                logger.error("Webhook processing error", e)
            }
        }

        get("/config") {
            call.respond(mapOf("public_key" to activePublicKey, "test_mode" to config.mpTestMode))
        }
    }
}

private suspend fun createOrderFromPayment(externalReference: String, orderService: OrderService, emailService: EmailService) {
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
            customerEmail = meta["customer_email"]?.jsonPrimitive?.content,
            customerAddress = meta["customer_address"]?.jsonPrimitive?.content,
            customerStreet = meta["customer_street"]?.jsonPrimitive?.content,
            customerExtNum = meta["customer_ext_num"]?.jsonPrimitive?.content,
            customerIntNum = meta["customer_int_num"]?.jsonPrimitive?.content,
            customerNeighborhood = meta["customer_neighborhood"]?.jsonPrimitive?.content,
            customerCity = meta["customer_city"]?.jsonPrimitive?.content,
            customerState = meta["customer_state"]?.jsonPrimitive?.content,
            customerZip = meta["customer_zip"]?.jsonPrimitive?.content,
            customerReferences = meta["customer_references"]?.jsonPrimitive?.content,
            deliveryMethod = meta["delivery_method"]?.jsonPrimitive?.content ?: "national",
            paymentMethod = "mp",
            notes = ((meta["notes"]?.jsonPrimitive?.content ?: "") + " [Pagado con Mercado Pago]").trim(),
            items = items,
        )

        val order = orderService.create(orderRequest)
        orderService.updateStatus(order.id, "confirmed")
        logger.info("Order created from MP payment: ${order.id}")

        // Send notification email
        val (_, orderItems) = orderService.getById(order.id)
        emailService.sendNewOrderNotificationToAdmin(order, orderItems)
    } catch (e: Exception) {
        logger.error("Failed to create order from MP payment", e)
    }
}
