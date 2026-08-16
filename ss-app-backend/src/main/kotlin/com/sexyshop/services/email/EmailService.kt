package com.sexyshop.services.email

import com.sexyshop.config.AppConfig
import com.sexyshop.models.order.Order
import com.sexyshop.models.order.OrderItem
import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import kotlinx.serialization.json.*
import org.slf4j.LoggerFactory

class EmailService(private val config: AppConfig) {

    private val logger = LoggerFactory.getLogger("EmailService")
    private val fromEmail = config.resendFromEmail
    private val fromName = "Sexy Shop"

    /** Dirección legible a partir de los campos sueltos del checkout. */
    private fun formatAddress(order: Order): String {
        val calle = listOfNotNull(
            order.customerStreet?.takeIf { it.isNotBlank() },
            order.customerExtNum?.takeIf { it.isNotBlank() },
            order.customerIntNum?.takeIf { it.isNotBlank() }?.let { "int. $it" },
        ).joinToString(" ")
        val resto = listOfNotNull(
            order.customerNeighborhood?.takeIf { it.isNotBlank() },
            order.customerCity?.takeIf { it.isNotBlank() },
            order.customerState?.takeIf { it.isNotBlank() },
            order.customerZip?.takeIf { it.isNotBlank() }?.let { "C.P. $it" },
        ).joinToString(", ")
        val completa = listOf(calle, resto).filter { it.isNotBlank() }.joinToString(", ")
        return completa.ifBlank { order.customerAddress ?: "Por confirmar" }
    }

    suspend fun sendOrderConfirmationToCustomer(order: Order, items: List<OrderItem>, customerEmail: String) {
        if (config.resendApiKey.isEmpty()) {
            logger.warn("RESEND_API_KEY vacía: no se envió la confirmación a $customerEmail")
            return
        }
        // El texto cambia si ya pagó por Mercado Pago o si falta cobrar
        val yaPagado = order.paymentMethod == "mp"
        val cierre = if (yaPagado)
            "Tu pago ya está confirmado. Prepararemos tu pedido y te avisamos por WhatsApp en cuanto salga."
        else
            "Te contactaremos por WhatsApp para coordinar el pago y la entrega."

        val itemsHtml = items.joinToString("") { item ->
            "<tr><td style='padding:8px 12px;border-bottom:1px solid #eee'>${item.productName}</td>" +
            "<td style='padding:8px 12px;border-bottom:1px solid #eee;text-align:center'>${item.quantity}</td>" +
            "<td style='padding:8px 12px;border-bottom:1px solid #eee;text-align:right'>\$${String.format("%.2f", item.subtotal)}</td></tr>"
        }

        val html = """
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
            <div style="text-align:center;padding:24px 0;border-bottom:2px solid #E91E8C">
                <h1 style="margin:0;font-size:24px;color:#E91E8C">Sexy Shop</h1>
            </div>
            <div style="padding:24px 0">
                <h2 style="font-size:20px;margin:0 0 8px">${if (yaPagado) "¡Gracias por tu compra!" else "¡Pedido confirmado!"}</h2>
                <p style="color:#6b7280;margin:0 0 20px">Pedido #${order.id.take(8)}</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
                    <thead>
                        <tr style="background:#f9fafb">
                            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Producto</th>
                            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase">Cant.</th>
                            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>$itemsHtml</tbody>
                </table>
                <div style="background:#1a1a2e;color:#fff;padding:14px 16px;border-radius:8px;display:flex;justify-content:space-between;font-weight:600">
                    <span>Total</span>
                    <span>\$${String.format("%.2f", order.total)} MXN</span>
                </div>
                <div style="margin-top:20px;padding:16px;background:#f9fafb;border-radius:8px">
                    <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600">Dirección de envío</p>
                    <p style="margin:0;font-size:14px">${formatAddress(order)}</p>
                </div>
                <p style="margin-top:20px;color:#6b7280;font-size:14px">$cierre</p>
            </div>
            <div style="border-top:1px solid #eee;padding:16px 0;text-align:center;font-size:12px;color:#9ca3af">
                Sexy Shop — Tu tienda de confianza
            </div>
        </div>
        """.trimIndent()

        sendEmail(customerEmail, "Pedido #${order.id.take(8)} confirmado — Sexy Shop", html, config.replyToEmail)
    }

