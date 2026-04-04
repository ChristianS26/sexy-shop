package com.sexyshop.repositories.expense

import com.sexyshop.models.expense.Expense

interface ExpenseRepository {
    suspend fun getAll(): List<Expense>
    suspend fun getByDateRange(from: String, to: String): List<Expense>
    suspend fun create(expense: Expense): Expense
    suspend fun delete(id: String)
}
