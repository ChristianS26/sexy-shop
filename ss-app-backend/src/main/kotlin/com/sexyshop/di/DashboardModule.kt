package com.sexyshop.di

import com.sexyshop.services.dashboard.DashboardService
import org.koin.dsl.module

val dashboardModule = module {
    single { DashboardService(get(), get(), get(), get()) }
}
