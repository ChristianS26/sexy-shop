package com.sexyshop.erp.core

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import kotlinx.serialization.json.*
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Exportación a CSV y XLSX sin dependencias pesadas (SpreadsheetML escrito a mano).
 * Apto para el contenedor de 512 MB: todo se escribe en streaming a un buffer.
 */
data class ExportColumn(val key: String, val label: String, val numeric: Boolean = false)

object Exporter {
    fun csv(columns: List<ExportColumn>, rows: List<JsonObject>): ByteArray {
        val sb = StringBuilder("﻿") // BOM para que Excel abra UTF-8 correctamente
        sb.append(columns.joinToString(",") { esc(it.label) }).append("\r\n")
        rows.forEach { r -> sb.append(columns.joinToString(",") { esc(cell(r, it.key)) }).append("\r\n") }
        return sb.toString().toByteArray(Charsets.UTF_8)
    }

    fun xlsx(sheet: String, columns: List<ExportColumn>, rows: List<JsonObject>): ByteArray {
        val bos = ByteArrayOutputStream()
        ZipOutputStream(bos).use { zip ->
            fun put(name: String, content: String) { zip.putNextEntry(ZipEntry(name)); zip.write(content.toByteArray(Charsets.UTF_8)); zip.closeEntry() }
            put("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>""")
            put("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""")
            put("xl/workbook.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheet.take(31))}" sheetId="1" r:id="rId1"/></sheets></workbook>""")
            put("xl/_rels/workbook.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>""")
            put("xl/styles.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF6B1F32"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8E1DD"/></patternFill></fill></fills><borders count="1"><border/></borders><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>""")
            val sb = StringBuilder()
            sb.append("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>""")
            columns.forEachIndexed { i, c -> sb.append("""<col min="${i + 1}" max="${i + 1}" width="${(c.label.length + 6).coerceIn(10, 40)}" customWidth="1"/>""") }
            sb.append("</cols><sheetData>")
            sb.append("<row r=\"1\">")
            columns.forEachIndexed { i, c -> sb.append("""<c r="${colRef(i)}1" t="inlineStr" s="1"><is><t>${xml(c.label)}</t></is></c>""") }
            sb.append("</row>")
            rows.forEachIndexed { ri, r ->
                val rn = ri + 2
                sb.append("<row r=\"$rn\">")
                columns.forEachIndexed { ci, c ->
                    val v = r[c.key]
                    val ref = "${colRef(ci)}$rn"
                    when {
                        v == null || v is JsonNull -> {}
                        v is JsonPrimitive && !v.isString && v.doubleOrNull != null -> sb.append("""<c r="$ref" s="${if (c.numeric) 2 else 0}"><v>${v.content}</v></c>""")
                        v is JsonPrimitive && v.booleanOrNull != null -> sb.append("""<c r="$ref" t="inlineStr"><is><t>${if (v.boolean) "Sí" else "No"}</t></is></c>""")
                        else -> sb.append("""<c r="$ref" t="inlineStr"><is><t>${xml(cell(r, c.key))}</t></is></c>""")
                    }
                }
                sb.append("</row>")
            }
            sb.append("</sheetData></worksheet>")
            put("xl/worksheets/sheet1.xml", sb.toString())
        }
        return bos.toByteArray()
    }

