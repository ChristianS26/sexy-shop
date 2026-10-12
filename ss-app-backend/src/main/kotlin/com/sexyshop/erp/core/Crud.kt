package com.sexyshop.erp.core

import kotlinx.serialization.json.*

/** Deja solo las llaves permitidas (whitelist) y normaliza cadenas vacías a null. */
fun pick(body: JsonObject, allowed: Collection<String>): JsonObject = JsonObject(
    body.filterKeys { it in allowed }.mapValues { (_, v) ->
        if (v is JsonPrimitive && v.isString && v.content.isBlank()) JsonNull else v
    }
)

fun JsonObject.with(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(this + pairs.associate { it.first to it.second.toJsonElement() })
fun JsonObject.without(vararg keys: String): JsonObject = JsonObject(filterKeys { it !in keys })

fun slugify(s: String): String = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
    .replace(Regex("\\p{M}"), "").lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(80)

fun nowIso(): String = java.time.Instant.now().toString()
