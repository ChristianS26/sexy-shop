package com.sexyshop.models.withdrawal

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Withdrawal(
    val id: String = "",
    val amount: Double,
    val description: String? = null,
    @SerialName("withdrawal_date") val withdrawalDate: String,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class WithdrawalRequest(
    val amount: Double,
    val description: String? = null,
    @SerialName("withdrawal_date") val withdrawalDate: String,
)
