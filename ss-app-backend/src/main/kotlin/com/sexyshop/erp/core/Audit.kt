package com.sexyshop.erp.core

import io.ktor.server.application.*
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.slf4j.LoggerFactory

/**
 * Bitácora de auditoría. Las operaciones que viven en funciones SQL auditan dentro de su
 * transacción; esto cubre las que se resuelven en Kotlin (CRUD de catálogo, usuarios, settings…).
 * Nunca lanza: una falla de auditoría se registra en log pero no rompe la operación.
 */
class AuditService(private val db: Db) {
    private val log = LoggerFactory.getLogger(AuditService::class.java)

    suspend fun log(
        call: ApplicationCall,
        action: String,
        entityType: String? = null,
        entityId: String? = null,
        before: JsonElement? = null,
        after: JsonElement? = null,
        metadata: JsonObject? = null,
    ) {
        val ctx = call.erpAuthOrNull
        runCatching {
            db.rpc("audit_log", jsonOf(
                "p_org" to ctx?.organizationId, "p_user" to ctx?.userId, "p_action" to action,
                "p_entity_type" to entityType, "p_entity_id" to entityId,
                "p_before" to before, "p_after" to after, "p_metadata" to metadata, "p_ip" to call.clientIp,
            ))
        }.onFailure { log.error("No se pudo auditar {}: {}", action, it.message) }
    }
}
