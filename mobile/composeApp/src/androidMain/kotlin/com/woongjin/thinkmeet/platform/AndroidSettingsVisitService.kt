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

/**
 * Keeps the class connection reachable while the student is in a full-screen system Settings page.
 * Android 15 cuts a background app's network a few seconds after it leaves the screen (and 14+ freezes it),
 * which dropped the realtime socket and so ended the teacher's pending mirroring request.
 * A short service (API 34+, at most about 3 minutes) keeps the process in the foreground state; older
 * versions do not restrict a recently backgrounded app this way, so nothing is started there.
 */
internal class AndroidSettingsVisitService : Service() {
    override fun onCreate() {
        super.onCreate()
        try {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "수업 연결 유지", NotificationManager.IMPORTANCE_LOW),
            )
            val notification = NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("수업 연결 유지 중")
                .setContentText("설정을 마치고 앱으로 돌아오면 수업이 이어져요.")
                .setOngoing(true)
                .setSilent(true)
                .build()
            ServiceCompat.startForeground(this, NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
        } catch (_: Exception) {
            stopSelf()
        }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
    // A short service must stop itself when its time is up, or the OS treats the app as unresponsive.
    override fun onTimeout(startId: Int) { stopSelf() }
    override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }

    companion object {
        private const val CHANNEL = "thinkmeet-settings-visit"
        private const val NOTIFICATION = 7282

        /** Call while the app is still in the foreground, right before opening the Settings page. */
        fun start(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
            runCatching { ContextCompat.startForegroundService(context, Intent(context, AndroidSettingsVisitService::class.java)) }
        }
        fun stop(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
            context.stopService(Intent(context, AndroidSettingsVisitService::class.java))
        }
    }
}
