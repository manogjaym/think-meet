package com.woongjin.thinkmeet.data

import kotlinx.serialization.json.Json

/** One codec is shared by HTTP, Socket.IO and persisted session metadata. */
val ThinkMeetJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = true
}

typealias ApiLesson = Lesson

class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)

typealias ApiError = ApiException

/** Encodes a typed command payload with the serializer generated from contracts/realtime.json. */
fun <P> ContractCommand<P>.encode(payload: P): kotlinx.serialization.json.JsonObject =
    ThinkMeetJson.encodeToJsonElement(serializer, payload) as kotlinx.serialization.json.JsonObject
