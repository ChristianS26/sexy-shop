package com.sexyshop.repositories.product

/**
 * El inventario no alcanzó al momento exacto de descontar. Es distinto de la
 * validación previa: aquí ya se comprobó que había, pero otra compra se
 * adelantó entre la comprobación y el descuento.
 */
class StockInsuficienteException(val productId: String) :
    RuntimeException("Stock insuficiente para el producto $productId")
