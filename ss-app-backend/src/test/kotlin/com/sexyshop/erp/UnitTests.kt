package com.sexyshop.erp

import com.sexyshop.erp.core.*
import com.sexyshop.erp.modules.bi.DateRange
import com.sexyshop.erp.modules.importer.TabularParser
import com.sexyshop.erp.modules.sales.CartLine
import com.sexyshop.erp.modules.sales.PromotionEngine
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.ktor.http.*
import kotlinx.serialization.json.*
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream
import kotlin.test.*

private fun dummyDb() = Db(createSupabaseClient("http://127.0.0.1:1", "x") { install(Postgrest) })

class PromotionEngineTest {
    private val engine = PromotionEngine(dummyDb())
    private fun promo(type: String, value: Double = 0.0, products: List<String> = emptyList(), categories: List<String> = emptyList(), extra: Map<String, Any?> = emptyMap()) = jsonOf(
        "id" to "p-$type", "name" to "Promo $type", "promo_type" to type, "value" to value, "min_amount" to (extra["min_amount"] ?: 0),
        "buy_qty" to extra["buy_qty"], "get_qty" to extra["get_qty"], "min_quantity" to extra["min_quantity"], "free_product_id" to extra["free_product_id"],
        "promotion_products" to products.map { jsonOf("product_id" to it) }, "promotion_categories" to categories.map { jsonOf("category_id" to it) },
    )
    private val lines = listOf(
        CartLine(0, "A", null, "cat1", null, 100.0, 2, "A"),
        CartLine(1, "B", null, "cat2", "cat1", 250.0, 1, "B"),
        CartLine(2, "C", null, "cat3", null, 50.0, 4, "C"),
    )

    @Test fun `percent applies to eligible products only`() {
        val r = engine.apply(lines, listOf(promo("PERCENT", 10.0, products = listOf("A"))))
        assertEquals(20.0, r.lineDiscounts[0]!!.first)
        assertNull(r.lineDiscounts[1]); assertNull(r.lineDiscounts[2])
        assertEquals(1, r.applied.size)
    }
    @Test fun `category percent includes subcategories through parent`() {
        val r = engine.apply(lines, listOf(promo("CATEGORY_PERCENT", 20.0, categories = listOf("cat1"))))
        assertEquals(40.0, r.lineDiscounts[0]!!.first)   // cat1 directo
        assertEquals(50.0, r.lineDiscounts[1]!!.first)   // padre cat1
        assertNull(r.lineDiscounts[2])
    }
    @Test fun `buy x get y gives free units per block`() {
        val r = engine.apply(lines, listOf(promo("BUY_X_GET_Y", products = listOf("C"), extra = mapOf("buy_qty" to 2, "get_qty" to 1))))
        assertEquals(50.0, r.lineDiscounts[2]!!.first) // 4 unidades: 1 bloque de 3 -> 1 gratis
    }
    @Test fun `min amount blocks promotion`() {
        val r = engine.apply(lines, listOf(promo("PERCENT", 10.0, extra = mapOf("min_amount" to 10000))))
        assertTrue(r.lineDiscounts.isEmpty())
    }
    @Test fun `best discount wins per line and never exceeds line gross`() {
        val r = engine.apply(lines, listOf(promo("PERCENT", 10.0, products = listOf("A")), promo("FIXED", 500.0, products = listOf("A"))))
        assertEquals(200.0, r.lineDiscounts[0]!!.first) // FIXED limitado al bruto de la línea
        assertEquals("p-FIXED", r.lineDiscounts[0]!!.second)
    }
    @Test fun `free product suggests when missing and discounts when present`() {
        val r1 = engine.apply(lines, listOf(promo("FREE_PRODUCT", extra = mapOf("free_product_id" to "Z"))))
        assertEquals(1, r1.suggestions.size); assertTrue(r1.lineDiscounts.isEmpty())
        val r2 = engine.apply(lines + CartLine(3, "Z", null, null, null, 80.0, 1, "Z"), listOf(promo("FREE_PRODUCT", extra = mapOf("free_product_id" to "Z"))))
        assertEquals(80.0, r2.lineDiscounts[3]!!.first)
    }
    @Test fun `quantity discount requires minimum quantity`() {
        val r = engine.apply(lines, listOf(promo("QUANTITY_DISCOUNT", 15.0, extra = mapOf("min_quantity" to 3))))
        assertNull(r.lineDiscounts[0]); assertEquals(30.0, r.lineDiscounts[2]!!.first)
    }
}