    /**
     * Acuse de recibo: el pedido llegó y está EN REVISIÓN, todavía no aceptado.
     * Es la protección de la tienda ante un error de precio o falta de
     * existencia: la compra no queda cerrada hasta que la tienda la confirma.
     * Por eso el texto nunca dice "confirmado" ni "aceptado".
     */
    suspend fun sendOrderReceivedToCustomer(order: Order, items: List<OrderItem>, customerEmail: String) {
        if (config.resendApiKey.isEmpty()) {
            logger.warn("RESEND_API_KEY vacía: no se envió el acuse a $customerEmail")
            return
        }

        val itemsHtml = items.joinToString("") { item ->
            "<tr><td style='padding:8px 12px;border-bottom:1px solid #eee'>${item.productName}</td>" +
            "<td style='padding:8px 12px;border-bottom:1px solid #eee;text-align:center'>${item.quantity}</td>" +
            "<td style='padding:8px 12px;border-bottom:1px solid #eee;text-align:right'>\$${String.format("%.2f", item.subtotal)}</td></tr>"
        }
        val pagado = order.paymentMethod == "mp"

        val html = """
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
            <div style="text-align:center;padding:24px 0;border-bottom:2px solid #E91E8C">
                <h1 style="margin:0;font-size:24px;color:#E91E8C">Sexy Shop</h1>
            </div>
            <div style="padding:24px 0">
                <h2 style="font-size:20px;margin:0 0 8px">Recibimos tu pedido</h2>
                <p style="color:#6b7280;margin:0 0 16px">Pedido #${order.id.take(8)}</p>
                <div style="padding:14px 16px;background:#FFF8E1;border:1px solid #F2B707;border-radius:8px;margin-bottom:20px">
                    <p style="margin:0;font-size:14px;line-height:1.6">
                        <strong>Tu pedido está en revisión.</strong> Verificamos existencia y datos antes de confirmarlo.
                        Te escribimos en cuanto quede confirmado, normalmente el mismo día hábil.
                    </p>
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
                    <thead>
                        <tr style="background:#f9fafb">
                            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Producto</th>
                            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase">Cant.</th>
                            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>$itemsHtml</tbody>
                </table>
                <div style="background:#1a1a2e;color:#fff;padding:14px 16px;border-radius:8px;display:flex;justify-content:space-between;font-weight:600">
                    <span>Total</span>
                    <span>\$${String.format("%.2f", order.total)} MXN</span>
                </div>
                <div style="margin-top:20px;padding:16px;background:#f9fafb;border-radius:8px">
                    <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600">Dirección de envío</p>
                    <p style="margin:0;font-size:14px">${formatAddress(order)}</p>
                </div>
                ${if (pagado) """
                <p style="margin-top:20px;color:#6b7280;font-size:13px;line-height:1.6">
                    Ya recibimos tu pago. Si no pudiéramos surtir tu pedido —por falta de existencia o
                    un error en el precio publicado— lo cancelamos y te devolvemos el 100% de tu dinero
                    por el mismo medio de pago.
                </p>""" else ""}
            </div>
            <div style="border-top:1px solid #eee;padding:16px 0;text-align:center;font-size:12px;color:#9ca3af">
                Sexy Shop — Tu tienda de confianza
            </div>
        </div>
        """.trimIndent()

        sendEmail(customerEmail, "Recibimos tu pedido #${order.id.take(8)} — en revisión", html, config.replyToEmail)
    }

    /** El pedido no se pudo surtir. Va con la promesa de devolución explícita. */
    suspend fun sendOrderCancelledToCustomer(order: Order, customerEmail: String) {
        if (config.resendApiKey.isEmpty()) {
            logger.warn("RESEND_API_KEY vacía: no se envió el aviso de cancelación a $customerEmail")
            return
        }
        val pagado = order.paymentMethod == "mp"

        val html = """
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
            <div style="text-align:center;padding:24px 0;border-bottom:2px solid #E91E8C">
                <h1 style="margin:0;font-size:24px;color:#E91E8C">Sexy Shop</h1>
            </div>
            <div style="padding:24px 0">
                <h2 style="font-size:20px;margin:0 0 8px">No pudimos completar tu pedido</h2>
                <p style="color:#6b7280;margin:0 0 20px">Pedido #${order.id.take(8)}</p>
                <p style="font-size:14px;line-height:1.7;margin:0 0 16px">
                    Lo sentimos: tu pedido por <strong>\$${String.format("%.2f", order.total)} MXN</strong> fue cancelado
                    y no se surtirá.
                </p>
                ${if (pagado) """
                <div style="padding:14px 16px;background:#E8F5F2;border:1px solid #2DA091;border-radius:8px;margin-bottom:16px">
                    <p style="margin:0;font-size:14px;line-height:1.6">
                        <strong>Tu dinero se devuelve completo</strong> por el mismo medio con el que pagaste.
                        El reembolso puede tardar unos días hábiles en reflejarse, según tu banco.
                    </p>
                </div>""" else ""}
                <p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0">
                    Si tienes cualquier duda, escríbenos por WhatsApp y con gusto te ayudamos.
                </p>
            </div>
            <div style="border-top:1px solid #eee;padding:16px 0;text-align:center;font-size:12px;color:#9ca3af">
                Sexy Shop — Tu tienda de confianza
            </div>
        </div>
        """.trimIndent()

        sendEmail(customerEmail, "Pedido #${order.id.take(8)} cancelado — Sexy Shop", html, config.replyToEmail)
    }

