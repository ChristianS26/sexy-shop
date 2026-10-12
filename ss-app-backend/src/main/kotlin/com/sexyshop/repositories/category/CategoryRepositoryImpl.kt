package com.sexyshop.repositories.category

import com.sexyshop.models.category.Category
import com.sexyshop.models.category.CategoryRequest
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest

class CategoryRepositoryImpl(
    private val supabase: SupabaseClient,
) : CategoryRepository {

    override suspend fun getAll(): List<Category> {
        // Solo la organización por defecto (la tienda): el ERP puede tener otras (p. ej. demo)
        val orgId = defaultOrganizationId(supabase)
        return supabase.from("categories")
            .select {
                filter {
                    eq("organization_id", orgId)
                    filter("deleted_at", io.github.jan.supabase.postgrest.query.filter.FilterOperator.IS, "null")
                    filter("parent_id", io.github.jan.supabase.postgrest.query.filter.FilterOperator.IS, "null")
                }
                order("display_order", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }
            .decodeList<Category>()
    }

    override suspend fun getBySlug(slug: String): Category? {
        return supabase.from("categories")
            .select {
                filter { eq("slug", slug) }
            }
            .decodeSingleOrNull<Category>()
    }

    override suspend fun create(request: CategoryRequest): Category {
        supabase.from("categories").insert(request)
        return supabase.from("categories")
            .select {
                filter { eq("slug", request.slug) }
            }
            .decodeSingle<Category>()
    }

    override suspend fun update(id: String, request: CategoryRequest): Category {
        supabase.from("categories")
            .update(request) {
                filter { eq("id", id) }
            }
        return supabase.from("categories")
            .select {
                filter { eq("id", id) }
            }
            .decodeSingle<Category>()
    }

    override suspend fun delete(id: String) {
        supabase.from("categories")
            .delete {
                filter { eq("id", id) }
            }
    }
}

// ── Organización por defecto (cacheada): la que ve el storefront ────────────
@Volatile private var cachedDefaultOrg: String? = null

suspend fun defaultOrganizationId(supabase: SupabaseClient): String {
    cachedDefaultOrg?.let { return it }
    val id = supabase.postgrest.rpc("default_organization_id").data.trim().trim('"')
    cachedDefaultOrg = id
    return id
}
