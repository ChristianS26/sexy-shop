package com.sexyshop.erp.modules.sales

import com.sexyshop.erp.core.*
import kotlinx.serialization.json.*
import java.time.Instant

/**
 * Motor de promociones: dado un carrito (líneas con producto, categoría, precio y cantidad)
 * y las promociones vigentes, calcula el descuento por línea. Es determinista y vive en
 * el backend para que el POS no pueda inventar descuentos.
 */
data class CartLine(val index: Int, val productId: String, val variantId: String?, val categoryId: String?, val parentCategoryId: String?, val unitPrice: Double, val quantity: Int, val name: String) {
    val gross get() = unitPrice * quantity
}

data class PromoResult(val lineDiscounts: Map<Int, Pair<Double, String>>, val applied: List<JsonObject>, val suggestions: List<JsonObject>)

class PromotionEngine(private val db: Db) {

    suspend fun activePromotions(orgId: String): List<JsonObject> {
        val now = Instant.now().toString()
        return db.selectAll("promotions", "*, promotion_products(product_id), promotion_categories(category_id)", order = "created_at", asc = false) {
            eq("organization_id", orgId); eq("status", "ACTIVE")
            or { isNull("starts_at"); lte("starts_at", now) }
            or { isNull("ends_at"); gte("ends_at", now) }
        }.filter { p -> p.int("max_uses")?.let { max -> (p.int("uses_count") ?: 0) < max } ?: true }
    }

    fun apply(lines: List<CartLine>, promotions: List<JsonObject>): PromoResult {
        val discounts = mutableMapOf<Int, Pair<Double, String>>()
        val applied = mutableListOf<JsonObject>()
        val suggestions = mutableListOf<JsonObject>()
        val cartGross = lines.sumOf { it.gross }

        for (p in promotions) {
            val id = p.str("id")!!
            val type = p.str("promo_type") ?: continue
            val value = p.dbl("value") ?: 0.0
            val minAmount = p.dbl("min_amount") ?: 0.0
            if (cartGross < minAmount) continue
            val products = p.arr("promotion_products")?.mapNotNull { it.jsonObject.str("product_id") }?.toSet() ?: emptySet()
            val categories = p.arr("promotion_categories")?.mapNotNull { it.jsonObject.str("category_id") }?.toSet() ?: emptySet()
            fun eligible(l: CartLine) = (products.isEmpty() && categories.isEmpty()) || l.productId in products || l.categoryId in categories || l.parentCategoryId in categories
            val eligibleLines = lines.filter(::eligible)
            var total = 0.0
            fun add(l: CartLine, amount: Double) {
                if (amount <= 0) return
                val rounded = Math.round(amount * 100) / 100.0
                val current = discounts[l.index]
                if (current == null || rounded > current.first) { discounts[l.index] = rounded to id }
                total += rounded
            }
            when (type) {
                "PERCENT", "CATEGORY_PERCENT" -> eligibleLines.forEach { add(it, it.gross * value / 100) }
                "FIXED" -> eligibleLines.forEach { add(it, minOf(value * it.quantity, it.gross)) }
                "QUANTITY_DISCOUNT" -> {
                    val minQty = p.int("min_quantity") ?: 2
                    eligibleLines.filter { it.quantity >= minQty }.forEach { add(it, it.gross * value / 100) }
                }
                "BUY_X_GET_Y" -> {
                    val buy = p.int("buy_qty") ?: 2; val get = p.int("get_qty") ?: 1
                    // 2x1 = buy 1 get 1 ; 3x2 = buy 2 get 1
                    eligibleLines.forEach { l ->
                        val free = (l.quantity / (buy + get)) * get
                        add(l, free * l.unitPrice)
                    }
                }
                "BUNDLE" -> {
                    if (products.isNotEmpty() && products.all { pid -> lines.any { it.productId == pid } }) {
                        val first = lines.first { it.productId in products }
                        add(first, minOf(value, first.gross))
                    }
                }
                "FREE_PRODUCT" -> {
                    val freeId = p.str("free_product_id")
                    val inCart = lines.firstOrNull { it.productId == freeId }
                    if (freeId != null) {
                        if (inCart != null) add(inCart, inCart.unitPrice)
                        else suggestions.add(jsonOf("promotion_id" to id, "name" to p.str("name"), "free_product_id" to freeId, "message" to "Agrega el producto de regalo de la promoción “${p.str("name")}”."))
                    }
                }
            }
            if (total > 0) applied.add(jsonOf("promotion_id" to id, "name" to p.str("name"), "promo_type" to type, "discount" to Math.round(total * 100) / 100.0))
        }
        return PromoResult(discounts, applied, suggestions)
    }
}