    suspend fun sendNewOrderNotificationToAdmin(order: Order, items: List<OrderItem>) {
        if (config.resendApiKey.isEmpty()) {
            logger.warn("RESEND_API_KEY vacía: no se envió el aviso de venta al admin")
            return
        }
        // Sin destinatario, Resend rechaza el envío y el error se perdía en el log
        if (config.notificationEmail.isBlank()) {
            logger.error("NOTIFICATION_EMAIL vacío: nadie recibirá el aviso de la venta #${order.id.take(8)}")
            return
        }

        val itemsList = items.joinToString("\n") { "• ${it.productName} x${it.quantity} — \$${String.format("%.2f", it.subtotal)}" }

        val html = """
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
            <div style="background:#1a1a2e;padding:20px;border-radius:12px 12px 0 0">
                <h1 style="margin:0;font-size:20px;color:#E91E8C">Nueva venta 🎉</h1>
                <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:14px">Pedido #${order.id.take(8)}</p>
            </div>
            <div style="padding:20px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
                <div style="margin-bottom:16px">
                    <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600">Cliente</p>
                    <p style="margin:4px 0 0;font-size:15px;font-weight:500">${order.customerName}</p>
                    <p style="margin:2px 0 0;font-size:14px;color:#6b7280">${order.customerPhone}</p>
                </div>
                <div style="margin-bottom:16px">
                    <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600">Dirección</p>
                    <p style="margin:4px 0 0;font-size:14px">${formatAddress(order)}</p>
                </div>
                <div style="margin-bottom:16px">
                    <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600">Productos</p>
                    <pre style="margin:4px 0 0;font-family:inherit;font-size:14px;white-space:pre-wrap">$itemsList</pre>
                </div>
                <div style="background:#E91E8C;color:#fff;padding:14px 16px;border-radius:8px;text-align:center;font-size:18px;font-weight:700">
                    Total: \$${String.format("%.2f", order.total)} MXN
                </div>
                ${if (order.notes != null) "<p style='margin-top:12px;padding:12px;background:#fffbeb;border-radius:8px;font-size:13px'><strong>Notas:</strong> ${order.notes}</p>" else ""}
            </div>
        </div>
        """.trimIndent()

        // Responder al aviso de venta escribe directo al comprador
        sendEmail(
            config.notificationEmail,
            "🛒 Nueva venta #${order.id.take(8)} — \$${String.format("%.2f", order.total)}",
            html,
            order.customerEmail,
        )
    }

    /**
     * @param replyTo a dónde va la respuesta si el destinatario contesta. El
     * dominio de la tienda no recibe correo, así que sin esto un "Responder"
     * del cliente caería en el vacío. En el aviso al admin se manda el correo
     * del comprador, para poder contestarle directo desde la bandeja.
     */
    private suspend fun sendEmail(to: String, subject: String, html: String, replyTo: String? = null) {
        val client = HttpClient(CIO)
        try {
            val payload = buildJsonObject {
                put("from", "$fromName <$fromEmail>")
                put("to", buildJsonArray { add(to) })
                replyTo?.takeIf { it.isNotBlank() }?.let { put("reply_to", it) }
                put("subject", subject)
                put("html", html)
            }

            val response = client.post("https://api.resend.com/emails") {
                header("Authorization", "Bearer ${config.resendApiKey}")
                contentType(ContentType.Application.Json)
                setBody(payload.toString())
            }

            if (response.status.isSuccess()) {
                logger.info("Email sent to $to: $subject")
            } else {
                logger.error("Email failed to $to: ${response.bodyAsText()}")
            }
        } catch (e: Exception) {
            logger.error("Email error", e)
        } finally {
            client.close()
        }
    }
}
