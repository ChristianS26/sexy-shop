package com.sexyshop.di

import com.sexyshop.repositories.expense.ExpenseRepository
import com.sexyshop.repositories.expense.ExpenseRepositoryImpl
import org.koin.dsl.module

val expenseModule = module {
    single<ExpenseRepository> { ExpenseRepositoryImpl(get()) }
}
