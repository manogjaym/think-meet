package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.data.*
import com.woongjin.thinkmeet.platform.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class RemoteAssistanceLifecycleTest {
    @Test
    fun explicitApprovalOrdersPermissionCaptureServerActivationAndPip() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val fixture = Fixture(backgroundScope)
        try {
            runCurrent()
            assertEquals(0, fixture.remote.starts)
            assertTrue(fixture.events.isEmpty(), "A pending request alone must not request OS permission or capture")

            fixture.controller.approve(SessionId)
            runCurrent()

            assertEquals(listOf("pip:disable", "permission", "assistance.respond", "capture", "assistance.start", "pip:enable:teacher", "pip:enter"), fixture.events)
            assertEquals(1, fixture.remote.starts)
            assertTrue(fixture.remote.state.value.capturing)
            assertEquals("active", fixture.link.snapshot.value?.assistance?.status)
            assertTrue(fixture.pip.state.value.active)
            assertFalse(fixture.controller.busy.value)
            assertTrue(fixture.errors.isEmpty())
        } finally {
            fixture.releaseAndClose()
            runCurrent()
            Dispatchers.resetMain()
        }
    }

    @Test
    fun blockedGeometryAckDoesNotDelayFeatureOffOrTeacherStopCleanup() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            for (termination in listOf("feature-off", "teacher-stop")) {
                val fixture = Fixture(backgroundScope)
                try {
                    runCurrent()
                    fixture.controller.approve(SessionId)
                    runCurrent()
                    assertTrue(fixture.remote.state.value.capturing)

                    val ack = CompletableDeferred<Unit>()
                    fixture.link.geometryAck = ack
                    fixture.remote.mutable.value = fixture.remote.mutable.value.copy(geometry = Geometry.copy(rotation = 180, version = 2))
                    runCurrent()
                    assertTrue(fixture.link.geometryStarted.isCompleted)
                    assertFalse(ack.isCompleted, "The geometry request must still be awaiting its ACK")

                    if (termination == "feature-off") fixture.link.capabilities.value = testCapabilities(remoteEnabled = false)
                    else fixture.link.snapshot.value = fixture.link.snapshot.value!!.copy(assistance = null, share = null, seq = 3)
                    runCurrent()

                    assertFalse(fixture.remote.state.value.capturing, "$termination must stop capture before the ACK arrives")
                    assertEquals(1, fixture.remote.stops, termination)
                    assertTrue(fixture.link.geometryCancelled, "$termination must cancel the obsolete geometry request")
                    assertFalse(ack.isCompleted, "Cleanup must not require resolving the stalled ACK")
                    assertNull(fixture.link.snapshot.value?.assistance)

                    ack.complete(Unit)
                    runCurrent()
                    assertFalse(fixture.remote.state.value.capturing)
                    assertEquals(1, fixture.remote.starts, "A late ACK must not restart capture")
                    assertTrue(fixture.errors.isEmpty())
                } finally {
                    fixture.releaseAndClose()
                    runCurrent()
                }
            }
        } finally { Dispatchers.resetMain() }
    }

    @Test
    fun cancellationDuringOsPermissionDialogRejectsItsLateResult() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val permission = CompletableDeferred<Unit>()
        val fixture = Fixture(backgroundScope, permission)
        try {
            runCurrent()
            fixture.controller.approve(SessionId)
            runCurrent()
            assertTrue(fixture.remote.permissionStarted.isCompleted)
            assertEquals(0, fixture.remote.starts)

            // The native settings dialog can return after the teacher has cancelled the request.
            fixture.link.snapshot.value = fixture.link.snapshot.value!!.copy(assistance = null, seq = 1)
            runCurrent()
            assertFalse(fixture.remote.state.value.capturing)
            assertFalse(permission.isCompleted)

            permission.complete(Unit)
            runCurrent()

            assertEquals(0, fixture.remote.starts)
            assertFalse("assistance.respond" in fixture.events)
            assertFalse("assistance.start" in fixture.events)
            assertFalse("pip:enter" in fixture.events)
            assertFalse(fixture.controller.busy.value)
            assertNull(fixture.link.snapshot.value?.assistance)
        } finally {
            fixture.releaseAndClose()
            runCurrent()
            Dispatchers.resetMain()
        }
    }

    private class Fixture(scope: CoroutineScope, permission: CompletableDeferred<Unit>? = null) {
        val events = mutableListOf<String>()
        val errors = mutableListOf<Throwable>()
        val link = FakeLink(events)
        val remote = FakeRemote(events, permission)
        val pip = FakePip(events)
        val controller = RemoteAssistanceSession(link, remote, pip, "student", scope) { errors += it }

        fun releaseAndClose() {
            remote.permission?.complete(Unit)
            link.geometryAck?.complete(Unit)
            controller.close()
        }
    }

    private class FakeLink(private val events: MutableList<String>) : AssistanceTransport {
        override val snapshot = MutableStateFlow<MeetingSnapshot?>(PendingSnapshot)
        override val connected = MutableStateFlow(true)
        override val capabilities = MutableStateFlow(testCapabilities())
        override val pointers = MutableSharedFlow<AssistancePointer>()
        var geometryAck: CompletableDeferred<Unit>? = null
        val geometryStarted = CompletableDeferred<Unit>()
        var geometryCancelled = false

        override suspend fun command(type: String, payload: JsonObject): MeetingSnapshot {
            events += type
            val current = snapshot.value ?: error("Missing fixture snapshot")
            val id = payload.getValue("sessionId").jsonPrimitive.content
            val next = when (type) {
                "assistance.respond" -> {
                    check(id == current.assistance?.id && payload.getValue("approved").jsonPrimitive.boolean)
                    current.copy(assistance = current.assistance!!.copy(status = "approved", expiresAt = null), seq = current.seq + 1)
                }
                "assistance.start" -> {
                    check(id == current.assistance?.id && current.assistance?.status == "approved")
                    val geometry = ThinkMeetJson.decodeFromJsonElement<AssistanceGeometry>(payload.getValue("geometry"))
                    current.copy(assistance = current.assistance!!.copy(status = "active", shareId = "share", geometry = geometry),
                        share = Share("share", "screen", "student", updatedAt = current.serverTime, assistanceId = id), seq = current.seq + 1)
                }
                "assistance.geometry" -> {
                    geometryStarted.complete(Unit)
                    try { geometryAck?.await() }
                    catch (error: CancellationException) { geometryCancelled = true; throw error }
                    val latest = snapshot.value ?: error("Missing fixture snapshot")
                    val geometry = ThinkMeetJson.decodeFromJsonElement<AssistanceGeometry>(payload.getValue("geometry"))
                    if (latest.assistance?.id == id) latest.copy(assistance = latest.assistance!!.copy(geometry = geometry), seq = latest.seq + 1) else latest
                }
                "assistance.stop" -> if (current.assistance?.id == id) current.copy(assistance = null, share = null, seq = current.seq + 1) else current
                else -> error("Unexpected fixture command: $type")
            }
            snapshot.value = next
            return next
        }
    }

    private class FakeRemote(private val events: MutableList<String>, val permission: CompletableDeferred<Unit>?) : RemoteAssistanceController {
        val mutable = MutableStateFlow(RemoteAssistanceState(supported = true))
        override val state = mutable.asStateFlow()
        val permissionStarted = CompletableDeferred<Unit>()
        var starts = 0
        var stops = 0

        override suspend fun ensureOverlayPermission() {
            events += "permission"
            permissionStarted.complete(Unit)
            // Model an OS dialog delivering its callback despite cancellation of the app's waiter.
            withContext(NonCancellable) { permission?.await(); mutable.value = mutable.value.copy(overlayAllowed = true) }
        }
        override suspend fun startScreenShare(): AssistanceGeometry {
            events += "capture"
            starts++
            check(mutable.value.overlayAllowed)
            mutable.value = mutable.value.copy(capturing = true, geometry = Geometry)
            return Geometry
        }
        override suspend fun stopScreenShare() {
            events += "capture:stop"
            stops++
            mutable.value = mutable.value.copy(capturing = false, geometry = null)
        }
        override fun showPointer(pointer: AssistancePointer) = Unit
        override fun clearPointer() = Unit
        override fun close() { mutable.value = mutable.value.copy(capturing = false, geometry = null) }
    }

    private class FakePip(private val events: MutableList<String>) : PictureInPictureController {
        private val mutable = MutableStateFlow(PictureInPictureState(supported = true))
        override val state = mutable.asStateFlow()
        override fun update(enabled: Boolean, target: PipVideoTarget?) {
            events += if (enabled) "pip:enable:${target?.identity}" else "pip:disable"
        }
        override suspend fun enter() { events += "pip:enter"; mutable.value = mutable.value.copy(active = true) }
        override fun close() { mutable.value = mutable.value.copy(active = false) }
    }

    private companion object {
        const val SessionId = "session"
        val Geometry = AssistanceGeometry(1080, 2400, 0, 1)
        val Teacher = User("teacher", "teacher", "선생님", "teacher")
        val FixtureLesson = Lesson("lesson", "수업", teacher = Teacher, startsAt = "2026-11-17T00:00:00Z", status = "LIVE", code = "fixture")
        val PendingSnapshot = MeetingSnapshot(FixtureLesson.id, FixtureLesson, serverTime = FixtureLesson.startsAt,
            assistance = AssistanceSession(SessionId, Teacher.id, "student", "pending", "2099-01-01T00:00:00Z"))

        fun testCapabilities(remoteEnabled: Boolean = true) = FeatureCapabilities(
            contractRevision = ContractProtocol.Revision, source = CapabilitySource.Server,
            enabledFeatures = if (remoteEnabled) setOf(ContractProtocol.FeatureIds.MeetingRemoteAssistance, ContractProtocol.FeatureIds.MeetingPip) else setOf(ContractProtocol.FeatureIds.MeetingPip),
            baselineFeatures = emptySet(),
        )
    }
}
