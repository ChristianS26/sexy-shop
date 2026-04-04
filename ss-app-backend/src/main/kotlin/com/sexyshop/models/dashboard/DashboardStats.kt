package com.sexyshop.models.dashboard

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class DashboardStats(
    @SerialName("total_revenue") val totalRevenue: Double,
    @SerialName("total_orders") val totalOrders: Int,
    @SerialName("orders_this_month") val ordersThisMonth: Int,
    @SerialName("revenue_this_month") val revenueThisMonth: Double,
    @SerialName("total_products") val totalProducts: Int,
    @SerialName("total_categories") val totalCategories: Int,
    @SerialName("top_products") val topProducts: List<TopProduct>,
    @SerialName("low_stock_alerts") val lowStockAlerts: List<LowStockProduct>,
    @SerialName("status_distribution") val statusDistribution: Map<String, Int>,
    @SerialName("total_cost") val totalCost: Double,
    @SerialName("gross_profit") val grossProfit: Double,
    @SerialName("total_expenses") val totalExpenses: Double,
    @SerialName("net_profit") val netProfit: Double,
    @SerialName("owner_share") val ownerShare: Double,
    @SerialName("monthly_expenses") val monthlyExpenses: Double,
    @SerialName("monthly_cost") val monthlyCost: Double,
    @SerialName("monthly_profit") val monthlyProfit: Double,
)

@Serializable
data class TopProduct(
    val name: String,
    @SerialName("total_sold") val totalSold: Int,
    val revenue: Double,
)

@Serializable
data class LowStockProduct(
    val id: String,
    val name: String,
    val stock: Int,
)
