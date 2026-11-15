package com.woongjin.thinkmeet

import android.content.Intent
import android.os.Bundle
import android.app.PictureInPictureUiState
import android.content.res.Configuration
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.woongjin.thinkmeet.platform.AndroidPlatform
import com.woongjin.thinkmeet.platform.AppLinks
import com.woongjin.thinkmeet.platform.AndroidPictureInPictureController

class MainActivity : ComponentActivity() {
    internal var pictureInPictureController: AndroidPictureInPictureController? = null
        private set
    private var finishOnPipEntry = false
    private var terminalPipGeneration = 0

    internal fun attachPictureInPictureController(controller: AndroidPictureInPictureController) {
        if (pictureInPictureController === controller) return
        pictureInPictureController?.close()
        finishOnPipEntry = false
        terminalPipGeneration++
        pictureInPictureController = controller
    }
    internal fun detachPictureInPictureController(controller: AndroidPictureInPictureController) {
        if (pictureInPictureController === controller) pictureInPictureController = null
    }
    internal fun dismissTerminalPictureInPicture(entering: Boolean) {
        if (isFinishing || isDestroyed || isChangingConfigurations) return
        if (isInPictureInPictureMode) {
            finishOnPipEntry = false
            finishAndRemoveTask()
        } else if (entering) {
            // Auto/manual entry may already be animating. Never finish an ordinary full-screen task.
            finishOnPipEntry = true
            val generation = ++terminalPipGeneration
            window.decorView.postDelayed({
                if (terminalPipGeneration == generation) finishOnPipEntry = false
            }, 3_000)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AndroidPlatform.context = applicationContext
        intent?.dataString?.let(AppLinks::receive)
        enableEdgeToEdge()
        setContent { App() }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.dataString?.let(AppLinks::receive)
    }
    override fun onResume() {
        super.onResume()
        if (!isInPictureInPictureMode) {
            finishOnPipEntry = false
            terminalPipGeneration++
        }
        pictureInPictureController?.onResume()
    }
    override fun onStart() {
        super.onStart()
        pictureInPictureController?.onStart()
    }
    override fun onPause() {
        pictureInPictureController?.onPause()
        super.onPause()
    }
    override fun onStop() {
        pictureInPictureController?.onStop()
        super.onStop()
    }
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        pictureInPictureController?.onUserLeaveHint()
    }
    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (isInPictureInPictureMode && finishOnPipEntry) {
            finishOnPipEntry = false
            if (!isFinishing && !isChangingConfigurations) finishAndRemoveTask()
            return
        }
        pictureInPictureController?.onModeChanged(isInPictureInPictureMode)
    }
    override fun onPictureInPictureUiStateChanged(pipState: PictureInPictureUiState) {
        super.onPictureInPictureUiStateChanged(pipState)
        if (Build.VERSION.SDK_INT >= 35 && pipState.isTransitioningToPip) pictureInPictureController?.onTransitionStarted()
    }
    override fun onDestroy() {
        pictureInPictureController?.onActivityDestroyed(isChangingConfigurations)
        super.onDestroy()
    }
}
