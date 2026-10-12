package com.sexyshop.erp

import com.sexyshop.erp.core.*
import com.sexyshop.erp.modules.bi.AnalyticsService
import com.sexyshop.erp.modules.bi.InsightEngine
import com.sexyshop.erp.modules.bi.analyticsRoutes
import com.sexyshop.erp.modules.cash.cashRoutes
import com.sexyshop.erp.modules.catalog.CatalogService
import com.sexyshop.erp.modules.catalog.catalogRoutes
import com.sexyshop.erp.modules.customers.customersRoutes
import com.sexyshop.erp.modules.inventory.inventoryRoutes
import com.sexyshop.erp.modules.misc.auditRoutes
import com.sexyshop.erp.modules.purchasing.purchasingRoutes
import com.sexyshop.erp.modules.sales.PromotionEngine
import com.sexyshop.erp.modules.sales.SalesService
import com.sexyshop.erp.modules.sales.salesRoutes
import com.sexyshop.erp.modules.users.GoTrueAdmin
import com.sexyshop.erp.modules.users.UsersService
import com.sexyshop.erp.modules.users.usersRoutes
import com.sexyshop.plugins.configureSerialization
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.ktor.client.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.routing.*
import io.ktor.server.testing.*
import kotlinx.serialization.json.*
import kotlin.test.*

/**
 * Pruebas de autorización server-side: cada ruta rechaza (401/403) antes de tocar la base de datos.
 * El Db apunta a un host inexistente: si alguna ruta llegara a consultarlo, la prueba fallaría con otro error.
 */
class PermissionApiTest {
    private val db = Db(createSupabaseClient("http://127.0.0.1:1", "x") { install(Postgrest) })

    private class StubAuth(private val ctx: AuthContext?) : ErpAuth(Db(createSupabaseClient("http://127.0.0.1:1", "x") { install(Postgrest) }), TokenVerifier(HttpClient(), "http://127.0.0.1:1", "x")) {
        override suspend fun authenticate(call: ApplicationCall): Result = when (call.request.headers["Authorization"]) {
            "Bearer ok" -> Result("u1", ctx)
            "Bearer no-erp" -> Result("u2", null)
            else -> Result(null, null)
        }
    }

    private fun app(ctx: AuthContext?, block: suspend (HttpClient) -> Unit) = testApplication {
        application {
            configureSerialization()
            routing {
                route("/api/erp") {
                    install(ErpAuthPlugin) { auth = StubAuth(ctx) }
                    val audit = AuditService(db)
                    val gotrue = GoTrueAdmin(HttpClient(), "http://127.0.0.1:1", "x", null)
                    val erpAuth = StubAuth(ctx)
                    usersRoutes(db, UsersService(db, gotrue, erpAuth), gotrue, audit, erpAuth)
                    catalogRoutes(db, CatalogService(db), audit)
                    inventoryRoutes(db, audit); purchasingRoutes(db, audit)
                    salesRoutes(db, SalesService(db, PromotionEngine(db)), audit)
                    customersRoutes(db, audit); cashRoutes(db, audit)
                    val analytics = AnalyticsService(db)
                    analyticsRoutes(analytics, InsightEngine(analytics)); auditRoutes(db)
                }
            }
        }
        block(createClient { })
    }

    private suspend fun HttpClient.status(method: HttpMethod, path: String, token: String? = "ok", body: String? = null): HttpStatusCode =
        request("/api/erp$path") { this.method = method; token?.let { header(HttpHeaders.Authorization, "Bearer $it") }; body?.let { contentType(ContentType.Application.Json); setBody(it) } }.status

    @Test fun `missing or invalid token is 401`() = app(fakeCtx(setOf("products.read"))) { c ->
        assertEquals(HttpStatusCode.Unauthorized, c.status(HttpMethod.Get, "/products", token = null))
        assertEquals(HttpStatusCode.Unauthorized, c.status(HttpMethod.Get, "/products", token = "forged"))
    }

