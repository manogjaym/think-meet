package com.woongjin.thinkmeet

import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.woongjin.thinkmeet.data.CapabilitySource
import com.woongjin.thinkmeet.data.ContractProtocol
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.platform.createHttpClient
import com.woongjin.thinkmeet.platform.configureThinkMeet
import com.woongjin.thinkmeet.platform.readPreference
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.http.Url
import io.ktor.http.URLProtocol
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import okhttp3.Dns
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress
import javax.net.SocketFactory

/** Uses the existing teacher1 session; all server requests are read-only. */
@RunWith(AndroidJUnit4::class)
class ContractCompatibilitySmokeTest {
    @Test
    fun currentSessionDecodesGeneratedModelsAndNegotiatesCapabilities() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val origin = readPreference("server.origin", "https://192.168.0.64")
        val routeAddress = InstrumentationRegistry.getArguments().getString("contractRouteAddress")?.takeIf { it.isNotBlank() }
        val client = smokeClient(origin, routeAddress)
        try {
            val api = ThinkMeetApi(client, origin)
            runBlocking {
                withTimeout(45_000) {
                    val user = api.me()
                    assertEquals("teacher1", user.username)
                    assertTrue(user.isTeacher)
                    val capability = api.refreshCapabilities()
                    assertTrue(capability.source == CapabilitySource.Server || capability.source == CapabilitySource.Baseline)
                    assertTrue(api.supportsFeature(ContractProtocol.FeatureIds.ClassroomCore))
                    assertFalse(api.supportsFeature("future.unknown"))
                    val lessons = api.lessons()
                    instrumentation.sendStatus(0, Bundle().apply {
                        putString("capabilitySource", capability.source.name)
                        putInt("contractRevision", ContractProtocol.Revision)
                        putInt("lessonsDecoded", lessons.size)
                        putBoolean("routedTestTransport", routeAddress != null)
                    })
                }
            }
            // A routed API client does not alter the production UI's transport or saved origin.
            if (routeAddress != null) return
            val device = UiDevice.getInstance(instrumentation)
            val selector = By.text(DesignContent.ScheduleTitle)
            var heading = device.wait(Until.findObject(selector), 15_000)
            val deadline = SystemClock.uptimeMillis() + 15_000
            while (heading == null && SystemClock.uptimeMillis() < deadline) {
                device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4,
                    device.displayWidth / 2, device.displayHeight / 3, 15)
                heading = device.wait(Until.findObject(selector), 1_000)
            }
            assertNotNull("The authenticated dashboard should show the lesson schedule.", heading)
        } finally {
            client.close()
            scenario.close()
        }
    }

    private fun smokeClient(origin: String, routeAddress: String?): HttpClient {
        if (routeAddress == null) return createHttpClient()
        val url = Url(origin)
        require(url.protocol == URLProtocol.HTTPS) { "Contract routing preserves an existing HTTPS origin." }
        val target = InetAddress.getByName(routeAddress)
        val dns = object : Dns {
            override fun lookup(hostname: String): List<InetAddress> =
                if (hostname.equals(url.host, ignoreCase = true)) listOf(InetAddress.getByAddress(hostname, target.address))
                else Dns.SYSTEM.lookup(hostname)
        }
        return HttpClient(OkHttp) {
            configureThinkMeet()
            engine {
                config {
                    dns(dns)
                    socketFactory(HostRoutingSocketFactory(url.host, target))
                }
            }
        }
    }
}

/** TCP routing only: HTTP URL, cookie origin, TLS trust and hostname verification are unchanged. */
private class HostRoutingSocketFactory(private val originalHost: String, private val target: InetAddress) : SocketFactory() {
    override fun createSocket(): Socket = object : Socket() {
        override fun connect(endpoint: SocketAddress?) = connect(endpoint, 0)
        override fun connect(endpoint: SocketAddress?, timeout: Int) {
            val address = endpoint as? InetSocketAddress
            // OkHttp bypasses its Dns implementation for IP-literal URL hosts.
            val routed = if (address != null && (address.hostString.equals(originalHost, ignoreCase = true) || address.address?.hostAddress == originalHost))
                InetSocketAddress(target, address.port) else endpoint
            super.connect(routed, timeout)
        }
    }
    override fun createSocket(host: String, port: Int): Socket = createSocket().apply { connect(address(host, port)) }
    override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
        createSocket().apply { bind(InetSocketAddress(localHost, localPort)); connect(address(host, port)) }
    override fun createSocket(host: InetAddress, port: Int): Socket = createSocket().apply { connect(InetSocketAddress(host, port)) }
    override fun createSocket(host: InetAddress, port: Int, localHost: InetAddress, localPort: Int): Socket =
        createSocket().apply { bind(InetSocketAddress(localHost, localPort)); connect(InetSocketAddress(host, port)) }
    private fun address(host: String, port: Int) =
        if (host.equals(originalHost, ignoreCase = true)) InetSocketAddress(target, port) else InetSocketAddress(host, port)
}
