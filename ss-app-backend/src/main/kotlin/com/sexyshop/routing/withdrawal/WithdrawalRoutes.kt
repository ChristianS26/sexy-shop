package com.sexyshop.routing.withdrawal

import com.sexyshop.models.withdrawal.Withdrawal
import com.sexyshop.models.withdrawal.WithdrawalRequest
import com.sexyshop.repositories.withdrawal.WithdrawalRepository
import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Route.withdrawalRoutes(repository: WithdrawalRepository) {
    route("/withdrawals") {
        get {
            call.respond(repository.getAll())
        }
        post {
            val request = call.receive<WithdrawalRequest>()
            val withdrawal = Withdrawal(
                amount = request.amount,
                description = request.description,
                withdrawalDate = request.withdrawalDate,
            )
            call.respond(HttpStatusCode.Created, repository.create(withdrawal))
        }
        delete("/{id}") {
            val id = call.parameters["id"]!!
            repository.delete(id)
            call.respond(HttpStatusCode.NoContent)
        }
    }
}
