package com.sexyshop.services.dashboard

import com.sexyshop.models.dashboard.DashboardStats
import com.sexyshop.models.dashboard.LowStockProduct
import com.sexyshop.models.dashboard.TopProduct
import com.sexyshop.repositories.category.CategoryRepository
import com.sexyshop.repositories.expense.ExpenseRepository
import com.sexyshop.repositories.order.OrderRepository
import com.sexyshop.repositories.product.ProductRepository
import java.time.YearMonth
import java.time.ZoneOffset

class DashboardService(
    private val orderRepository: OrderRepository,
    private val productRepository: ProductRepository,
    private val categoryRepository: CategoryRepository,
    private val expenseRepository: ExpenseRepository,
) {
    suspend fun getStats(): DashboardStats {
        val allOrders = orderRepository.getAll()
        val allProducts = productRepository.getAll(activeOnly = false)
        val allCategories = categoryRepository.getAll()

        val nonCancelled = allOrders.filter { it.status != "cancelled" }
        val totalRevenue = nonCancelled.sumOf { it.total }

        // Build product cost lookup map
        val productCostMap = allProducts.associate { it.id to it.costPrice }

        // This month's orders
        val now = YearMonth.now()
        val monthStart = now.atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC).toString()
        val ordersThisMonth = nonCancelled.filter { (it.createdAt ?: "") >= monthStart }
        val revenueThisMonth = ordersThisMonth.sumOf { it.total }

        // Status distribution
        val statusDist = allOrders.groupBy { it.status }.mapValues { it.value.size }

        // Low stock (stock <= 5, active only)
        val lowStock = allProducts
            .filter { it.isActive && it.stock <= 5 }
            .sortedBy { it.stock }
            .take(10)
            .map { LowStockProduct(it.id, it.name, it.stock) }

        // Top products by quantity sold (from non-cancelled orders)
        val topProductsMap = mutableMapOf<String, Pair<Int, Double>>() // name -> (qty, revenue)
        var totalCost = 0.0
        var monthlyCost = 0.0
        for (order in nonCancelled.take(100)) { // limit to last 100 orders for performance
            try {
                val items = orderRepository.getItemsByOrderId(order.id)
                val isThisMonth = (order.createdAt ?: "") >= monthStart
                items.forEach { item ->
                    val existing = topProductsMap[item.productName] ?: (0 to 0.0)
                    topProductsMap[item.productName] =
                        (existing.first + item.quantity) to (existing.second + item.subtotal)

                    // Calculate cost
                    val costPrice = item.productId?.let { productCostMap[it] } ?: 0.0
                    val itemCost = item.quantity * costPrice
                    totalCost += itemCost
                    if (isThisMonth) {
                        monthlyCost += itemCost
                    }
                }
            } catch (_: Exception) { }
        }
        val topProducts = topProductsMap.entries
            .sortedByDescending { it.value.first }
            .take(5)
            .map { TopProduct(it.key, it.value.first, it.value.second) }

        // Financial calculations
        val grossProfit = totalRevenue - totalCost

        // Expenses
        val allExpenses = expenseRepository.getAll()
        val totalExpenses = allExpenses.sumOf { it.amount }

        val monthStartDate = now.atDay(1).toString()
        val monthEndDate = now.atEndOfMonth().toString()
        val monthlyExpensesList = allExpenses.filter {
            it.expenseDate >= monthStartDate && it.expenseDate <= monthEndDate
        }
        val monthlyExpenses = monthlyExpensesList.sumOf { it.amount }

        val netProfit = grossProfit - totalExpenses
        val monthlyProfit = revenueThisMonth - monthlyCost - monthlyExpenses
        val ownerShare = monthlyProfit * 0.25

        return DashboardStats(
            totalRevenue = totalRevenue,
            totalOrders = allOrders.size,
            ordersThisMonth = ordersThisMonth.size,
            revenueThisMonth = revenueThisMonth,
            totalProducts = allProducts.size,
            totalCategories = allCategories.size,
            topProducts = topProducts,
            lowStockAlerts = lowStock,
            statusDistribution = statusDist,
            totalCost = totalCost,
            grossProfit = grossProfit,
            totalExpenses = totalExpenses,
            netProfit = netProfit,
            ownerShare = ownerShare,
            monthlyExpenses = monthlyExpenses,
            monthlyCost = monthlyCost,
            monthlyProfit = monthlyProfit,
        )
    }
}
