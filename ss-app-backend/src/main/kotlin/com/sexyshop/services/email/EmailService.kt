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
    private val fromEmail = "onboarding@resend.dev"
    private val fromName = "Sexy Shop"

    suspend fun sendOrderConfirmationToCustomer(order: Order, items: List<OrderItem>, customerEmail: String) {
        if (config.resendApiKey.isEmpty()) return

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
                <h2 style="font-size:20px;margin:0 0 8px">¡Pedido confirmado!</h2>
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
                    <p style="margin:0;font-size:14px">${order.customerAddress ?: "Por confirmar"}</p>
                </div>
                <p style="margin-top:20px;color:#6b7280;font-size:14px">Te contactaremos por WhatsApp para coordinar el pago y la entrega.</p>
            </div>
            <div style="border-top:1px solid #eee;padding:16px 0;text-align:center;font-size:12px;color:#9ca3af">
                Sexy Shop — Tu tienda de confianza
            </div>
        </div>
        """.trimIndent()

        sendEmail(customerEmail, "Pedido #${order.id.take(8)} confirmado — Sexy Shop", html)
    }

    suspend fun sendNewOrderNotificationToAdmin(order: Order, items: List<OrderItem>) {
        if (config.resendApiKey.isEmpty()) return

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
                    <p style="margin:4px 0 0;font-size:14px">${order.customerAddress ?: "No especificada"}</p>
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

        sendEmail(config.notificationEmail, "🛒 Nueva venta #${order.id.take(8)} — \$${String.format("%.2f", order.total)}", html)
    }

    private suspend fun sendEmail(to: String, subject: String, html: String) {
        val client = HttpClient(CIO)
        try {
            val payload = buildJsonObject {
                put("from", "$fromName <$fromEmail>")
                put("to", buildJsonArray { add(to) })
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