    @Test fun `inactive user is 403`() = app(fakeCtx(setOf("products.read")).copy(status = "INACTIVE")) { c ->
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Get, "/products"))
    }

    @Test fun `valid auth user without erp account is 403 USER_NOT_FOUND not 401`() = app(fakeCtx(setOf("products.read"))) { c ->
        val res = c.request("/api/erp/products") { header(HttpHeaders.Authorization, "Bearer no-erp") }
        assertEquals(HttpStatusCode.Forbidden, res.status)
        assertEquals("USER_NOT_FOUND", Json.parseToJsonElement(res.bodyAsText()).jsonObject["code"]!!.jsonPrimitive.content)
    }

    @Test fun `seller cannot touch restricted resources`() = app(fakeCtx(setOf("products.read", "sales.create", "sales.read.own", "customers.read"))) { c ->
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Post, "/products", body = "{}"))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Delete, "/products/x"))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Post, "/inventory/adjustments", body = "{}"))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Get, "/users"))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Get, "/analytics/overview"))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Get, "/analytics/financial"))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Get, "/audit"))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Post, "/sales/x/cancel", body = """{"reason":"x"}"""))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Post, "/purchases", body = "{}"))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Post, "/cash/shifts/open", body = "{}"))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Delete, "/customers/x"))
    }

    @Test fun `discount requires permission before any db access`() = app(fakeCtx(setOf("sales.create"))) { c ->
        val res = c.request("/api/erp/sales") { method = HttpMethod.Post; header(HttpHeaders.Authorization, "Bearer ok"); contentType(ContentType.Application.Json)
            setBody("""{"branch_id":"b1","discount_pct":10,"items":[{"product_id":"p","quantity":1}],"payments":[]}""") }
        assertEquals(HttpStatusCode.Forbidden, res.status)
        assertTrue(res.bodyAsText().contains("descuentos"))
    }

    @Test fun `discount without reason is rejected`() = app(fakeCtx(setOf("sales.create", "sales.discount"))) { c ->
        val res = c.request("/api/erp/sales") { method = HttpMethod.Post; header(HttpHeaders.Authorization, "Bearer ok"); contentType(ContentType.Application.Json)
            setBody("""{"branch_id":"b1","discount_pct":10,"items":[{"product_id":"p","quantity":1}],"payments":[]}""") }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertEquals("MOTIVO_REQUERIDO", Json.parseToJsonElement(res.bodyAsText()).jsonObject["code"]!!.jsonPrimitive.content)
    }

    @Test fun `branch access is enforced`() = app(fakeCtx(setOf("sales.create"))) { c ->
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Post, "/sales", body = """{"branch_id":"other-branch","items":[],"payments":[]}"""))
        assertEquals(HttpStatusCode.Forbidden, c.status(HttpMethod.Get, "/analytics/overview?branch=other", token = "ok").let { if (it == HttpStatusCode.Forbidden) it else it })
    }

    @Test fun `validation errors are 422 with field details`() = app(fakeCtx(setOf("users.create"))) { c ->
        val res = c.request("/api/erp/users") { method = HttpMethod.Post; header(HttpHeaders.Authorization, "Bearer ok"); contentType(ContentType.Application.Json); setBody("""{"first_name":"","email":"bad","username":"","password":"123"}""") }
        assertEquals(HttpStatusCode.UnprocessableEntity, res.status)
        val body = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals("VALIDATION", body["code"]!!.jsonPrimitive.content)
        assertTrue(body["details"]!!.jsonObject.containsKey("password"))
    }

    @Test fun `super admin role cannot be granted by a non super admin`() = app(fakeCtx(setOf("users.create", "users.update", "users.read"), roles = listOf("ADMIN"))) { c ->
        val svc = UsersService(db, GoTrueAdmin(HttpClient(), "http://127.0.0.1:1", "x", null), StubAuth(null))
        assertFailsWith<ErpException> { svc.guardRoleEscalation(fakeCtx(setOf(), roles = listOf("ADMIN")), listOf("SUPER_ADMIN")) }
        svc.guardRoleEscalation(fakeCtx(setOf(), roles = listOf("SUPER_ADMIN")), listOf("SUPER_ADMIN"))
    }
}
