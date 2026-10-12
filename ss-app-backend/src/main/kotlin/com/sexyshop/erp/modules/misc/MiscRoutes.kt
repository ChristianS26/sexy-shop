package com.sexyshop.erp.modules.misc

import com.sexyshop.erp.core.*
import io.github.jan.supabase.storage.storage
import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.utils.io.*
import kotlinx.serialization.json.*

/** Sesión, alertas, auditoría, búsqueda global y archivos. */
fun Route.authRoutes(db: Db, audit: AuditService, erpAuth: ErpAuth) {
    get("/auth/me") {
        val ctx = call.require()
        val settings: Map<String, JsonElement> = db.selectAll("organization_settings", "key, value") { eq("organization_id", ctx.organizationId) }.associate { it.str("key")!! to (it["value"] ?: JsonNull) }
        val branches = db.selectAll("branches", "id, code, name, is_default, city", order = "name") { org(ctx); eq("is_active", true) }
        val warehouses = db.selectAll("warehouses", "id, code, name, branch_id, is_default", order = "name") { org(ctx); eq("is_active", true) }
        val registers = db.selectAll("cash_registers", "id, code, name, branch_id", order = "name") { org(ctx); eq("is_active", true) }
        val methods = db.selectAll("payment_methods", "id, code, name, is_cash, requires_reference", order = "display_order") { org(ctx); eq("is_active", true) }
        val unread = db.count("notifications") { org(ctx); eq("status", "UNREAD") }
        if (call.request.queryParameters["login"] == "true") {
            db.update("users", ctx.userId, jsonOf("last_login_at" to nowIso()))
            audit.log(call, "auth.login", "USER", ctx.userId)
        }
        call.respond(jsonOf(
            "user" to jsonOf("id" to ctx.userId, "first_name" to ctx.firstName, "last_name" to ctx.lastName, "email" to ctx.email, "username" to ctx.username, "default_branch_id" to ctx.defaultBranchId, "avatar_url" to ctx.raw.obj("user")?.str("avatar_url")),
            "organization" to ctx.organization, "roles" to ctx.roles.map { jsonOf("id" to it.id, "code" to it.code, "name" to it.name) }, "permissions" to ctx.permissions.sorted(),
            "branches" to branches.filter { b -> ctx.canAccessBranch(b.str("id")!!) }, "all_branches" to branches, "warehouses" to warehouses, "cash_registers" to registers, "payment_methods" to methods,
            "max_discount_pct" to ctx.maxDiscountPct, "settings" to JsonObject(settings.filterKeys { it != "security" || ctx.has("settings.system") }), "unread_alerts" to unread,
        ))
    }
    post("/auth/logout") {
        val ctx = call.require()
        audit.log(call, "auth.logout", "USER", ctx.userId)
        erpAuth.invalidate(ctx.userId)
        call.respond(jsonOf("ok" to true))
    }
}

fun Route.alertsRoutes(db: Db, audit: AuditService) {
    get("/alerts") {
        val ctx = call.require("alerts.read")
        val q = PageQuery.from(call, "created_at")
        val p = call.request.queryParameters
        val (rows, total) = db.list("notifications", "*", q, {
            org(ctx); or { isNull("user_id"); eq("user_id", ctx.userId) }
            when (p["status"]) { null, "", "open" -> neq("status", "RESOLVED"); "all" -> {}; else -> eq("status", p["status"]!!) }
            eqOpt("severity", p["severity"]); eqOpt("type", p["type"]); eqOpt("entity_type", p["entity_type"])
            if (q.q != null) or { ilike("title", "%${q.q}%"); ilike("description", "%${q.q}%") }
        }, mapOf("created_at" to "created_at", "severity" to "severity", "status" to "status"))
        call.respond(paged(rows, q, total))
    }
    get("/alerts/summary") {
        val ctx = call.require("alerts.read")
        val rows = db.selectAll("notifications", "type, severity, status") { org(ctx); neq("status", "RESOLVED") }
        call.respond(jsonOf("unread" to rows.count { it.str("status") == "UNREAD" }, "open" to rows.size,
            "by_severity" to rows.groupingBy { it.str("severity") ?: "INFO" }.eachCount(), "by_type" to rows.groupingBy { it.str("type") ?: "" }.eachCount()))
    }
    post("/alerts/{id}/read") {
        val ctx = call.require("alerts.read")
        val id = call.requiredParam("id")
        call.respond(db.updateWhere("notifications", jsonOf("status" to "READ", "read_at" to nowIso())) { eq("id", id); org(ctx); eq("status", "UNREAD") }.firstOrNull() ?: db.byId("notifications", id))
    }
    post("/alerts/read-all") {
        val ctx = call.require("alerts.read")
        val n = db.updateWhere("notifications", jsonOf("status" to "READ", "read_at" to nowIso())) { org(ctx); eq("status", "UNREAD") }.size
        call.respond(jsonOf("updated" to n))
    }
    post("/alerts/{id}/resolve") {
        val ctx = call.require("alerts.resolve")
        val id = call.requiredParam("id")
        val row = db.updateWhere("notifications", jsonOf("status" to "RESOLVED", "resolved_at" to nowIso(), "resolved_by" to ctx.userId)) { eq("id", id); org(ctx) }.firstOrNull() ?: throw ErpException.notFound()
        audit.log(call, "alerts.resolve", "NOTIFICATION", id, null, row)
        call.respond(row)
    }
    post("/alerts/run-checks") {
        val ctx = call.require("alerts.resolve", "settings.manage")
        val n = db.rpc("run_anomaly_checks", jsonOf("p_org" to ctx.organizationId)).jsonPrimitive.intOrNull ?: 0
        call.respond(jsonOf("generated" to n))
    }
}

