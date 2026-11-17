package com.woongjin.thinkmeet

import android.os.Bundle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.woongjin.thinkmeet.config.ServerConfig
import com.woongjin.thinkmeet.data.ContractProtocol
import com.woongjin.thinkmeet.platform.createHttpClient
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/** Read-only HTTPS probe through the app's real Android TLS and cookie configuration. */
@RunWith(AndroidJUnit4::class)
class ServerConnectionSmokeTest {
    @Test
    fun configuredServerAcceptsVerifiedHttpsAndAuthenticationRequests() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val client = createHttpClient()
        try {
            runBlocking {
                val health = client.get("${ServerConfig.ORIGIN}${ContractProtocol.ApiBasePath}/health")
                assertEquals(HttpStatusCode.OK, health.status)
                val me = client.get("${ServerConfig.ORIGIN}${ContractProtocol.ApiBasePath}/auth/me")
                check(me.status in listOf(HttpStatusCode.OK, HttpStatusCode.Unauthorized)) {
                    "Unexpected authentication response: ${me.status}"
                }
                InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
                    putString("serverOrigin", ServerConfig.ORIGIN)
                    putInt("healthStatus", health.status.value)
                    putInt("authStatus", me.status.value)
                })
            }
        } finally {
            client.close()
            scenario.close()
        }
    }
}