class CoreHelpersTest {
    @Test fun `pick keeps whitelist and blanks become null`() {
        val body = jsonOf("name" to "  ", "price" to 10, "hack" to true)
        val p = pick(body, listOf("name", "price"))
        assertEquals(JsonNull, p["name"]); assertEquals(10, p.int("price")); assertFalse(p.containsKey("hack"))
    }
    @Test fun `validator reports first error with field map`() {
        val e = assertFailsWith<ErpException> { validate { notBlank(null, "name", "El nombre"); positive(-1.0, "price", "El precio") } }
        assertEquals(HttpStatusCode.UnprocessableEntity, e.status)
        assertEquals("El nombre es obligatorio.", e.message)
        assertEquals("El precio debe ser mayor a 0.", e.details!!.jsonObject["price"]!!.jsonPrimitive.content)
    }
    @Test fun `stripCost hides cost fields without permission`() {
        val ctx = fakeCtx(setOf("products.read"))
        val row = jsonOf("name" to "X", "price" to 100, "cost_price" to 40, "margin" to 60)
        val stripped = row.stripCost(ctx)
        assertFalse(stripped.containsKey("cost_price")); assertFalse(stripped.containsKey("margin")); assertEquals(100, stripped.int("price"))
        assertEquals(40, row.stripCost(fakeCtx(setOf("products.cost.read"))).int("cost_price"))
    }
    @Test fun `slugify normalizes accents`() { assertEquals("lubricante-seda-100-ml", slugify("Lubricante Séda 100 ml!")) }
    @Test fun `page query parses sort direction and limits size`() {
        val call = io.mockk.mockk<io.ktor.server.application.ApplicationCall>(relaxed = true)
        io.mockk.every { call.request.queryParameters } returns Parameters.build { append("page", "3"); append("size", "999"); append("sort", "-total"); append("q", " hola ") }
        val q = PageQuery.from(call, "sold_at")
        assertEquals(3, q.page); assertEquals(200, q.size); assertEquals("total", q.sort); assertTrue(q.desc); assertEquals("hola", q.q); assertEquals(400, q.from)
    }
}

class DateRangeTest {
    private fun call(vararg params: Pair<String, String>): io.ktor.server.application.ApplicationCall {
        val c = io.mockk.mockk<io.ktor.server.application.ApplicationCall>(relaxed = true)
        io.mockk.every { c.request.queryParameters } returns Parameters.build { params.forEach { append(it.first, it.second) } }
        return c
    }
    @Test fun `today covers one local day in Hermosillo`() {
        val r = DateRange.from(call("range" to "today"), "America/Hermosillo")
        assertEquals(1, r.days); assertEquals("Hoy", r.label); assertEquals("hour", r.granularity())
        assertTrue(r.from.toString().endsWith("T07:00:00Z")) // 00:00 Hermosillo = 07:00 UTC
    }
    @Test fun `custom validates order and picks granularity`() {
        val r = DateRange.from(call("range" to "custom", "from" to "2026-01-01", "to" to "2026-12-31"), "America/Hermosillo")
        assertEquals(365, r.days); assertEquals("week", r.granularity())
        assertFailsWith<ErpException> { DateRange.from(call("range" to "custom", "from" to "2026-02-01", "to" to "2026-01-01"), "America/Hermosillo") }
    }
    @Test fun `last month is a full calendar month`() {
        val r = DateRange.from(call("range" to "last_month"), "America/Hermosillo")
        assertTrue(r.days in 28..31)
    }
}

class ExportTest {
    private val cols = listOf(ExportColumn("name", "Producto"), ExportColumn("total", "Total", true))
    private val rows = listOf(jsonOf("name" to "Lub, \"Seda\"", "total" to 1234.5), jsonOf("name" to "Vela", "total" to 10))
    @Test fun `csv escapes quotes and commas with BOM`() {
        val csv = String(Exporter.csv(cols, rows), Charsets.UTF_8)
        assertTrue(csv.startsWith("﻿Producto,Total"))
        assertTrue(csv.contains("\"Lub, \"\"Seda\"\"\",1234.5"))
    }
    @Test fun `xlsx is a valid zip with sheet and numbers as values`() {
        val bytes = Exporter.xlsx("Ventas", cols, rows)
        val names = mutableMapOf<String, String>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { z -> var e = z.nextEntry; while (e != null) { names[e.name] = z.readBytes().toString(Charsets.UTF_8); e = z.nextEntry } }
        assertTrue("xl/worksheets/sheet1.xml" in names); assertTrue("[Content_Types].xml" in names)
        val sheet = names["xl/worksheets/sheet1.xml"]!!
        assertTrue(sheet.contains("<v>1234.5</v>")); assertTrue(sheet.contains("<t>Producto</t>")); assertTrue(sheet.contains("&quot;Seda&quot;"))
        // round trip con el parser de importación
        val parsed = TabularParser.parseXlsx(bytes)
        assertEquals(2, parsed.size); assertEquals("1234.5", parsed[0]["total"])
    }
}

