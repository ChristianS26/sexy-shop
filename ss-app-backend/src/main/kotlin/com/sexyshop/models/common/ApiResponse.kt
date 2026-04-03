package com.sexyshop.models.common

import kotlinx.serialization.Serializable

@Serializable
data class ApiResponse<T>(
    val success: Boolean,
    val data: T? = null,
    val error: String? = null,
)

@Serializable
data class PaginatedResponse<T>(
    val data: List<T>,
    val page: Int,
    val size: Int,
    val total: Long,
)
