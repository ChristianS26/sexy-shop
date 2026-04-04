package com.sexyshop.routing.dashboard

import com.sexyshop.services.dashboard.DashboardService
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Route.dashboardRoutes(service: DashboardService) {
    route("/dashboard") {
        get("/stats") {
            call.respond(service.getStats())
        }
    }
}