class TabularParserTest {
    @Test fun `csv handles quotes semicolons and accents in headers`() {
        val rows = TabularParser.parseCsv("﻿Nombre;Precio;Código de barras\n\"Lub; Seda\";180;750123\nVela;99;\n")
        assertEquals(2, rows.size)
        assertEquals("Lub; Seda", rows[0]["nombre"]); assertEquals("180", rows[0]["precio"]); assertEquals("750123", rows[0]["codigo_de_barras"]); assertEquals("", rows[1]["codigo_de_barras"])
    }
}

class DbErrorTranslationTest {
    @Test fun `business codes map to friendly spanish messages`() {
        val m = Db::class.java.getDeclaredMethod("translate", io.github.jan.supabase.exceptions.RestException::class.java).apply { isAccessible = true }
        val db = dummyDb()
        fun t(msg: String): ErpException = m.invoke(db, io.github.jan.supabase.postgrest.exception.PostgrestRestException(msg, null, null, null, io.mockk.mockk(relaxed = true))) as ErpException
        assertEquals(HttpStatusCode.Conflict, t("STOCK_INSUFICIENTE").status)
        assertEquals("DESCUENTO_EXCEDE_LIMITE", t("DESCUENTO_EXCEDE_LIMITE: tu rol permite hasta 5 %").let { it.code; "DESCUENTO_EXCEDE_LIMITE" })
        assertEquals(HttpStatusCode.Forbidden, t("DESCUENTO_EXCEDE_LIMITE: tu rol permite hasta 5 %").status)
        assertEquals("Tu rol permite hasta 5 %", t("DESCUENTO_EXCEDE_LIMITE: tu rol permite hasta 5 %").message)
        assertEquals(HttpStatusCode.Conflict, t("duplicate key value violates unique constraint 23505").status)
        assertEquals(HttpStatusCode.Forbidden, t("IMMUTABLE_ROW: audit_logs no admite UPDATE").status)
        assertEquals(HttpStatusCode.InternalServerError, t("something weird").status)
    }
}

fun fakeCtx(perms: Set<String>, maxDiscount: Double? = null, roles: List<String> = listOf("SALES")) = AuthContext(
    userId = "u1", organizationId = "o1", firstName = "Ana", lastName = "Prueba", email = "ana@test", username = "ana", status = "ACTIVE", defaultBranchId = "b1",
    roles = roles.map { RoleRef("r-$it", it, it) }, permissions = perms, branches = listOf(BranchRef("b1", "GYM", "Guaymas")), maxDiscountPct = maxDiscount,
    organization = jsonOf("id" to "o1", "timezone" to "America/Hermosillo"), raw = jsonOf("user" to jsonOf("id" to "u1")),
)

class ReadableExportAndValidationTest {
    @Test fun csvTranslatesCodesAndDates() {
        val csv = String(Exporter.csv(
            listOf(ExportColumn("status", "Estado"), ExportColumn("sold_at", "Fecha"), ExportColumn("bucket", "Día"), ExportColumn("folio", "Folio")),
            listOf(jsonOf("status" to "COMPLETED", "sold_at" to "2026-10-13T03:14:54+00:00", "bucket" to "2026-09-13T00:00:00", "folio" to "SON-2026-000001")),
        ), Charsets.UTF_8)
        assertTrue(csv.contains("Completada"), csv)
        assertTrue(csv.contains("2026-10-12 20:14"), "la hora se expresa en la zona de la tienda: $csv")
        assertTrue(csv.contains("2026-09-13,"), "un corte por día no cambia de fecha: $csv")
        assertTrue(csv.contains("SON-2026-000001"), "los folios no se traducen: $csv")
    }

    @Test fun validationAgreesInGender() {
        val e = assertFailsWith<ErpException> { validate { notBlank(null, "category_id", "La categoría") } }
        assertEquals("La categoría es obligatoria.", e.message)
        val e2 = assertFailsWith<ErpException> { validate { notBlank("", "name", "El nombre") } }
        assertEquals("El nombre es obligatorio.", e2.message)
    }
}
