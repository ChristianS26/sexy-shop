package com.sexyshop.repositories.withdrawal

import com.sexyshop.models.withdrawal.Withdrawal
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order

class WithdrawalRepositoryImpl(
    private val supabase: SupabaseClient,
) : WithdrawalRepository {

    override suspend fun getAll(): List<Withdrawal> {
        return supabase.from("withdrawals")
            .select { order("withdrawal_date", Order.DESCENDING) }
            .decodeList<Withdrawal>()
    }

    override suspend fun create(withdrawal: Withdrawal): Withdrawal {
        supabase.from("withdrawals").insert(withdrawal)
        return supabase.from("withdrawals")
            .select { order("created_at", Order.DESCENDING); limit(1) }
            .decodeSingle<Withdrawal>()
    }

    override suspend fun delete(id: String) {
        supabase.from("withdrawals").delete { filter { eq("id", id) } }
    }
}
