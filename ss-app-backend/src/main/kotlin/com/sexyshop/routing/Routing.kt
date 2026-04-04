package com.sexyshop.routing

import com.sexyshop.config.AppConfig
import com.sexyshop.repositories.expense.ExpenseRepository
import com.sexyshop.repositories.withdrawal.WithdrawalRepository
import com.sexyshop.routing.category.categoryRoutes
import com.sexyshop.routing.dashboard.dashboardRoutes
import com.sexyshop.routing.expense.expenseRoutes
import com.sexyshop.routing.image.imageRoutes
import com.sexyshop.routing.order.orderRoutes
import com.sexyshop.routing.payment.paymentRoutes
import com.sexyshop.routing.product.productRoutes
import com.sexyshop.routing.withdrawal.withdrawalRoutes
import com.sexyshop.services.category.CategoryService
import com.sexyshop.services.dashboard.DashboardService
import com.sexyshop.services.image.ImageService
import com.sexyshop.services.order.OrderService
import com.sexyshop.services.product.ProductService
import io.ktor.server.application.*
import io.ktor.server.routing.*
import org.koin.ktor.ext.inject

fun Application.configureRouting() {
    val appConfig by inject<AppConfig>()
    val categoryService by inject<CategoryService>()
    val productService by inject<ProductService>()
    val orderService by inject<OrderService>()
    val imageService by inject<ImageService>()
    val dashboardService by inject<DashboardService>()
    val expenseRepository by inject<ExpenseRepository>()
    val withdrawalRepository by inject<WithdrawalRepository>()

    routing {
        route("/api") {
            categoryRoutes(categoryService)
            productRoutes(productService, imageService)
            orderRoutes(orderService)
            imageRoutes(imageService)
            expenseRoutes(expenseRepository)
            withdrawalRoutes(withdrawalRepository)
            dashboardRoutes(dashboardService)
            paymentRoutes(appConfig)
        }
    }
}
