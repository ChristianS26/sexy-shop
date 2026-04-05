package com.sexyshop.routing.shipping

import com.sexyshop.config.AppConfig
import com.sexyshop.models.shipment.Shipment
import com.sexyshop.plugins.requireAdmin
import com.sexyshop.repositories.shipment.ShipmentRepository
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

private val stateAbbreviations = mapOf(
    "aguascalientes" to "AG", "baja california" to "BC", "baja california sur" to "BS",
    "campeche" to "CM", "chiapas" to "CS", "chihuahua" to "CH", "ciudad de mexico" to "CMX",
    "cdmx" to "CMX", "coahuila" to "CO", "colima" to "CL", "durango" to "DG",
    "guanajuato" to "GT", "guerrero" to "GR", "hidalgo" to "HG", "jalisco" to "JA",
    "mexico" to "MX", "estado de mexico" to "MX", "michoacan" to "MI", "michoacán" to "MI",
    "morelos" to "MO", "nayarit" to "NA", "nuevo leon" to "NL", "nuevo león" to "NL",
    "oaxaca" to "OA", "puebla" to "PU", "queretaro" to "QT", "querétaro" to "QT",
    "quintana roo" to "QR", "san luis potosi" to "SL", "san luis potosí" to "SL",
    "sinaloa" to "SI", "sonora" to "SON", "tabasco" to "TB", "tamaulipas" to "TM",
    "tlaxcala" to "TL", "veracruz" to "VE", "yucatan" to "YU", "yucatán" to "YU",
    "zacatecas" to "ZA",
)

private fun abbreviateState(state: String): String {
    val normalized = state.trim().lowercase()
        .replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
    return stateAbbreviations[normalized] ?: stateAbbreviations[state.trim().lowercase()] ?: state
}

@Serializable
data class QuoteRequest(
    @SerialName("recipient_zip") val recipientZip: String,
    @SerialName("recipient_city") val recipientCity: String = "",
    @SerialName("recipient_state") val recipientState: String = "",
    val weight: String = "1",
    val large: String = "25",
    val width: String = "20",
    val height: String = "15",
)

