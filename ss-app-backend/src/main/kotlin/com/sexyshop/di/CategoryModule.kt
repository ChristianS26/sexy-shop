package com.sexyshop.di

import com.sexyshop.repositories.category.CategoryRepository
import com.sexyshop.repositories.category.CategoryRepositoryImpl
import com.sexyshop.services.category.CategoryService
import org.koin.dsl.module

val categoryModule = module {
    single<CategoryRepository> { CategoryRepositoryImpl(get()) }
    single { CategoryService(get()) }
}
