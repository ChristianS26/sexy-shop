package com.sexyshop.repositories.expense

import com.sexyshop.models.expense.Expense
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order

class ExpenseRepositoryImpl(
    private val supabase: SupabaseClient,
) : ExpenseRepository {

    override suspend fun getAll(): List<Expense> {
        return supabase.from("expenses")
            .select {
                order("expense_date", Order.DESCENDING)
            }
            .decodeList<Expense>()
    }

    override suspend fun getByDateRange(from: String, to: String): List<Expense> {
        return supabase.from("expenses")
            .select {
                filter {
                    gte("expense_date", from)
                    lte("expense_date", to)
                }
                order("expense_date", Order.DESCENDING)
            }
            .decodeList<Expense>()
    }

    override suspend fun create(expense: Expense): Expense {
        supabase.from("expenses").insert(expense)
        return supabase.from("expenses")
            .select {
                order("created_at", Order.DESCENDING)
                limit(1)
            }
            .decodeSingle<Expense>()
    }

    override suspend fun delete(id: String) {
        supabase.from("expenses")
            .delete {
                filter { eq("id", id) }
            }
    }
}
