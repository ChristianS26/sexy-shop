package com.sexyshop.erp.core

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.postgrest.exception.PostgrestRestException
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Count
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.PostgrestRequestBuilder
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.postgrest.query.filter.PostgrestFilterBuilder
import io.ktor.http.*
import kotlinx.serialization.json.*
import org.slf4j.LoggerFactory

/**
 * Acceso a datos del ERP sobre PostgREST (supabase-kt) con traducción de errores de
 * negocio lanzados desde las funciones SQL a mensajes legibles.
 */
class Db(val supabase: SupabaseClient) {
    private val log = LoggerFactory.getLogger(Db::class.java)

    /** Llama a una función SQL y devuelve el JSON crudo. */
    suspend fun rpc(fn: String, params: JsonObject = JsonObject(emptyMap())): JsonElement = guard {
        val res = supabase.postgrest.rpc(fn, params)
        val data = res.data
        if (data.isBlank()) JsonNull else erpJson.parseToJsonElement(data)
    }

    suspend fun rpcObject(fn: String, params: JsonObject = JsonObject(emptyMap())): JsonObject =
        rpc(fn, params).let { if (it is JsonObject) it else throw ErpException(HttpStatusCode.InternalServerError, "RPC", "Respuesta inesperada del servidor.") }

    /** Lista paginada genérica sobre una tabla/vista. */
    suspend fun list(
        table: String,
        columns: String = "*",
        page: PageQuery? = null,
        filters: PostgrestFilterBuilder.() -> Unit = {},
        allowedSorts: Map<String, String> = emptyMap(),
        defaultOrder: String? = null,
    ): Pair<List<JsonObject>, Long> = guard {
        val res = supabase.from(table).select(columns = Columns.raw(columns)) {
            count(Count.EXACT)
            filter(filters)
            val sortCol = page?.sort?.let { allowedSorts[it] ?: it.takeIf { s -> allowedSorts.isEmpty() && Regex("^[a-z_]+$").matches(s) } } ?: defaultOrder
            if (sortCol != null) order(sortCol, if (page?.desc != false) Order.DESCENDING else Order.ASCENDING, nullsFirst = false)
            if (page != null) range(page.from.toLong(), page.to.toLong())
        }
        val rows = res.decodeList<JsonObject>()
        rows to (res.countOrNull() ?: rows.size.toLong())
    }

    suspend fun selectAll(table: String, columns: String = "*", order: String? = null, asc: Boolean = true, limit: Long? = null, filters: PostgrestFilterBuilder.() -> Unit = {}): List<JsonObject> = guard {
        supabase.from(table).select(columns = Columns.raw(columns)) {
            filter(filters)
            if (order != null) order(order, if (asc) Order.ASCENDING else Order.DESCENDING)
            if (limit != null) limit(limit)
        }.decodeList<JsonObject>()
    }

    suspend fun one(table: String, columns: String = "*", filters: PostgrestFilterBuilder.() -> Unit): JsonObject? = guard {
        supabase.from(table).select(columns = Columns.raw(columns)) { filter(filters); limit(1) }.decodeList<JsonObject>().firstOrNull()
    }

    suspend fun byId(table: String, id: String, columns: String = "*"): JsonObject =
        one(table, columns) { eq("id", id) } ?: throw ErpException.notFound()

    suspend fun insert(table: String, row: JsonObject): JsonObject = guard {
        supabase.from(table).insert(row) { select() }.decodeSingle<JsonObject>()
    }

    suspend fun insertMany(table: String, rows: List<JsonObject>): List<JsonObject> = guard {
        if (rows.isEmpty()) emptyList() else supabase.from(table).insert(rows) { select() }.decodeList<JsonObject>()
    }

    suspend fun upsert(table: String, row: JsonObject): JsonObject? = guard {
        supabase.from(table).upsert(row) { select() }.decodeList<JsonObject>().firstOrNull()
    }

    suspend fun update(table: String, id: String, patch: JsonObject): JsonObject = guard {
        supabase.from(table).update(patch) { filter { eq("id", id) }; select() }.decodeList<JsonObject>().firstOrNull()
            ?: throw ErpException.notFound()
    }

    suspend fun updateWhere(table: String, patch: JsonObject, filters: PostgrestFilterBuilder.() -> Unit): List<JsonObject> = guard {
        supabase.from(table).update(patch) { filter(filters); select() }.decodeList<JsonObject>()
    }

    suspend fun delete(table: String, filters: PostgrestFilterBuilder.() -> Unit) = guard {
        supabase.from(table).delete { filter(filters) }
        Unit
    }

    suspend fun count(table: String, filters: PostgrestFilterBuilder.() -> Unit = {}): Long = guard {
        supabase.from(table).select(columns = Columns.raw("id")) { count(Count.EXACT); filter(filters); limit(1) }.countOrNull() ?: 0L
    }

