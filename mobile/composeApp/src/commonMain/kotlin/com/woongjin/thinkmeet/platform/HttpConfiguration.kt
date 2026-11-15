package com.woongjin.thinkmeet.platform

import com.woongjin.thinkmeet.data.ThinkMeetJson
import io.ktor.client.HttpClientConfig
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.cookies.CookiesStorage
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.http.Cookie
import io.ktor.http.Url
import io.ktor.serialization.kotlinx.json.json
import kotlin.time.Clock

internal val PlatformJson = ThinkMeetJson
internal fun HttpClientConfig<*>.configureThinkMeet() {
    install(ContentNegotiation) { json(PlatformJson) }
    install(WebSockets)
    install(HttpTimeout) { requestTimeoutMillis = 30_000; connectTimeoutMillis = 15_000; socketTimeoutMillis = 60_000 }
    install(HttpCookies) { storage = SessionCookieStorage() }
}

/** Only the first-party session cookie is persisted, in each platform's protected storage. */
internal class SessionCookieStorage : CookiesStorage {
    private fun key(url: Url) = "session:https://${url.host}:${url.port}"
    override suspend fun get(requestUrl: Url): List<Cookie> {
        if (requestUrl.protocol.name !in listOf("https", "wss")) return emptyList()
        val value = readPreference(key(requestUrl)).split('|', limit = 2)
        if (value.size != 2 || (value[0].toLongOrNull() ?: 0) <= Clock.System.now().toEpochMilliseconds()) return emptyList()
        return listOf(Cookie("think_meet_session", value[1], domain = requestUrl.host, path = "/", secure = true, httpOnly = true))
    }
    override suspend fun addCookie(requestUrl: Url, cookie: Cookie) {
        if (cookie.name != "think_meet_session" || requestUrl.protocol.name !in listOf("https", "wss")) return
        // Cookie access for WebSocket upgrades uses the HTTPS origin's same key.
        val normalized = Url(requestUrl.toString().replaceFirst("wss://", "https://"))
        val expires = cookie.expires?.timestamp ?: (Clock.System.now().toEpochMilliseconds() + (cookie.maxAge ?: 43_200) * 1000L)
        val stored = if (cookie.value.isEmpty() || expires <= Clock.System.now().toEpochMilliseconds()) "" else "$expires|${cookie.value}"
        writePreference(key(normalized), stored)
    }
    override fun close() = Unit
}
