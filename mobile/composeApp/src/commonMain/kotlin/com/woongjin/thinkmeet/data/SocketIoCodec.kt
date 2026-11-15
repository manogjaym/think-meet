package com.woongjin.thinkmeet.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.jsonArray

/** The server uses only Socket.IO's default namespace and JSON events. */
internal object SocketIoCodec {
    sealed interface Packet {
        data class Open(val data: JsonElement) : Packet
        data object Connected : Packet
        data class Ping(val data: String) : Packet
        data class Ack(val id: Long, val arguments: JsonArray) : Packet
        data class Event(val name: String, val payload: JsonElement?) : Packet
        data object Closed : Packet
        data object Ignore : Packet
    }

    fun event(name: String, payload: JsonElement, ackId: Long? = null): String =
        "42${ackId ?: ""}${buildJsonArray { add(JsonPrimitive(name)); add(payload) }}"

    fun decode(raw: String): Packet = when {
        raw.startsWith("0") -> Packet.Open(ThinkMeetJson.parseToJsonElement(raw.drop(1)))
        raw == "1" || raw.startsWith("41") -> Packet.Closed
        raw.startsWith("2") -> Packet.Ping(raw.drop(1))
        raw == "40" || raw.startsWith("40{") -> Packet.Connected
        raw.startsWith("43") -> {
            val start = raw.indexOf('[')
            require(start > 2) { "Missing acknowledgement ID" }
            Packet.Ack(raw.substring(2, start).toLong(), ThinkMeetJson.parseToJsonElement(raw.substring(start)).jsonArray)
        }
        raw.startsWith("42") -> {
            val start = raw.indexOf('[')
            require(start >= 2) { "Missing event data" }
            val parts = ThinkMeetJson.parseToJsonElement(raw.substring(start)).jsonArray
            Packet.Event((parts.first() as JsonPrimitive).content, parts.getOrNull(1))
        }
        else -> Packet.Ignore
    }
}

internal fun newerSnapshot(current: MeetingSnapshot?, incoming: MeetingSnapshot, lessonId: String?): MeetingSnapshot? = when {
    lessonId != null && incoming.lessonId != lessonId -> current
    current != null && current.lessonId == incoming.lessonId && incoming.seq < current.seq -> current
    else -> incoming
}
