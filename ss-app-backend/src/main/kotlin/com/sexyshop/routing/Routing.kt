package com.sexyshop.routing

import com.sexyshop.routing.category.categoryRoutes
import com.sexyshop.routing.image.imageRoutes
import com.sexyshop.routing.order.orderRoutes
import com.sexyshop.routing.product.productRoutes
import com.sexyshop.services.category.CategoryService
import com.sexyshop.services.image.ImageService
import com.sexyshop.services.order.OrderService
import com.sexyshop.services.product.ProductService
import io.ktor.server.application.*
import io.ktor.server.routing.*
import org.koin.ktor.ext.inject

fun Application.configureRouting() {
    val categoryService by inject<CategoryService>()
    val productService by inject<ProductService>()
    val orderService by inject<OrderService>()
    val imageService by inject<ImageService>()

    routing {
        route("/api") {
            categoryRoutes(categoryService)
            productRoutes(productService, imageService)
            orderRoutes(orderService)
            imageRoutes(imageService)
        }
    }
}