    private suspend inline fun <T> guard(block: () -> T): T = try {
        block()
    } catch (e: ErpException) {
        throw e
    } catch (e: RestException) {
        throw translate(e)
    }

    /** Traduce los errores que lanzan las funciones SQL (RAISE EXCEPTION 'CODIGO: detalle'). */
    private fun translate(e: RestException): ErpException {
        val pg = e as? PostgrestRestException
        val raw = listOfNotNull(e.message, e.description, e.error, pg?.details, pg?.hint, pg?.code).joinToString(" | ")
        log.warn("DB error: {}", raw.take(600))
        val codeMatch = Regex("([A-Z_]{4,})(?::\\s*([^|\"\\n\\r]+))?").find(raw)
        val code = codeMatch?.groupValues?.get(1)
        val detail = codeMatch?.groupValues?.getOrNull(2)?.trim()?.takeIf { it.isNotBlank() }
        fun msg(default: String) = detail?.let { if (it.length > 3) it.replaceFirstChar(Char::uppercase) else default } ?: default
        return when (code) {
            "STOCK_INSUFICIENTE" -> ErpException.conflict("No hay existencia suficiente para completar la operación.", code)
            "CAJA_ABIERTA" -> ErpException.conflict(msg("Esta caja ya tiene un turno abierto."), code)
            "TURNO_CERRADO" -> ErpException.conflict(msg("El turno de caja está cerrado."), code)
            "TURNO_REQUERIDO" -> ErpException.conflict(msg("Abre un turno de caja para continuar."), code)
            "TURNO_INVALIDO" -> ErpException.conflict(msg("El turno no corresponde a esta sucursal."), code)
            "ESTADO_INVALIDO" -> ErpException.conflict(msg("La operación no es válida en el estado actual."), code)
            "FUERA_DE_PLAZO" -> ErpException.conflict(msg("Ya pasó el plazo para esta operación."), code)
            "DESCUENTO_EXCEDE_LIMITE" -> ErpException.forbidden(msg("El descuento excede el límite permitido para tu rol."))
            "IMMUTABLE_ROW" -> ErpException.forbidden("Este registro forma parte del historial y no se puede modificar.")
            "NOT_FOUND" -> ErpException.notFound()
            "NO_WAREHOUSE" -> ErpException.conflict(msg("La sucursal no tiene un almacén configurado."), code)
            "SIN_PARTIDAS", "CANTIDAD_INVALIDA", "PAGO_INSUFICIENTE", "PAGO_INVALIDO", "PAGO_EXCEDE", "SIN_PAGO", "METODO_PAGO_INVALIDO",
            "REFERENCIA_REQUERIDA", "DESCUENTO_INVALIDO", "PRODUCTO_INVALIDO", "PRODUCTO_INACTIVO", "VARIANTE_INVALIDA", "VARIANTE_REQUERIDA",
            "PRECIO_INVALIDO", "CLIENTE_INVALIDO", "MOTIVO_REQUERIDO", "PARTIDA_INVALIDA", "MONTO_INVALIDO", "TIPO_INVALIDO", "DATOS_INCOMPLETOS",
            "SIGNO_INVALIDO", "DESCRIPCION_REQUERIDA" -> ErpException.badRequest(msg("Revisa los datos de la operación."), code)
            else -> when {
                raw.contains("23505") || raw.contains("duplicate key") -> ErpException.conflict("Ya existe un registro con ese valor (SKU, código o nombre duplicado).", "DUPLICATE")
                raw.contains("23503") || raw.contains("foreign key") -> ErpException.conflict("No se puede completar porque hay registros relacionados.", "RELATED_RECORDS")
                raw.contains("23514") || raw.contains("check constraint") -> ErpException.badRequest("Alguno de los valores no está permitido.", "CHECK")
                raw.contains("PGRST116") -> ErpException.notFound()
                else -> ErpException(HttpStatusCode.InternalServerError, "DB_ERROR", "La operación no pudo completarse. Intenta de nuevo.")
            }
        }
    }
}

// Azúcar sintáctica para filtros frecuentes
fun PostgrestFilterBuilder.isNull(column: String) = filter(column, FilterOperator.IS, "null")
fun PostgrestFilterBuilder.notNull(column: String) = filterNot(column, FilterOperator.IS, "null")
fun PostgrestFilterBuilder.org(auth: AuthContext) = eq("organization_id", auth.organizationId)
fun PostgrestFilterBuilder.search(column: String, q: String?) { if (!q.isNullOrBlank()) ilike(column, "%${q.replace("%", "").replace(",", " ")}%") }
fun PostgrestFilterBuilder.eqOpt(column: String, value: String?) { if (!value.isNullOrBlank()) eq(column, value) }
fun PostgrestFilterBuilder.dateRange(column: String, from: String?, to: String?) {
    if (!from.isNullOrBlank()) gte(column, from)
    if (!to.isNullOrBlank()) lt(column, to)
}
