package com.sexyshop.erp

import com.sexyshop.config.AppConfig
import com.sexyshop.erp.core.*
import com.sexyshop.erp.modules.bi.AnalyticsService
import com.sexyshop.erp.modules.bi.InsightEngine
import com.sexyshop.erp.modules.bi.analyticsRoutes
import com.sexyshop.erp.modules.cash.cashRoutes
import com.sexyshop.erp.modules.catalog.CatalogService
import com.sexyshop.erp.modules.catalog.catalogRoutes
import com.sexyshop.erp.modules.customers.customersRoutes
import com.sexyshop.erp.modules.importer.ImportService
import com.sexyshop.erp.modules.importer.importRoutes
import com.sexyshop.erp.modules.inventory.inventoryRoutes
import com.sexyshop.erp.modules.misc.*
import com.sexyshop.erp.modules.org.OrgService
import com.sexyshop.erp.modules.org.orgRoutes
import com.sexyshop.erp.modules.purchasing.purchasingRoutes
import com.sexyshop.erp.modules.reports.ReportCenter
import com.sexyshop.erp.modules.reports.reportsRoutes
import com.sexyshop.erp.modules.sales.PromotionEngine
import com.sexyshop.erp.modules.sales.SalesService
import com.sexyshop.erp.modules.sales.salesRoutes
import com.sexyshop.erp.modules.users.GoTrueAdmin
import com.sexyshop.erp.modules.users.UsersService
import com.sexyshop.erp.modules.users.usersRoutes
import io.github.jan.supabase.SupabaseClient
import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.server.application.*
import io.ktor.server.plugins.ratelimit.*
import io.ktor.server.routing.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.jsonPrimitive
import org.koin.dsl.module
import org.koin.ktor.ext.inject
import org.slf4j.LoggerFactory
import kotlin.time.Duration.Companion.minutes

val erpModule = module {
    single { HttpClient(CIO) { expectSuccess = false } }
    single { Db(get<SupabaseClient>()) }
    single { val cfg = get<AppConfig>(); TokenVerifier(get(), cfg.supabaseUrl, cfg.supabaseApiKey) }
    single { ErpAuth(get(), get()) }
    single { AuditService(get()) }
    single { val cfg = get<AppConfig>(); GoTrueAdmin(get(), cfg.supabaseUrl, cfg.supabaseApiKey, System.getenv("SUPABASE_ANON_KEY")) }
    single { OrgService(get(), get(), get()) }
    single { UsersService(get(), get(), get()) }
    single { CatalogService(get()) }
    single { PromotionEngine(get()) }
    single { SalesService(get(), get()) }
    single { AnalyticsService(get()) }
    single { InsightEngine(get()) }
    single { ReportCenter(get(), get()) }
    single { ImportService(get()) }
}

/** Monta el ERP bajo /api/erp con autenticación verificada y rate limit. */
fun Route.erpRoutes(app: Application) {
    val db by app.inject<Db>()
    val erpAuth by app.inject<ErpAuth>()
    val audit by app.inject<AuditService>()
    val cfg by app.inject<AppConfig>()

    route("/erp") {
        rateLimit(RateLimitName("erp")) {
            install(ErpAuthPlugin) { auth = erpAuth }
            authRoutes(db, audit, erpAuth)
            orgRoutes(db, app.inject<OrgService>().value, audit, erpAuth)
            usersRoutes(db, app.inject<UsersService>().value, app.inject<GoTrueAdmin>().value, audit, erpAuth)
            catalogRoutes(db, app.inject<CatalogService>().value, audit)
            inventoryRoutes(db, audit)
            purchasingRoutes(db, audit)
            salesRoutes(db, app.inject<SalesService>().value, audit)
            customersRoutes(db, audit)
            cashRoutes(db, audit)
            analyticsRoutes(app.inject<AnalyticsService>().value, app.inject<InsightEngine>().value)
            reportsRoutes(app.inject<ReportCenter>().value)
            alertsRoutes(db, audit)
            auditRoutes(db)
            searchRoutes(db)
            filesRoutes(db, cfg.supabaseBucket, cfg.supabaseUrl)
            importRoutes(app.inject<ImportService>().value, audit)
        }
    }
}

fun Application.configureErpRateLimit() {
    install(RateLimit) {
        register(RateLimitName("erp")) {
            rateLimiter(limit = 600, refillPeriod = 1.minutes)
            requestKey { call -> call.request.headers["Authorization"]?.takeLast(32) ?: call.request.local.remoteHost }
        }
    }
}

/** Tareas programadas: detección de anomalías cada 15 min (no hay pg_cron en el plan actual). */
fun Application.configureErpScheduler() {
    val db by inject<Db>()
    val log = LoggerFactory.getLogger("ErpScheduler")
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val job = scope.launch {
        delay(60_000)
        while (isActive) {
            runCatching { db.rpc("run_anomaly_checks").jsonPrimitive.content }
                .onSuccess { log.info("Anomaly checks ejecutados: {} alertas", it) }
                .onFailure { log.warn("Anomaly checks fallaron: {}", it.message) }
            delay(15 * 60_000L)
        }
    }
    monitor.subscribe(ApplicationStopping) { job.cancel() }
}
