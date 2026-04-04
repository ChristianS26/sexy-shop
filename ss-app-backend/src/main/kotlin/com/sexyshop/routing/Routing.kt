package com.sexyshop.routing

import com.sexyshop.config.AppConfig
import com.sexyshop.repositories.expense.ExpenseRepository
import com.sexyshop.repositories.shipment.ShipmentRepository
import com.sexyshop.repositories.withdrawal.WithdrawalRepository
import com.sexyshop.routing.category.categoryRoutes
import com.sexyshop.routing.dashboard.dashboardRoutes
import com.sexyshop.routing.expense.expenseRoutes
import com.sexyshop.routing.image.imageRoutes
import com.sexyshop.routing.order.orderRoutes
import com.sexyshop.routing.payment.paymentRoutes
import com.sexyshop.routing.product.productRoutes
import com.sexyshop.routing.settings.settingsRoutes
import com.sexyshop.routing.shipping.shippingRoutes
import com.sexyshop.routing.withdrawal.withdrawalRoutes
import com.sexyshop.services.category.CategoryService
import com.sexyshop.services.dashboard.DashboardService
import com.sexyshop.services.email.EmailService
import com.sexyshop.services.image.ImageService
import com.sexyshop.services.order.OrderService
import com.sexyshop.services.product.ProductService
import io.github.jan.supabase.SupabaseClient
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
    val emailService by inject<EmailService>()
    val supabaseClient by inject<SupabaseClient>()
    val expenseRepository by inject<ExpenseRepository>()
    val withdrawalRepository by inject<WithdrawalRepository>()
    val shipmentRepository by inject<ShipmentRepository>()

    routing {
        route("/api") {
            categoryRoutes(categoryService, supabaseClient)
            productRoutes(productService, imageService, supabaseClient)
            orderRoutes(orderService, emailService, supabaseClient)
            imageRoutes(imageService, supabaseClient)
            expenseRoutes(expenseRepository, supabaseClient)
            withdrawalRoutes(withdrawalRepository, supabaseClient)
            dashboardRoutes(dashboardService, supabaseClient)
            paymentRoutes(appConfig, orderService, emailService, productService)
            settingsRoutes(supabaseClient)
            shippingRoutes(appConfig, supabaseClient, shipmentRepository)
        }
    }
}