fun Route.auditRoutes(db: Db) {
    get("/audit") {
        val ctx = call.require("audit.read")
        val q = PageQuery.from(call, "created_at")
        val p = call.request.queryParameters
        val (rows, total) = db.list("audit_logs", "id, organization_id, user_id, user_name, action, entity_type, entity_id, ip, metadata, before, after, created_at", q, {
            org(ctx); eqOpt("user_id", p["user"]); eqOpt("entity_type", p["entity_type"]); eqOpt("entity_id", p["entity_id"]); dateRange("created_at", p["from"], p["to"])
            if (!p["action"].isNullOrBlank()) ilike("action", "${p["action"]}%")
            if (q.q != null) or { ilike("action", "%${q.q}%"); ilike("user_name", "%${q.q}%"); ilike("entity_id", "%${q.q}%") }
        }, mapOf("created_at" to "created_at", "action" to "action", "user_name" to "user_name"))
        call.respond(paged(rows.map { if (ctx.has("products.cost.read")) it else it.with("before" to it.obj("before")?.stripCost(ctx), "after" to it.obj("after")?.stripCost(ctx)) }, q, total))
    }
    get("/audit/actions") {
        val ctx = call.require("audit.read")
        val rows = db.selectAll("audit_logs", "action", order = "action", limit = 5000) { org(ctx) }
        call.respond(JsonArray(rows.mapNotNull { it.str("action") }.distinct().sorted().map { JsonPrimitive(it) }))
    }
}

fun Route.searchRoutes(db: Db) {
    get("/search") {
        val ctx = call.require()
        val q = call.request.queryParameters["q"]?.trim() ?: ""
        if (q.length < 2) { call.respond(jsonOf("products" to emptyList<String>(), "customers" to emptyList<String>(), "sales" to emptyList<String>(), "suppliers" to emptyList<String>(), "purchases" to emptyList<String>())); return@get }
        val res = db.rpcObject("global_search", jsonOf("p_org" to ctx.organizationId, "p_q" to q, "p_limit" to 6))
        val filtered = JsonObject(res.filterKeys { k -> when (k) {
            "products" -> ctx.has("products.read"); "customers" -> ctx.has("customers.read"); "sales" -> ctx.hasAny("sales.read", "sales.read.own")
            "suppliers" -> ctx.hasAny("suppliers.manage", "purchases.read"); "purchases" -> ctx.has("purchases.read"); else -> true } })
        call.respond(filtered)
    }
}

/** Subida de archivos (comprobantes de gasto, logos) al bucket de Storage. */
fun Route.filesRoutes(db: Db, bucket: String, supabaseUrl: String) {
    post("/files") {
        val ctx = call.require("expenses.manage", "settings.manage", "products.update")
        val multipart = call.receiveMultipart()
        var entityType = "GENERIC"; var entityId: String? = null; var saved: JsonObject? = null
        multipart.forEachPart { part ->
            when (part) {
                is PartData.FormItem -> { if (part.name == "entity_type") entityType = part.value; if (part.name == "entity_id") entityId = part.value }
                is PartData.FileItem -> {
                    val bytes = part.provider().toByteArray()
                    if (bytes.size > 8 * 1024 * 1024) throw ErpException.badRequest("El archivo excede 8 MB.")
                    val ct = part.contentType?.toString() ?: "application/octet-stream"
                    if (!(ct.startsWith("image/") || ct == "application/pdf")) throw ErpException.badRequest("Solo se aceptan imágenes o PDF.")
                    val ext = part.originalFileName?.substringAfterLast('.', "")?.lowercase()?.takeIf { it.length in 2..5 } ?: "bin"
                    val path = "erp/${ctx.organizationId}/${entityType.lowercase()}/${java.util.UUID.randomUUID()}.$ext"
                    val bucketApi: io.github.jan.supabase.storage.BucketApi = db.supabase.storage.from(bucket)
                    val parsedType = ContentType.parse(ct)
                    bucketApi.upload(path, bytes) { this.upsert = false; this.contentType = parsedType }
                    val url = "$supabaseUrl/storage/v1/object/public/$bucket/$path"
                    saved = db.insert("files", jsonOf("organization_id" to ctx.organizationId, "bucket" to bucket, "path" to path, "url" to url, "mime_type" to ct, "size_bytes" to bytes.size, "entity_type" to entityType, "entity_id" to entityId, "uploaded_by" to ctx.userId))
                }
                else -> {}
            }
            part.dispose()
        }
        call.respond(HttpStatusCode.Created, saved ?: throw ErpException.badRequest("No se recibió ningún archivo."))
    }
}
