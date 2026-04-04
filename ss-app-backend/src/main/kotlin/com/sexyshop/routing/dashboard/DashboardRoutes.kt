package com.sexyshop.routing.dashboard

import com.sexyshop.plugins.requireAdmin
import com.sexyshop.services.dashboard.DashboardService
import io.github.jan.supabase.SupabaseClient
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Route.dashboardRoutes(service: DashboardService, supabase: SupabaseClient) {
    route("/dashboard") {
        get("/stats") {
            if (!call.requireAdmin(supabase)) return@get
            call.respond(service.getStats())
        }
    }
}
