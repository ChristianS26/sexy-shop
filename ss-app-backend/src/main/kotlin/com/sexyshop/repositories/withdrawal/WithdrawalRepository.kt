package com.sexyshop.repositories.withdrawal

import com.sexyshop.models.withdrawal.Withdrawal

interface WithdrawalRepository {
    suspend fun getAll(): List<Withdrawal>
    suspend fun create(withdrawal: Withdrawal): Withdrawal
    suspend fun delete(id: String)
}
