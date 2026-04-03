package com.sexyshop.routing

import com.sexyshop.routing.category.categoryRoutes
import com.sexyshop.routing.image.imageRoutes
import com.sexyshop.routing.order.orderRoutes
import com.sexyshop.routing.product.productRoutes
import io.ktor.server.application.*
import io.ktor.server.routing.*

fun Application.configureRouting() {
    routing {
        route("/api") {
            categoryRoutes()
            productRoutes()
            orderRoutes()
            imageRoutes()
        }
    }
}
