package com.sexyshop.config

/**
 * Orígenes del storefront. Única fuente de verdad: la usan el CORS y la
 * validación de las back_urls de Mercado Pago.
 *
 * Ojo con las back_urls: MP redirige al comprador a esa URL cuando termina de
 * pagar, así que NO se puede reflejar el Origin que llegue en la petición sin
 * validarlo. Cualquiera puede mandar un Origin falso con curl y convertir
 * nuestra cuenta de MP en un redirector hacia su sitio.
 */
object FrontendOrigins {

    val allowed: List<String> = listOf(
        "https://sexyshoptoys.com.mx",
        "https://www.sexyshoptoys.com.mx",
        "https://christians26.github.io",
        // dev local (Live Server / http-server)
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    )

    /** (esquema, host[:puerto]) de cada origen, para configurar el CORS. */
    fun asSchemeAndHost(): List<Pair<String, String>> = allowed.mapNotNull { origin ->
        val parts = origin.split("://", limit = 2)
        if (parts.size == 2) parts[0] to parts[1] else null
    }

    /**
     * Origen válido para mandarlo como back_url de Mercado Pago.
     * Solo https: en dev local las back_urls deben seguir apuntando al
     * frontend público (MP no acepta un localhost como URL de retorno).
     */
    fun isValidReturnOrigin(origin: String?): Boolean {
        if (origin.isNullOrBlank()) return false
        if (!origin.startsWith("https://", ignoreCase = true)) return false
        return allowed.any { it.equals(origin, ignoreCase = true) }
    }

    /**
     * Base para las back_urls a partir del origen. El Origin no trae ruta,
     * pero GitHub Pages sirve la tienda bajo /sexy-shop: sin este ajuste el
     * comprador volvería a christians26.github.io/payment-success.html (404).
     */
    fun returnBaseFor(origin: String): String =
        if (origin.equals("https://christians26.github.io", ignoreCase = true)) "$origin/sexy-shop"
        else origin
}
