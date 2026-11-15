package com.woongjin.thinkmeet.platform

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout

/** Keeps playback capture alive while the shared app is in front of the classroom. */
internal class AndroidScreenAudioService : Service() {
    override fun onCreate() {
        super.onCreate()
        try {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "수업 화면 소리 공유", NotificationManager.IMPORTANCE_LOW),
            )
            val notification = NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("화면 소리 공유 중")
                .setContentText("이 기기의 허용된 재생 소리를 수업에 전달하고 있어요.")
                .setOngoing(true)
                .setSilent(true)
                .build()
            ServiceCompat.startForeground(this, NOTIFICATION, notification,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
            running = true
            ready?.complete(Unit)
        } catch (error: Exception) {
            ready?.completeExceptionally(error)
            stopSelf()
        }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (running) ready?.complete(Unit)
        return START_NOT_STICKY
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        running = false
        ready?.cancel(); ready = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "thinkmeet-screen-audio"
        private const val NOTIFICATION = 7281
        private var running = false
        private var ready: CompletableDeferred<Unit>? = null

        suspend fun start(context: Context) {
            if (running) return
            val started = CompletableDeferred<Unit>()
            ready = started
            try {
                ContextCompat.startForegroundService(context, Intent(context, AndroidScreenAudioService::class.java))
                withTimeout(5_000) { started.await() }
            } finally { if (ready === started) ready = null }
        }
        fun stop(context: Context) {
            context.stopService(Intent(context, AndroidScreenAudioService::class.java))
        }
    }
}
