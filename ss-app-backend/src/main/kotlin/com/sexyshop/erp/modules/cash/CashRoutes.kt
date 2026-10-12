package com.sexyshop.erp.modules.cash

import com.sexyshop.erp.core.*
import io.ktor.http.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*

/** Cajas, turnos, movimientos de efectivo y gastos. */
fun Route.cashRoutes(db: Db, audit: AuditService) {
    val shiftCols = "*, cash_registers(id, code, name), branches(id, name), opener:users!cash_shifts_opened_by_fkey(first_name, last_name), closer:users!cash_shifts_closed_by_fkey(first_name, last_name)"

    suspend fun shiftDetail(ctx: AuthContext, id: String): JsonObject {
        val s = db.one("cash_shifts", shiftCols) { eq("id", id); org(ctx) } ?: throw ErpException.notFound("Turno no encontrado.")
        val movements = db.selectAll("cash_movements", "*, users(first_name, last_name)", order = "created_at") { eq("cash_shift_id", id) }
        val expected = movements.filter { it.bool("affects_cash") == true }.sumOf { it.dbl("amount") ?: 0.0 }
        val byMethod = movements.filter { it.str("movement_type") in setOf("SALE", "REFUND") }.groupBy { it.str("payment_method_code") ?: "OTHER" }.mapValues { (_, v) -> v.sumOf { it.dbl("amount") ?: 0.0 } }
        val byType = movements.groupBy { it.str("movement_type") }.mapValues { (_, v) -> v.sumOf { it.dbl("amount") ?: 0.0 } }
        val sales = db.selectAll("sales", "id, folio, total, status, sold_at, items_count, customer_id", order = "sold_at", asc = false) { eq("cash_shift_id", id) }
        return s.with("movements" to movements, "expected_cash_live" to Math.round(expected * 100) / 100.0, "totals_by_method_live" to byMethod, "totals_by_type" to byType,
            "sales" to sales, "sales_count_live" to sales.count { it.str("status") != "CANCELLED" }, "sales_total_live" to sales.filter { it.str("status") != "CANCELLED" }.sumOf { it.dbl("total") ?: 0.0 })
    }

    get("/cash/shifts") {
        val ctx = call.require("cash.read", "cash.open")
        val q = PageQuery.from(call, "opened_at")
        val p = call.request.queryParameters
        val (rows, total) = db.list("cash_shifts", shiftCols, q, {
            org(ctx); eqOpt("status", p["status"]); eqOpt("branch_id", p["branch"]); eqOpt("cash_register_id", p["register"]); dateRange("opened_at", p["from"], p["to"])
            if (!ctx.has("cash.read")) eq("opened_by", ctx.userId)
        }, mapOf("opened_at" to "opened_at", "closed_at" to "closed_at", "difference" to "difference", "sales_total" to "sales_total"))
        call.respond(paged(rows, q, total))
    }

    /** Turno abierto del usuario (o de la caja indicada). */
    get("/cash/shifts/current") {
        val ctx = call.require("cash.open", "sales.create", "cash.read")
        val register = call.request.queryParameters["register"]
        val branch = call.request.queryParameters["branch"]
        val open = db.selectAll("cash_shifts", shiftCols, order = "opened_at", asc = false) { org(ctx); eq("status", "OPEN"); eqOpt("cash_register_id", register); eqOpt("branch_id", branch) }
        val mine = open.firstOrNull { it.str("opened_by") == ctx.userId } ?: open.firstOrNull { it.str("branch_id") == (branch ?: ctx.defaultBranchId) } ?: open.firstOrNull()
        call.respond(jsonOf("shift" to mine?.let { shiftDetail(ctx, it.str("id")!!) }, "open_shifts" to open))
    }

    get("/cash/shifts/{id}") {
        val ctx = call.require("cash.read", "cash.open")
        call.respond(shiftDetail(ctx, call.requiredParam("id")))
    }

    post("/cash/shifts/open") {
        val ctx = call.require("cash.open")
        val body = call.receiveOrThrow<JsonObject>()
        val register = body.str("cash_register_id") ?: throw ErpException.badRequest("Selecciona la caja.")
        val reg = db.one("cash_registers") { eq("id", register); org(ctx); eq("is_active", true) } ?: throw ErpException.notFound("Caja no encontrada.")
        val branch = reg.str("branch_id")!!
        if (!ctx.canAccessBranch(branch)) throw ErpException.forbidden("No tienes acceso a esa sucursal.")
        val opening = body.dbl("opening_amount") ?: 0.0
        validate { nonNegative(opening, "opening_amount", "El fondo inicial") }
        val s = db.rpcObject("open_cash_shift", jsonOf("p_org" to ctx.organizationId, "p_branch" to branch, "p_register" to register, "p_user" to ctx.userId, "p_opening" to opening, "p_notes" to body.str("notes")))
        call.respond(HttpStatusCode.Created, shiftDetail(ctx, s.str("id")!!))
    }

    post("/cash/shifts/{id}/close") {
        val ctx = call.require("cash.close")
        val id = call.requiredParam("id")
        val body = call.receiveOrThrow<JsonObject>()
        val counted = body.dbl("counted_cash") ?: throw ErpException.badRequest("Indica el efectivo contado.")
        validate { nonNegative(counted, "counted_cash", "El efectivo contado") }
        val shift = db.one("cash_shifts", "id, opened_by, status") { eq("id", id); org(ctx) } ?: throw ErpException.notFound("Turno no encontrado.")
        if (shift.str("opened_by") != ctx.userId && !ctx.has("cash.read")) throw ErpException.forbidden("Solo quien abrió el turno o un gerente puede cerrarlo.")
        db.rpcObject("close_cash_shift", jsonOf("p_shift" to id, "p_user" to ctx.userId, "p_counted" to counted, "p_notes" to body.str("notes")))
        call.respond(shiftDetail(ctx, id))
    }

    post("/cash/shifts/{id}/movements") {
        val ctx = call.require("cash.movements")
        val id = call.requiredParam("id")
        val body = call.receiveOrThrow<JsonObject>()
        val type = body.str("movement_type") ?: body.str("type")
        validate { oneOf(type, listOf("DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"), "type", "El tipo de movimiento"); require(type != null, "type", "El tipo es obligatorio."); positive(body.dbl("amount")?.let { Math.abs(it) }, "amount", "El monto"); notBlank(body.str("description"), "description", "La descripción") }
        db.one("cash_shifts", "id") { eq("id", id); org(ctx) } ?: throw ErpException.notFound("Turno no encontrado.")
        val m = db.rpcObject("add_cash_movement", jsonOf("p_shift" to id, "p_type" to type, "p_amount" to body.dbl("amount"), "p_description" to body.str("description"), "p_user" to ctx.userId))
        call.respond(HttpStatusCode.Created, m)
    }

    // ---------------------------------------------------------------- Gastos
    get("/expenses") {
        val ctx = call.require("expenses.manage", "cash.read", "analytics.financial")
        val q = PageQuery.from(call, "expense_date")
        val p = call.request.queryParameters
        val (rows, total) = db.list("expenses", "*, expense_categories(id, code, name), branches(name), users(first_name, last_name), suppliers(name)", q, {
            org(ctx); isNull("deleted_at"); eqOpt("expense_category_id", p["category"]); eqOpt("branch_id", p["branch"]); eqOpt("payment_method_code", p["method"]); dateRange("expense_date", p["from"], p["to"])
            if (q.q != null) ilike("description", "%${q.q}%")
        }, mapOf("expense_date" to "expense_date", "amount" to "amount", "created_at" to "created_at"))
        call.respond(paged(rows, q, total))
    }
    post("/expenses") {
        val ctx = call.require("expenses.manage")
        val body = call.receiveOrThrow<JsonObject>()
        validate { positive(body.dbl("amount"), "amount", "El monto"); notBlank(body.str("description"), "description", "La descripción"); notBlank(body.str("expense_category_id"), "expense_category_id", "La categoría") }
        val branch = call.branchOrDefault(body.str("branch_id"))
        val x = db.rpcObject("create_expense", jsonOf("p_org" to ctx.organizationId, "p_branch" to branch, "p_category" to body.str("expense_category_id"), "p_description" to body.str("description"),
            "p_amount" to body.dbl("amount"), "p_date" to body.str("expense_date"), "p_method" to (body.str("payment_method_code") ?: "CASH"), "p_user" to ctx.userId,
            "p_shift" to body.str("cash_shift_id"), "p_supplier" to body.str("supplier_id"), "p_receipt_url" to body.str("receipt_url"), "p_notes" to body.str("notes")))
        call.respond(HttpStatusCode.Created, x)
    }
    patch("/expenses/{id}") {
        val ctx = call.require("expenses.manage")
        val id = call.requiredParam("id")
        val before = db.one("expenses") { eq("id", id); org(ctx); isNull("deleted_at") } ?: throw ErpException.notFound("Gasto no encontrado.")
        if (before.str("cash_shift_id") != null) throw ErpException.conflict("Este gasto salió de caja; cancélalo con un depósito en el turno en lugar de editarlo.")
        val body = pick(call.receiveOrThrow<JsonObject>(), listOf("description", "amount", "expense_date", "expense_category_id", "payment_method_code", "supplier_id", "receipt_url", "notes", "branch_id"))
        validate { nonNegative(body.dbl("amount"), "amount", "El monto") }
        val after = db.update("expenses", id, body)
        audit.log(call, "expenses.update", "EXPENSE", id, before, after)
        call.respond(after)
    }
    delete("/expenses/{id}") {
        val ctx = call.require("expenses.manage")
        val id = call.requiredParam("id")
        val before = db.one("expenses") { eq("id", id); org(ctx); isNull("deleted_at") } ?: throw ErpException.notFound("Gasto no encontrado.")
        if (before.str("cash_shift_id") != null) throw ErpException.conflict("Este gasto salió de caja y forma parte del corte; no puede eliminarse.")
        db.update("expenses", id, jsonOf("deleted_at" to nowIso(), "deleted_by" to ctx.userId))
        audit.log(call, "expenses.delete", "EXPENSE", id, before, null)
        call.respond(HttpStatusCode.NoContent)
    }
    get("/expense-categories") {
        val ctx = call.require("expenses.manage", "cash.read", "analytics.financial")
        call.respond(JsonArray(db.selectAll("expense_categories", order = "display_order") { org(ctx) }))
    }
    post("/expense-categories") {
        val ctx = call.require("expenses.manage")
        val body = pick(call.receiveOrThrow<JsonObject>(), listOf("code", "name", "display_order", "is_active"))
        validate { notBlank(body.str("name"), "name", "El nombre") }
        val row = db.insert("expense_categories", body.with("organization_id" to ctx.organizationId, "code" to (body.str("code") ?: slugify(body.str("name")!!).uppercase())))
        audit.log(call, "expense_categories.create", "EXPENSE_CATEGORY", row.str("id"), null, row)
        call.respond(HttpStatusCode.Created, row)
    }
    patch("/expense-categories/{id}") {
        val ctx = call.require("expenses.manage")
        val id = call.requiredParam("id")
        val before = db.one("expense_categories") { eq("id", id); org(ctx) } ?: throw ErpException.notFound()
        val after = db.update("expense_categories", id, pick(call.receiveOrThrow<JsonObject>(), listOf("name", "display_order", "is_active")))
        audit.log(call, "expense_categories.update", "EXPENSE_CATEGORY", id, before, after)
        call.respond(after)
    }
}
