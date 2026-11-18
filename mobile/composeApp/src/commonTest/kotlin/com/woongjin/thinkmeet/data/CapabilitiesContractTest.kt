package com.woongjin.thinkmeet.data

import com.woongjin.thinkmeet.platform.clientPlatformId
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.HttpTimeout
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource

class CapabilitiesContractTest {
    private val jsonHeaders = headersOf("Content-Type", "application/json")
    private val core = ContractProtocol.FeatureIds.ClassroomCore
    private val pip = ContractProtocol.FeatureIds.MeetingPip

    @Test
    fun implementedRemoteAssistanceRequiresCompatibleServerSupport() {
        val feature = ContractProtocol.FeatureIds.MeetingRemoteAssistance
        for (platform in listOf("android", "ios")) {
            val response = CapabilitiesResponse(ContractProtocol.Revision, mapOf(feature to true))
            assertTrue(FeatureCapabilities.fromServer(response, platform).supports(feature))
            assertFalse(FeatureCapabilities.fromServer(response.copy(contractRevision = 3), platform).supports(feature))
            assertFalse(FeatureCapabilities.fromServer(response.copy(features = mapOf(feature to false)), platform).supports(feature))
        }
    }

    @Test
    fun olderServerUsesOnlyPlatformBaselineAndSendsNegotiationHeaders() = runTest {
        val client = HttpClient(MockEngine { request ->
            assertEquals("/api/v1/capabilities", request.url.encodedPath)
            assertEquals(clientPlatformId(), request.headers[ContractProtocol.PlatformHeader])
            assertEquals(ContractProtocol.Revision.toString(), request.headers[ContractProtocol.RevisionHeader])
            respond("{}", HttpStatusCode.NotFound, jsonHeaders)
        }) { install(HttpTimeout) }
        try {
            val api = ThinkMeetApi(client, "https://example.test")
            assertTrue(api.supportsFeature(core))
            assertFalse(api.supportsFeature("future.unknown"))
            assertEquals(CapabilitySource.Baseline, api.refreshCapabilities().source)
            assertTrue(api.supportsFeature(pip))
            assertFalse(api.supportsFeature("future.unknown"))
        } finally { client.close() }
    }

    @Test
    fun serverFlagsGateRealRequestsAndFailureDropsNonBaselineFlags() = runTest {
        var requests = 0
        var capabilityRequests = 0
        val client = HttpClient(MockEngine { request ->
            requests++
            if (request.url.encodedPath == "/api/v1/lessons/lesson/leave") respond("", HttpStatusCode.NoContent)
            else when (++capabilityRequests) {
                1 -> respond("""{"contractRevision":99,"features":{"classroom.core":false,"meeting.pip":false,"future.unknown":true},"futureField":{}}""", headers = jsonHeaders)
                2 -> respond("""{"contractRevision":1,"features":{}}""", headers = jsonHeaders)
                3 -> respond("{}", HttpStatusCode.ServiceUnavailable, jsonHeaders)
                4 -> respond("""{"contractRevision":1,"features":{"meeting.pip":true}}""", headers = jsonHeaders)
                else -> respond("{}", HttpStatusCode.NotFound, jsonHeaders)
            }
        }) { install(HttpTimeout) }
        try {
            val api = ThinkMeetApi(client, "https://example.test")
            assertEquals(CapabilitySource.Server, api.refreshCapabilities().source)
            assertFalse(api.supportsFeature(core))
            assertFalse(api.supportsFeature(pip))
            val expired = api.capabilities.value.copy(expiresAt = TimeSource.Monotonic.markNow() - 1.seconds)
            assertTrue(expired.expired())
            assertFalse(expired.supports(pip))
            assertFalse(expired.supports(core))
            assertEquals("FEATURE_UNAVAILABLE", assertFailsWith<ApiException> { api.requireFeature(pip) }.code)
            assertFalse(api.supportsFeature("future.unknown"))
            assertEquals("FEATURE_UNAVAILABLE", assertFailsWith<ApiException> { api.lessons() }.code)
            assertEquals("FEATURE_UNAVAILABLE", assertFailsWith<ApiException> { api.requireEvent(ContractProtocol.Events.Command, "chat.send") }.code)
            assertEquals("UNSUPPORTED_OPERATION", assertFailsWith<ApiException> { api.response("/unknown-future-route") }.code)
            assertEquals("UNSUPPORTED_EVENT", assertFailsWith<ApiException> { api.requireEvent(ContractProtocol.Events.Command, "unknown.command") }.code)
            assertEquals(1, requests)
            // Disabling classroom features must not trap an existing room's cleanup.
            api.leave("lesson")
            api.requireEvent(ContractProtocol.Events.Command, "share.stop")
            assertEquals(2, requests)
            assertEquals(CapabilitySource.Server, api.refreshCapabilities().source)
            assertFalse(api.supportsFeature(core))
            assertFalse(api.supportsFeature(pip))
            val omittedAndExpired = api.capabilities.value.copy(expiresAt = TimeSource.Monotonic.markNow() - 1.seconds)
            assertFalse(omittedAndExpired.supports(core))
            assertFalse(omittedAndExpired.supports(pip))
            assertEquals(CapabilitySource.Unavailable, api.refreshCapabilities().source)
            assertFalse(api.supportsFeature(pip))
            assertFalse(api.supportsFeature(core))
            assertFalse(api.supportsFeature("future.unknown"))
            assertEquals(CapabilitySource.Server, api.refreshCapabilities().source)
            assertFalse(api.supportsFeature(core))
            assertTrue(api.supportsFeature(pip))
            val explicitlyEnabledAndExpired = api.capabilities.value.copy(expiresAt = TimeSource.Monotonic.markNow() - 1.seconds)
            assertFalse(explicitlyEnabledAndExpired.supports(core))
            assertTrue(explicitlyEnabledAndExpired.supports(pip))
            assertEquals(CapabilitySource.Baseline, api.refreshCapabilities().source)
            assertTrue(api.supportsFeature(core))
            assertTrue(api.supportsFeature(pip))
            assertFalse(api.supportsFeature("future.unknown"))
        } finally { client.close() }
    }

