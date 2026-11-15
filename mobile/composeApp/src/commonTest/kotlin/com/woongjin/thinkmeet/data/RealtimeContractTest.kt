package com.woongjin.thinkmeet.data

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertFalse

/** Only protocol/state invariants that can silently break live classroom synchronization. */
class RealtimeContractTest {
    @Test
    fun socketIoEventEscapesChatAndPreservesAckId() {
        val payload = buildJsonObject { put("text", "한글 \"채팅\"\n다음 줄") }
        val wire = SocketIoCodec.event("command", payload, 123)
        assertEquals("42123", wire.take(5))
        val decoded = assertIs<SocketIoCodec.Packet.Event>(SocketIoCodec.decode(wire))
        assertEquals("command", decoded.name)
        assertEquals(payload, decoded.payload)
        val ack = assertIs<SocketIoCodec.Packet.Ack>(SocketIoCodec.decode("43123[{\"ok\":true}]"))
        assertEquals(123L, ack.id)
        assertEquals("true", ack.arguments.single().jsonObject.getValue("ok").jsonPrimitive.content)
        assertEquals(SocketIoCodec.Packet.Ping("probe"), SocketIoCodec.decode("2probe"))
        assertFails { SocketIoCodec.decode("43[{\"ok\":true}]") }
    }

    @Test
    fun oldOrForeignSnapshotsCannotRollbackRoomState() {
        val current = snapshot(12)
        assertSame(current, newerSnapshot(current, snapshot(11), "lesson"))
        assertSame(current, newerSnapshot(current, snapshot(13).copy(lessonId = "other"), "lesson"))
        assertEquals(13L, newerSnapshot(current, snapshot(13), "lesson")?.seq)
        assertNull(newerSnapshot(null, snapshot(1).copy(lessonId = "other"), "lesson"))
    }

    @Test
    fun lessonWithoutScheduledEndSendsExplicitNull() {
        val input = LessonInput("수업", startsAt = "2027-01-01T07:00:00Z", endsAt = null, accessMode = "OPEN")
        val json = ThinkMeetJson.parseToJsonElement(ThinkMeetJson.encodeToString(input)).jsonObject
        assertEquals("null", json.getValue("endsAt").toString())
        assertEquals(JsonPrimitive("OPEN"), json["accessMode"])
    }

    @Test
    fun generatedSocketEnvelopeKeepsExistingPayloadAndOmitsAbsentRequestId() {
        val payload = buildJsonObject { put("text", "한글 채팅"); put("clientId", "client-1") }
        val envelope = ThinkMeetJson.encodeToJsonElement(CommandEnvelope("lesson", "chat.send", payload)).jsonObject
        assertFalse("requestId" in envelope)
        val packet = assertIs<SocketIoCodec.Packet.Event>(SocketIoCodec.decode(SocketIoCodec.event(ContractProtocol.Events.Command, envelope, 42)))
        assertEquals(ContractProtocol.Events.Command, packet.name)
        assertEquals(payload, packet.payload?.jsonObject?.get("payload"))
        assertEquals(JsonPrimitive("lesson"), ThinkMeetJson.encodeToJsonElement(SubscribeInput("lesson")).jsonObject["lessonId"])
    }

    private fun snapshot(sequence: Long): MeetingSnapshot {
        val teacher = User("teacher", "teacher1", "선생님", "teacher")
        val lesson = Lesson("lesson", "수업", teacher = teacher, startsAt = "2027-01-01T07:00:00Z", status = "LIVE", code = "abc")
        return MeetingSnapshot("lesson", lesson, seq = sequence, serverTime = "2027-01-01T07:00:00Z")
    }
}
