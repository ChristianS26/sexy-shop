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
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

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
    // El comprador marcó la casilla de "acepto términos y aviso de privacidad".
    // Solo llega el sí/no: la hora la pone el servidor, porque la del navegador
    // la puede escribir cualquiera y entonces no probaría nada.
    @SerialName("terms_accepted") val termsAccepted: Boolean = false,
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

@Serializable
data class PaymentConfigResponse(
    @SerialName("public_key") val publicKey: String,
    @SerialName("test_mode") val testMode: Boolean,
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

            // Sin esto, un carrito vacío generaba una preferencia de $0 en MP.
            require(request.items.isNotEmpty() && request.items.size <= 50) { "Carrito inválido" }
            request.items.forEach { require(it.quantity > 0) { "Cantidad inválida" } }

            // Correo obligatorio: sin él no hay a dónde mandar el comprobante ni
            // el aviso de confirmación, y ante un contracargo no habría manera
            // de probar que al comprador se le informó de nada.
            val correo = request.customerEmail?.trim().orEmpty()
            require(correo.matches(Regex("^[^@\\s]+@[^@\\s.]+\\.[^@\\s]+$"))) {
                "Correo electrónico requerido"
            }
            // Aceptación de términos: la hora la sella el servidor.
            require(request.termsAccepted) { "Debes aceptar los términos y condiciones" }
            val aceptadosEn = java.time.Instant.now().toString()

            // Verify prices against database to prevent price manipulation.
            // El stock se compara contra el total pedido del producto, no
            // renglón por renglón, por si el mismo artículo llega repetido.
            val pedidoPorProducto = request.items.groupBy { it.productId }
                .mapValues { (_, i) -> i.sumOf { it.quantity } }

            val verifiedSlugs = mutableListOf<String>()
            val verifiedItems = request.items.map { item ->
                val productWithImages = productService.getById(item.productId)
                val product = productWithImages.product
                require(product.isActive) { "Product ${product.name} is not available" }
                val totalPedido = pedidoPorProducto[product.id] ?: item.quantity
                require(product.stock >= totalPedido) { "Insufficient stock for ${product.name}" }
                verifiedSlugs.add(product.slug)
                item.copy(unitPrice = product.price, title = product.name)
            }

            // Server-side shipping calculation — never trust client values
            val itemsSubtotal = verifiedItems.sumOf { it.unitPrice * it.quantity }
            val shippingCost = if (OrderService.esCarritoDePrueba(verifiedSlugs)) 0.0
                else OrderService.calculateShipping(request.deliveryMethod, itemsSubtotal)
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

            // El comprador debe volver al MISMO dominio desde el que compró
            // (sexyshoptoys.com.mx o la página de GitHub). Se toma del Origin,
            // con Referer de respaldo, y SOLO si está en la lista blanca:
            // reflejar cualquier origen convertiría el checkout de MP en un
            // redirector hacia sitios ajenos.
            val requestOrigin = call.request.headers[HttpHeaders.Origin]
                ?: call.request.headers[HttpHeaders.Referrer]?.let { ref ->
                    runCatching { java.net.URI(ref) }.getOrNull()
                        ?.takeIf { it.scheme != null && it.authority != null }
                        ?.let { "${it.scheme}://${it.authority}" }
                }
            val returnBase = if (com.sexyshop.config.FrontendOrigins.isValidReturnOrigin(requestOrigin)) {
                com.sexyshop.config.FrontendOrigins.returnBaseFor(requestOrigin!!)
            } else {
                config.frontendUrl
            }
            logger.info("MP preferencia: back_urls=$returnBase (origin: ${requestOrigin ?: "ninguno"})")

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
                put("terms_accepted_at", aceptadosEn)
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

            // external_reference maxes out at 256 chars in MP; the full order JSON is
            // ~500+ and silently breaks payment processing if placed there. Carry a
            // short reference here and stash the order payload in metadata.order, which
            // we read back in the webhook (payment -> merchant_order -> preference).
            val orderRef = java.util.UUID.randomUUID().toString()

            val mpPayload = buildJsonObject {
                put("items", mpItems)
                put("payer", payerObj)
                put("external_reference", orderRef)
                put("metadata", buildJsonObject { put("order", orderMeta.toString()) })
                put("back_urls", buildJsonObject {
                    put("success", "$returnBase/payment-success.html")
                    put("failure", "$returnBase/payment-failure.html")
                    put("pending", "$returnBase/payment-pending.html")
                })
                put("auto_return", "approved")
                // Sólo tarjeta. OXXO, PayCash y SPEI nacen en "pending" y se
                // acreditan hasta 48 h después, y el flujo de acá no lo soporta:
                // no se aparta inventario durante la espera ni se congela el
                // precio, así que un pago en efectivo podía quedar cobrado sin
                // generar pedido. Para encenderlos hay que resolver eso primero.
                put("payment_methods", buildJsonObject {
                    put("excluded_payment_types", buildJsonArray {
                        addJsonObject { put("id", "ticket") }        // OXXO, PayCash
                        addJsonObject { put("id", "atm") }           // depósito en cajero
                        addJsonObject { put("id", "bank_transfer") } // SPEI / CLABE
                    })
                })
                // Aprobado o rechazado en el momento: sin pagos "en revisión"
                // que se resuelvan horas después, que caen en el mismo hueco.
                put("binary_mode", true)
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
                    // Always use init_point. With TEST credentials the checkout is
                    // already in test mode, and the legacy sandbox.mercadopago.com.mx
                    // domain (sandbox_init_point) triggers ERR_TOO_MANY_REDIRECTS.
                    // Pay with a MP TEST USER + test cards — never a real account.
                    val initPoint = body["init_point"]?.jsonPrimitive?.content
                        ?: body["sandbox_init_point"]?.jsonPrimitive?.content ?: ""
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

            // Verify webhook authenticity via HMAC-SHA256 of the x-signature header
            // (Mercado Pago's documented scheme). This is defense-in-depth: even a
            // valid signature still passes through the API GET payment verification
            // below before any order is created. When MP_WEBHOOK_SECRET is empty we
            // skip validation — that also acts as a kill-switch (clear the env var in
            // Railway to disable signature checks without a redeploy of code).
            if (config.mpWebhookSecret.isNotEmpty()) {
                val xSignature = call.request.headers["x-signature"]
                val xRequestId = call.request.headers["x-request-id"]
                // MP signs over data.id from the query string; fall back to the body.
                val dataId = call.request.queryParameters["data.id"]
                    ?: call.request.queryParameters["id"]
                    ?: runCatching {
                        Json.parseToJsonElement(body).jsonObject["data"]
                            ?.jsonObject?.get("id")?.jsonPrimitive?.content
                    }.getOrNull()

                if (!verifyMpWebhookSignature(config.mpWebhookSecret, xSignature, xRequestId, dataId)) {
                    logger.warn("MP webhook signature INVALID — rejecting (x-request-id=$xRequestId, data.id=$dataId)")
                    call.respond(HttpStatusCode.Unauthorized)
                    return@post
                }
                logger.info("MP webhook signature verified OK")
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

                    // Prevent duplicate processing. Marked AFTER handling, not here:
                    // marking on first sight burned the initial "pending" notification
                    // and the later "approved" one was skipped, leaving a charged
                    // payment with no order.
                    if (paymentId in processedPayments) {
                        logger.info("Payment $paymentId already processed, skipping")
                        return@post
                    }

                    val client = HttpClient(CIO)
                    try {
                        val paymentResponse = client.get("https://api.mercadopago.com/v1/payments/$paymentId") {
                            header("Authorization", "Bearer $activeToken")
                        }

                        if (paymentResponse.status.isSuccess()) {
                            val payment = Json.parseToJsonElement(paymentResponse.bodyAsText()).jsonObject
                            val status = payment["status"]?.jsonPrimitive?.content

                            logger.info("MP payment $paymentId status: $status")

                            when (status) {
                                "approved" -> {
                                    // El candado en memoria se vacía con cada reinicio de
                                    // Railway; la garantía real contra duplicados es el
                                    // índice único de orders.mp_payment_id.
                                    val yaExiste = orderService.existePorPagoMp(paymentId)
                                    if (yaExiste) {
                                        logger.info("Pago $paymentId ya tenía pedido en la base, se omite")
                                        processedPayments.add(paymentId)
                                        return@post
                                    }
                                    // New preferences carry the order JSON in metadata.order
                                    // (external_reference is capped at 256 chars). Old in-flight
                                    // preferences still have the JSON in external_reference.
                                    val externalRef = payment["external_reference"]?.jsonPrimitive?.content
                                    val orderMetaJson = fetchOrderMeta(payment, client, activeToken)
                                        ?: externalRef?.takeIf { it.trim().startsWith("{") }
                                    if (orderMetaJson != null) {
                                        createOrderFromPayment(orderMetaJson, payment, orderService, emailService)
                                        processedPayments.add(paymentId)
                                    } else {
                                        // Left unmarked: if the metadata lookup failed
                                        // transiently, MP's retry must be able to come back.
                                        logger.error("Payment $paymentId approved but order metadata not found")
                                    }
                                }
                                // A payment not yet accredited can be approved later:
                                // leave it unmarked so the next notification gets through.
                                "pending", "in_process", "authorized" ->
                                    logger.info("Payment $paymentId still $status, waiting for approval notification")
                                else -> {
                                    logger.info("Payment $paymentId in status $status, no order created")
                                    processedPayments.add(paymentId)
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
            // A mapOf with mixed value types (String + Boolean) is Map<String, Any>,
            // which kotlinx.serialization cannot serialize — it 500'd in production.
            call.respond(PaymentConfigResponse(publicKey = activePublicKey, testMode = config.mpTestMode))
        }
    }
}

/**
 * Verifies a Mercado Pago webhook signature.
 *
 * MP sends an `x-signature` header shaped like `ts=<unix>,v1=<hmac-hex>`. The HMAC is
 * HMAC-SHA256, keyed by the webhook secret, over the manifest:
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * Segments are included only when their value is present; an alphanumeric data.id is
 * lowercased. Comparison is constant-time.
 * Ref: https://www.mercadopago.com.mx/developers/es/docs/your-integrations/notifications/webhooks
 */
private fun verifyMpWebhookSignature(
    secret: String,
    xSignature: String?,
    xRequestId: String?,
    dataId: String?,
): Boolean {
    if (xSignature.isNullOrBlank()) return false

    var ts: String? = null
    var v1: String? = null
    xSignature.split(",").forEach { part ->
        val kv = part.split("=", limit = 2)
        if (kv.size == 2) {
            when (kv[0].trim()) {
                "ts" -> ts = kv[1].trim()
                "v1" -> v1 = kv[1].trim()
            }
        }
    }
    val tsVal = ts
    val v1Val = v1
    if (tsVal.isNullOrBlank() || v1Val.isNullOrBlank()) return false

    val manifest = buildString {
        if (!dataId.isNullOrBlank()) append("id:${dataId.lowercase()};")
        if (!xRequestId.isNullOrBlank()) append("request-id:$xRequestId;")
        append("ts:$tsVal;")
    }

    return try {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val computed = mac.doFinal(manifest.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        MessageDigest.isEqual(computed.toByteArray(Charsets.UTF_8), v1Val.toByteArray(Charsets.UTF_8))
    } catch (e: Exception) {
        logger.error("Error verifying MP webhook signature", e)
        false
    }
}

/**
 * Retrieves the order metadata JSON for an approved payment. It lives in the
 * preference's metadata.order (external_reference is capped at 256 chars and cannot
 * hold the full order). We try the payment's own metadata first (if MP propagated it),
 * then fall back to payment -> merchant_order -> preference -> metadata.order.
 */
private suspend fun fetchOrderMeta(payment: JsonObject, client: HttpClient, accessToken: String): String? {
    (payment["metadata"] as? JsonObject)?.get("order")?.let { el ->
        (el as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() }?.let { return it }
    }

    val merchantOrderId = (payment["order"] as? JsonObject)?.get("id")
        ?.let { (it as? JsonPrimitive)?.content } ?: return null

    val moResp = client.get("https://api.mercadopago.com/merchant_orders/$merchantOrderId") {
        header("Authorization", "Bearer $accessToken")
    }
    if (!moResp.status.isSuccess()) return null
    val preferenceId = (Json.parseToJsonElement(moResp.bodyAsText()) as? JsonObject)
        ?.get("preference_id")?.let { (it as? JsonPrimitive)?.content } ?: return null

    val prefResp = client.get("https://api.mercadopago.com/checkout/preferences/$preferenceId") {
        header("Authorization", "Bearer $accessToken")
    }
    if (!prefResp.status.isSuccess()) return null
    val prefMeta = (Json.parseToJsonElement(prefResp.bodyAsText()) as? JsonObject)?.get("metadata") as? JsonObject
    return (prefMeta?.get("order") as? JsonPrimitive)?.content
}

private suspend fun createOrderFromPayment(
    externalReference: String,
    payment: JsonObject,
    orderService: OrderService,
    emailService: EmailService,
) {
    try {
        val meta = Json.parseToJsonElement(externalReference).jsonObject

        // Lo que MP cobró de comisión y lo que quedó neto. Sale del pago mismo,
        // así el admin muestra números reales en vez de estimar el 4-5%.
        val fee = payment["fee_details"]?.jsonArray
            ?.sumOf { it.jsonObject["amount"]?.jsonPrimitive?.doubleOrNull ?: 0.0 }
        val net = payment["transaction_details"]?.jsonObject
            ?.get("net_received_amount")?.jsonPrimitive?.doubleOrNull
        val mpMethod = listOfNotNull(
            payment["payment_method_id"]?.jsonPrimitive?.contentOrNull,
            payment["payment_type_id"]?.jsonPrimitive?.contentOrNull,
        ).joinToString("/").ifBlank { null }
        logger.info("MP pago ${payment["id"]?.jsonPrimitive?.contentOrNull}: comisión=$fee neto=$net método=$mpMethod")

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
            mpPaymentId = payment["id"]?.jsonPrimitive?.contentOrNull,
            mpFee = fee,
            mpNet = net,
            mpInstallments = payment["installments"]?.jsonPrimitive?.intOrNull,
            mpMethod = mpMethod,
            termsAcceptedAt = meta["terms_accepted_at"]?.jsonPrimitive?.contentOrNull,
            notes = ((meta["notes"]?.jsonPrimitive?.content ?: "") + " [Pagado con Mercado Pago]").trim(),
            items = items,
        )

        // El pedido entra como PENDIENTE, no confirmado. La tienda revisa
        // existencia y precio antes de aceptarlo; hasta entonces la compra no
        // queda cerrada. Confirmarlo automáticamente nos obligaría a surtir
        // aunque el precio publicado estuviera mal o no hubiera existencia.
        val order = orderService.create(orderRequest)
        logger.info("Pedido creado desde pago MP (queda pendiente de confirmar): ${order.id}")

        // Avisos por correo. El de la tienda ya estaba; faltaba el comprobante
        // al comprador: en el flujo de MP nunca se enviaba, así que quien pagaba
        // se quedaba sin ningún correo de su compra.
        val (fullOrder, orderItems) = orderService.getById(order.id)
        emailService.sendNewOrderNotificationToAdmin(fullOrder, orderItems)
        val email = fullOrder.customerEmail
        if (!email.isNullOrBlank()) {
            // Acuse de recibo, NO confirmación: el de confirmación sale cuando
            // la tienda acepta el pedido desde el admin.
            emailService.sendOrderReceivedToCustomer(fullOrder, orderItems, email)
        } else {
            logger.info("Pedido ${order.id.take(8)} sin email del cliente: no se envía comprobante")
        }
    } catch (e: Exception) {
        logger.error("Failed to create order from MP payment", e)
    }
}
