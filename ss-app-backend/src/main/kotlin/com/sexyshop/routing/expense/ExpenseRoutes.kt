package com.sexyshop.routing.expense

import com.sexyshop.models.expense.Expense
import com.sexyshop.models.expense.ExpenseRequest
import com.sexyshop.repositories.expense.ExpenseRepository
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Route.expenseRoutes(repository: ExpenseRepository) {
    route("/expenses") {
        get {
            val from = call.parameters["from"]
            val to = call.parameters["to"]
            if (from != null && to != null) {
                call.respond(repository.getByDateRange(from, to))
            } else {
                call.respond(repository.getAll())
            }
        }

        post {
            val request = call.receive<ExpenseRequest>()
            val expense = Expense(
                description = request.description,
                amount = request.amount,
                category = request.category,
                expenseDate = request.expenseDate,
            )
            call.respond(HttpStatusCode.Created, repository.create(expense))
        }

        delete("/{id}") {
            val id = call.parameters["id"]!!
            repository.delete(id)
            call.respond(HttpStatusCode.NoContent)
        }
    }
}
