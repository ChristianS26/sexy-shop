package com.sexyshop.models.expense

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Expense(
    val id: String = "",
    val description: String,
    val amount: Double,
    val category: String = "general",
    @SerialName("expense_date") val expenseDate: String,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class ExpenseRequest(
    val description: String,
    val amount: Double,
    val category: String = "general",
    @SerialName("expense_date") val expenseDate: String,
)