@Serializable
data class CreateLabelRequest(
    @SerialName("order_id") val orderId: String,
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

fun Route.shippingRoutes(config: AppConfig, supabase: SupabaseClient, shipmentRepository: ShipmentRepository) {
    route("/shipping") {
        // Quote shipping rates
        post("/quote") {
            if (!call.requireAdmin(supabase)) return@post

            if (config.epackApiKey.isEmpty()) {
                val mockResponse = buildJsonObject {
                    put("result", buildJsonArray {
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
                    })
                    put("error", false)
                    put("mock", true)
                }
                call.respondText(mockResponse.toString(), ContentType.Application.Json)
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

        // Quote via Envia.com
        post("/quote-envia") {
            if (!call.requireAdmin(supabase)) return@post

            if (config.enviaApiKey.isEmpty()) {
                val mockResponse = buildJsonObject {
                    put("data", buildJsonArray {
                        addJsonObject {
                            put("carrier", "estafeta")
                            put("service", "ground")
                            put("serviceDescription", "Estafeta Terrestre")
                            put("totalPrice", 156)
                            put("deliveryEstimate", "1-2 días")
                        }
                        addJsonObject {
                            put("carrier", "dhl")
                            put("service", "ground")
                            put("serviceDescription", "DHL Economy")
                            put("totalPrice", 180)
                            put("deliveryEstimate", "1-4 días")
                        }
                        addJsonObject {
                            put("carrier", "fedex")
                            put("service", "ground")
                            put("serviceDescription", "FedEx Terrestre")
                            put("totalPrice", 206)
                            put("deliveryEstimate", "2-4 días")
                        }
                    })
                    put("mock", true)
                }
                call.respondText(mockResponse.toString(), ContentType.Application.Json)
                return@post
            }

            val request = call.receive<QuoteRequest>()
            val carriers = listOf("estafeta", "dhl", "fedex", "ups")
            val allQuotes = buildJsonArray {
                for (carrier in carriers) {
                    val payload = buildJsonObject {
                        put("origin", buildJsonObject {
                            put("name", "Sexy Shop")
                            put("phone", "+526222279504")
                            put("street", "Centro")
                            put("city", "Guaymas")
                            put("state", "SON")
                            put("country", "MX")
                            put("postalCode", config.shipperZip)
                        })
                        put("destination", buildJsonObject {
                            put("name", "Cliente")
                            put("phone", "+520000000000")
                            put("street", "Destino")
                            put("city", request.recipientCity.ifEmpty { "Ciudad" })
                            put("state", abbreviateState(request.recipientState.ifEmpty { "Estado" }))
                            put("country", "MX")
                            put("postalCode", request.recipientZip)
                        })
                        put("packages", buildJsonArray {
                            addJsonObject {
                                put("type", "box")
                                put("content", "productos")
                                put("amount", 1)
                                put("declaredValue", 500)
                                put("lengthUnit", "CM")
                                put("weightUnit", "KG")
                                put("weight", request.weight.toDoubleOrNull() ?: 1.0)
                                put("dimensions", buildJsonObject {
                                    put("length", request.large.toIntOrNull() ?: 25)
                                    put("width", request.width.toIntOrNull() ?: 20)
                                    put("height", request.height.toIntOrNull() ?: 15)
                                })
                            }
                        })
                        put("shipment", buildJsonObject {
                            put("type", 1)
                            put("carrier", carrier)
                        })
                    }

                    val client = HttpClient(CIO)
                    try {
                        val response = client.post("https://api.envia.com/ship/rate/") {
                            header("Authorization", "Bearer ${config.enviaApiKey}")
                            contentType(ContentType.Application.Json)
                            setBody(payload.toString())
                        }
                        if (response.status.isSuccess()) {
                            val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
                            val data = body["data"]?.jsonArray
                            data?.forEach { add(it) }
                        }
                    } catch (e: Exception) {
                        logger.error("Envia quote error for $carrier", e)
                    } finally {
                        client.close()
                    }
                }
            }

            val result = buildJsonObject {
                put("data", allQuotes)
                put("mock", false)
            }
            call.respondText(result.toString(), ContentType.Application.Json)
        }

        // Create shipping label via Envia.com
        post("/create-label-envia") {
            if (!call.requireAdmin(supabase)) return@post

            val request = call.receive<CreateLabelRequest>()

            if (config.enviaApiKey.isEmpty()) {
                val guia = "ENVIA-MOCK-${System.currentTimeMillis().toString().takeLast(8)}"
                val pdf = "https://example.com/mock-envia-label.pdf"
                shipmentRepository.create(Shipment(
                    orderId = request.orderId,
                    carrier = request.currier,
                    service = request.service,
                    trackingNumber = guia,
                    labelUrl = pdf,
                    cost = 0.0,
                ))
                val mockLabel = buildJsonObject {
                    put("result", buildJsonObject { put("NumeroGuia", guia); put("pdf", pdf) })
                    put("error", false)
                    put("mock", true)
                }
                call.respondText(mockLabel.toString(), ContentType.Application.Json)
                return@post
            }

            val enviaPayload = buildJsonObject {
                put("origin", buildJsonObject {
                    put("name", "Sexy Shop")
                    put("phone", "+526222279504")
                    put("street", "Centro")
                    put("number", "SN")
                    put("city", "Guaymas")
                    put("state", "SON")
                    put("country", "MX")
                    put("postalCode", config.shipperZip)
                })
                put("destination", buildJsonObject {
                    put("name", request.recipientName)
                    put("phone", "+52${request.recipientPhone.replace(Regex("[^0-9]"), "")}")
                    put("street", request.recipientStreet)
                    put("number", request.recipientExtNum.ifEmpty { "SN" })
                    put("street2", request.recipientIntNum.ifEmpty { "" })
                    put("city", request.recipientCity)
                    put("state", abbreviateState(request.recipientState))
                    put("country", "MX")
                    put("postalCode", request.recipientZip)
                })
                put("settings", buildJsonObject {
                    put("printFormat", "PDF")
                    put("printSize", "STOCK_4X6")
                    put("currency", "MXN")
                })
                put("packages", buildJsonArray {
                    addJsonObject {
                        put("type", "box")
                        put("content", "productos")
                        put("amount", 1)
                        put("declaredValue", 500)
                        put("lengthUnit", "CM")
                        put("weightUnit", "KG")
                        put("weight", request.weight.toDoubleOrNull() ?: 1.0)
                        put("dimensions", buildJsonObject {
                            put("length", 25)
                            put("width", 20)
                            put("height", 15)
                        })
                    }
                })
                put("shipment", buildJsonObject {
                    put("type", 1)
                    put("carrier", request.currier)
                    put("service", request.service)
                })
            }

            val client = HttpClient(CIO)
            try {
                val response = client.post("https://api.envia.com/ship/generate/") {
                    header("Authorization", "Bearer ${config.enviaApiKey}")
                    contentType(ContentType.Application.Json)
                    setBody(enviaPayload.toString())
                }

                val responseBody = response.bodyAsText()
                val responseJson = Json.parseToJsonElement(responseBody).jsonObject

                // Check for Envia error
                val meta = responseJson["meta"]?.jsonPrimitive?.content
                if (meta == "error") {
                    val errorObj = responseJson["error"]?.jsonObject
                    val errorMsg = errorObj?.get("message")?.jsonPrimitive?.content ?: "Error desconocido"
                    logger.error("Envia create label error: $errorMsg")
                    val errorResult = buildJsonObject {
                        put("error", true)
                        put("message", errorMsg)
                    }
                    call.respondText(errorResult.toString(), ContentType.Application.Json, HttpStatusCode.BadRequest)
                    return@post
                }

                val data = responseJson["data"]?.jsonArray?.firstOrNull()?.jsonObject
                val guia = data?.get("trackingNumber")?.jsonPrimitive?.content ?: ""
                val pdf = data?.get("label")?.jsonPrimitive?.content ?: ""

                if (guia.isBlank()) {
                    val errorResult = buildJsonObject {
                        put("error", true)
                        put("message", "No se pudo generar la guía")
                    }
                    call.respondText(errorResult.toString(), ContentType.Application.Json, HttpStatusCode.BadRequest)
                    return@post
                }

                shipmentRepository.create(Shipment(
                    orderId = request.orderId,
                    carrier = request.currier,
                    service = request.service,
                    trackingNumber = guia,
                    labelUrl = pdf,
                    cost = data?.get("totalPrice")?.jsonPrimitive?.double ?: 0.0,
                ))

                val result = buildJsonObject {
                    put("result", buildJsonObject { put("NumeroGuia", guia); put("pdf", pdf) })
                    put("error", false)
                }
                call.respondText(result.toString(), ContentType.Application.Json)
            } catch (e: Exception) {
                logger.error("Envia create error", e)
                call.respond(HttpStatusCode.BadGateway, mapOf("error" to true, "message" to "Error connecting to Envia"))
            } finally {
                client.close()
            }
        }

        // Create shipping label via Epack
        post("/create-label") {
            if (!call.requireAdmin(supabase)) return@post

            val request = call.receive<CreateLabelRequest>()

            if (config.epackApiKey.isEmpty()) {
                val guia = "MOCK-${System.currentTimeMillis().toString().takeLast(8)}"
                val pdf = "https://example.com/mock-label.pdf"

                // Save to DB
                shipmentRepository.create(Shipment(
                    orderId = request.orderId,
                    carrier = request.currier,
                    service = request.service,
                    trackingNumber = guia,
                    labelUrl = pdf,
                    cost = 0.0,
                ))

                val mockLabel = buildJsonObject {
                    put("result", buildJsonObject {
                        put("NumeroGuia", guia)
                        put("pdf", pdf)
                    })
                    put("error", false)
                    put("mock", true)
                }
                call.respondText(mockLabel.toString(), ContentType.Application.Json)
                return@post
            }

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

                if (response.status.isSuccess()) {
                    val responseBody = response.bodyAsText()
                    val responseJson = Json.parseToJsonElement(responseBody).jsonObject
                    val result = responseJson["result"]?.jsonObject
                    val guia = result?.get("NumeroGuia")?.jsonPrimitive?.content ?: ""
                    val pdf = result?.get("pdf")?.jsonPrimitive?.content ?: ""

                    if (guia.isNotBlank()) {
                        shipmentRepository.create(Shipment(
                            orderId = request.orderId,
                            carrier = request.currier,
                            service = request.service,
                            trackingNumber = guia,
                            labelUrl = pdf,
                            cost = 0.0,
                        ))
                    }

                    call.respondText(responseBody, ContentType.Application.Json)
                } else {
                    call.respondText(response.bodyAsText(), ContentType.Application.Json, response.status)
                }
            } catch (e: Exception) {
                logger.error("Epack create error", e)
                call.respond(HttpStatusCode.BadGateway, mapOf("error" to true, "message" to "Error connecting to Epack"))
            } finally {
                client.close()
            }
        }

        // Get all shipments
        get {
            if (!call.requireAdmin(supabase)) return@get
            call.respond(shipmentRepository.getAll())
        }

        // Get shipment for an order
        get("/order/{orderId}") {
            if (!call.requireAdmin(supabase)) return@get
            val orderId = call.parameters["orderId"]!!
            val shipment = shipmentRepository.getByOrderId(orderId)
            if (shipment != null) {
                call.respond(shipment)
            } else {
                call.respond(HttpStatusCode.NotFound, mapOf("error" to "No shipment found"))
            }
        }
    }
}