    @Test
    fun cancellingCapabilityFetchPropagatesAndPreservesLastCompletedState() = runTest {
        var cancel = false
        val client = HttpClient(MockEngine {
            if (cancel) throw CancellationException("cancelled")
            respond("""{"contractRevision":1,"features":{"classroom.core":false}}""", headers = jsonHeaders)
        }) { install(HttpTimeout) }
        try {
            val api = ThinkMeetApi(client, "https://example.test")
            api.refreshCapabilities()
            cancel = true
            assertFailsWith<CancellationException> { api.refreshCapabilities() }
            assertEquals(CapabilitySource.Server, api.capabilities.value.source)
            assertFalse(api.supportsFeature(core))
        } finally { client.close() }
    }

    @Test
    fun generatedOperationAndDtosKeepHttpMethodsEncodingAndExplicitEndNull() = runTest {
        val teacher = User("teacher", "teacher1", "교사", "teacher")
        val lesson = Lesson("room/a b", "수업", teacher = teacher, startsAt = "2027-01-01T07:00:00Z", status = "SCHEDULED", code = "abc")
        val input = LessonInput("수업", startsAt = lesson.startsAt, endsAt = null)
        val methods = mutableListOf<HttpMethod>()
        val client = HttpClient(MockEngine { request ->
            methods += request.method
            assertEquals(clientPlatformId(), request.headers[ContractProtocol.PlatformHeader])
            when (request.url.encodedPath) {
                "/api/v1/auth/login" -> {
                    assertEquals(LoginInput("teacher1", "password"), ThinkMeetJson.decodeFromString<LoginInput>(assertIs<TextContent>(request.body).text))
                    respond(ThinkMeetJson.encodeToString(teacher), headers = jsonHeaders)
                }
                "/api/v1/lessons/room%2Fa%20b" -> {
                    if (request.method == HttpMethod.Patch)
                        assertEquals(input, ThinkMeetJson.decodeFromString<LessonInput>(assertIs<TextContent>(request.body).text))
                    // A newer server can add fields without breaking the installed app.
                    respond(ThinkMeetJson.encodeToString(lesson).dropLast(1) + ",\"futureField\":true}", headers = jsonHeaders)
                }
                else -> error("Unexpected route: ${request.url}")
            }
        }) { install(HttpTimeout) }
        try {
            val api = ThinkMeetApi(client, "https://example.test")
            api.login(" teacher1 ", "password")
            assertEquals(lesson, api.lesson(lesson.id))
            assertEquals(lesson, api.saveLesson(input, lesson.id))
            assertEquals(listOf(HttpMethod.Post, HttpMethod.Get, HttpMethod.Patch), methods)
        } finally { client.close() }
    }
}