    /** Códigos internos → texto para la persona que abre el archivo. */
    private val LABELS = mapOf(
        "COMPLETED" to "Completada", "CANCELLED" to "Cancelada", "REFUNDED" to "Devuelta", "PARTIALLY_REFUNDED" to "Devolución parcial",
        "POS" to "Tienda", "ONLINE" to "En línea", "WHATSAPP" to "WhatsApp", "MARKETPLACE" to "Marketplace", "IMPORT" to "Importado",
        "DRAFT" to "Borrador", "SENT" to "Enviada", "PARTIAL" to "Parcial", "RECEIVED" to "Recibida", "IN_TRANSIT" to "En tránsito",
        "OUT" to "Agotado", "CRITICAL" to "Crítico", "LOW" to "Bajo", "HEALTHY" to "Saludable", "EXCESS" to "Exceso",
        "ACTIVE" to "Activo", "INACTIVE" to "Inactivo", "OPEN" to "Abierto", "CLOSED" to "Cerrado", "FINALIZED" to "Finalizado",
        "CHAMPIONS" to "Champions", "LOYAL" to "Leales", "NEW" to "Nuevos", "POTENTIAL" to "Potenciales", "AT_RISK" to "En riesgo",
        "CANT_LOSE" to "No perder", "HIBERNATING" to "Dormidos", "LOST" to "Perdidos",
        "FAST" to "Rápida", "NORMAL" to "Normal", "SLOW" to "Lenta", "DEAD" to "Sin movimiento",
        "SALE" to "Venta", "PURCHASE" to "Compra", "SALE_RETURN" to "Devolución", "PURCHASE_RETURN" to "Devolución a proveedor",
        "TRANSFER_IN" to "Entrada por transferencia", "TRANSFER_OUT" to "Salida por transferencia", "ADJUSTMENT_IN" to "Ajuste (+)",
        "ADJUSTMENT_OUT" to "Ajuste (−)", "DAMAGE" to "Merma", "LOSS" to "Pérdida", "INITIAL_STOCK" to "Inventario inicial", "INVENTORY_COUNT" to "Conteo físico",
        "CASH" to "Efectivo", "CARD" to "Tarjeta", "TRANSFER" to "Transferencia", "MERCADO_PAGO" to "Mercado Pago", "OTHER" to "Otro",
    )
    private val ZONE = java.time.ZoneId.of("America/Hermosillo")
    private val DT = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
    private fun human(s: String): String = when {
        LABELS.containsKey(s) -> LABELS.getValue(s)
        // fecha "pura" de un corte por día/mes (sin zona): solo la fecha
        Regex("""^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?$""").matches(s) -> s.take(10)
        // marca de tiempo con zona: hora local de la tienda
        Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$""").matches(s) ->
            runCatching { java.time.OffsetDateTime.parse(s).atZoneSameInstant(ZONE).format(DT) }.getOrDefault(s)
        else -> s
    }
    private fun cell(r: JsonObject, key: String): String = when (val v = r[key]) {
        null, is JsonNull -> ""
        is JsonPrimitive -> if (v.isString) human(v.content) else v.content
        else -> v.toString()
    }

    private fun esc(s: String): String = if (s.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) "\"" + s.replace("\"", "\"\"") + "\"" else s
    private fun xml(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
    private fun colRef(i: Int): String { var n = i; val sb = StringBuilder(); do { sb.insert(0, ('A' + n % 26)); n = n / 26 - 1 } while (n >= 0); return sb.toString() }
}

/** Responde CSV/XLSX según ?format=, o JSON por defecto. */
suspend fun ApplicationCall.respondExport(name: String, columns: List<ExportColumn>, rows: List<JsonObject>, format: String?) {
    val stamp = java.time.LocalDate.now().toString()
    when (format?.lowercase()) {
        "csv" -> {
            response.header(HttpHeaders.ContentDisposition, "attachment; filename=\"$name-$stamp.csv\"")
            respondBytes(Exporter.csv(columns, rows), ContentType.Text.CSV.withCharset(Charsets.UTF_8))
        }
        "xlsx" -> {
            response.header(HttpHeaders.ContentDisposition, "attachment; filename=\"$name-$stamp.xlsx\"")
            respondBytes(Exporter.xlsx(name.take(31), columns, rows), ContentType.parse("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        }
        else -> respond(jsonOf("columns" to columns.map { jsonOf("key" to it.key, "label" to it.label, "numeric" to it.numeric) }, "rows" to JsonArray(rows), "total" to rows.size))
    }
}
