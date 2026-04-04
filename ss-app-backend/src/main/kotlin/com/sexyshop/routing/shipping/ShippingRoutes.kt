package com.sexyshop.routing.shipping

import com.sexyshop.config.AppConfig
import com.sexyshop.plugins.requireAdmin
import io.github.jan.supabase.SupabaseClient
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

private val logger = LoggerFactory.getLogger("ShippingRoutes")

@Serializable
data class QuoteRequest(
    @SerialName("recipient_zip") val recipientZip: String,
    val weight: String = "1",
    val large: String = "25",
    val width: String = "20",
    val height: String = "15",
)

@Serializable
data class CreateLabelRequest(
    val currier: String,
    val service: String,
    @SerialName("recipient_name") val recipientName: String,
    @SerialName("recipient_phone") val recipientPhone: String,
    @SerialName("recipient_street") val recipientStreet: String,
    @SerialName("recipient_suburb") val recipientSuburb: String,
    @SerialName("recipient_zip") val recipientZip: String,
    @SerialName("recipient_city") val recipientCity: String,
    @SerialName("recipient_state") val recipientState: String,
    @SerialName("recipient_ext_num") val recipientExtNum: String = "",
    @SerialName("recipient_int_num") val recipientIntNum: String = "",
    val weight: String = "1",
)

fun Route.shippingRoutes(config: AppConfig, supabase: SupabaseClient) {
    route("/shipping") {
        // Quote shipping rates
        post("/quote") {
            if (!call.requireAdmin(supabase)) return@post

            if (config.epackApiKey.isEmpty()) {
                // Return mock data when API key not configured
                val mockQuotes = buildJsonArray {
                    addJsonObject {
                        put("Service", "Día Siguiente")
                        put("Currier", "estafeta")
                        put("Total", "120.50")
                        put("Weight", 1)
                    }
                    addJsonObject {
                        put("Service", "Express")
                        put("Currier", "fedex")
                        put("Total", "185.00")
                        put("Weight", 1)
                    }
                    addJsonObject {
                        put("Service", "Terrestre")
                        put("Currier", "dhl")
                        put("Total", "95.00")
                        put("Weight", 1)
                    }
                }
                call.respond(mapOf("result" to mockQuotes, "error" to false, "mock" to true))
                return@post
            }

            val request = call.receive<QuoteRequest>()

            val epackPayload = buildJsonObject {
                put("ltl", "0")
                put("shipperZip", config.shipperZip)
                put("recipientZip", request.recipientZip)
                put("weight", request.weight)
                put("large", request.large)
                put("width", request.width)
                put("height", request.height)
                put("secure", 0)
                put("secureValue", "0")
                put("pickup", "0")
                put("international", 0)
                put("content", "productos")
                put("shipperCountry", "MX")
                put("shipperCity", "Guaymas")
                put("shipperState", "Sonora")
                put("recipientCountry", "MX")
                put("recipientCity", "")
                put("recipientState", "")
                put("curriers", buildJsonArray {
                    add("dhl"); add("fedex"); add("estafeta"); add("redpack"); add("ups")
                })
            }

            val client = HttpClient(CIO)
            try {
                val response = client.post("https://api.epackenvios.com/v1/Quote") {
                    header("x-api-key", config.epackApiKey)
                    contentType(ContentType.Application.Json)
                    setBody(epackPayload.toString())
                }

                call.respondText(response.bodyAsText(), ContentType.Application.Json, response.status)
            } catch (e: Exception) {
                logger.error("Epack quote error", e)
                call.respond(HttpStatusCode.BadGateway, mapOf("error" to true, "message" to "Error connecting to Epack"))
            } finally {
                client.close()
            }
        }

        // Create shipping label
        post("/create-label") {
            if (!call.requireAdmin(supabase)) return@post

            if (config.epackApiKey.isEmpty()) {
                // Return mock data
                call.respond(mapOf(
                    "result" to mapOf(
                        "NumeroGuia" to "MOCK-${System.currentTimeMillis().toString().takeLast(8)}",
                        "pdf" to "https://example.com/mock-label.pdf"
                    ),
                    "error" to false,
                    "mock" to true
                ))
                return@post
            }

            val request = call.receive<CreateLabelRequest>()

            val epackPayload = buildJsonObject {
                put("ltl", false)
                put("shipperZip", config.shipperZip)
                put("recipientZip", request.recipientZip)
                put("weight", request.weight)
                put("large", "25")
                put("width", "20")
                put("height", "15")
                put("secure", "0")
                put("secureValue", "0")
                put("customs", "0")
                put("pickup", "0")
                put("international", 0)
                put("currier", request.currier)
                put("service", request.service)
                put("recipientName", request.recipientName)
                put("recipientPhone", request.recipientPhone)
                put("recipientStreet", request.recipientStreet)
                put("recipientStreet2", "")
                put("recipientStreetB1", "")
                put("recipientStreetB2", "")
                put("recipientSuburb", request.recipientSuburb)
                put("recipientCity", request.recipientCity)
                put("recipientState", request.recipientState)
                put("recipientZip", request.recipientZip)
                put("recipientCountry", "MX")
                put("recipientExternalNum", request.recipientExtNum)
                put("recipientInternalNum", request.recipientIntNum)
                put("recipientTaxId", "XAXX010101000")
                put("recipientCompanyName", request.recipientName)
                put("shipperName", "Sexy Shop Guaymas")
                put("shipperPhone", "6222279504")
                put("shipperStreet", "Guaymas Centro")
                put("shipperStreet2", "")
                put("shipperStreetB1", "")
                put("shipperStreetB2", "")
                put("shipperSuburb", "Centro")
                put("shipperCity", "Guaymas")
                put("shipperState", "Sonora")
                put("shipperCountry", "MX")
                put("shipperExternalNum", "")
                put("shipperInternalNum", "")
                put("shipperTaxId", "XAXX010101000")
                put("shipperCompanyName", "Sexy Shop")
                put("SatProductCode", "53131600")
                put("SatQuantity", 1)
                put("SatUnitOfMeasure", "H87")
                put("labelQuantity", 1)
            }

            val client = HttpClient(CIO)
            try {
                val response = client.post("https://api.epackenvios.com/v1/Create") {
                    header("x-api-key", config.epackApiKey)
                    contentType(ContentType.Application.Json)
                    setBody(epackPayload.toString())
                }

                call.respondText(response.bodyAsText(), ContentType.Application.Json, response.status)
            } catch (e: Exception) {
                logger.error("Epack create error", e)
                call.respond(HttpStatusCode.BadGateway, mapOf("error" to true, "message" to "Error connecting to Epack"))
            } finally {
                client.close()
            }
        }
    }
}
