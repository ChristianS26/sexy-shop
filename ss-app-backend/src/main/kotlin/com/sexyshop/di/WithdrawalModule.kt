package com.sexyshop.di

import com.sexyshop.repositories.withdrawal.WithdrawalRepository
import com.sexyshop.repositories.withdrawal.WithdrawalRepositoryImpl
import org.koin.dsl.module

val withdrawalModule = module {
    single<WithdrawalRepository> { WithdrawalRepositoryImpl(get()) }
}
