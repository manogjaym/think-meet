package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import com.woongjin.thinkmeet.data.AssistanceGeometry
import com.woongjin.thinkmeet.data.AssistancePointer
import com.woongjin.thinkmeet.data.Point
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow

data class RemoteAssistanceState(
    val supported: Boolean = false,
    val overlayAllowed: Boolean = false,
    val capturing: Boolean = false,
    /** Null while display rotation and the captured frame have not converged. */
    val geometry: AssistanceGeometry? = null,
    val error: String? = null,
)

/** One teacher stroke in the shared frame's 0~1 coordinates. */
data class RemoteStroke(val tool: String, val color: String, val points: List<Point>)

/** The sharing student's own drawing on the over-other-apps toolbar (meeting.remote-annotation). Points are 0~1. */
sealed interface StudentAnnotationInput {
    data class Preview(val tool: String, val color: String, val points: List<Point>) : StudentAnnotationInput
    data class Stroke(val tool: String, val color: String, val points: List<Point>) : StudentAnnotationInput
    data class Erase(val point: Point) : StudentAnnotationInput
    data object Undo : StudentAnnotationInput
}

/** Displays guidance only; it never sends touch input to another application. */
interface RemoteAssistanceController {
    val state: StateFlow<RemoteAssistanceState>
    /** Android draws the teacher's pointer over other apps and needs PiP; iOS only shares the screen. */
    val showsPointerOverOtherApps: Boolean get() = true
    /** iOS draws the pointer on a copy of the shared screen inside the PiP window instead. */
    val showsPointerInPictureInPicture: Boolean get() = false
    suspend fun ensureOverlayPermission()
    suspend fun startScreenShare(): AssistanceGeometry
    /** Caller verifies the approved session, target student and teacher identity. */
    fun showPointer(pointer: AssistancePointer)
    fun clearPointer()
    /**
     * Replaces the teacher's strokes drawn over other apps (meeting.remote-annotation). Only Android draws them;
     * the caller has already checked the session, page and geometry. An empty list removes them.
     */
    fun showAnnotations(strokes: List<RemoteStroke>) = Unit
    /**
     * Shows the student's own annotation toolbar over other apps while the teacher allows it (Android only).
     * The student cannot close it; it goes away when the caller passes false.
     */
    fun setStudentAnnotation(enabled: Boolean) = Unit
    /** Drawing on the student's own screen while [setStudentAnnotation] is on. Platforms without it never emit. */
    val studentInput: Flow<StudentAnnotationInput> get() = emptyFlow()
    suspend fun stopScreenShare()
    /** One JPEG frame of this device's own approved screen capture, or null when none is available. */
    suspend fun captureScreenFrame(): ByteArray? = null
    fun close()
}

@Composable
expect fun rememberRemoteAssistanceController(media: MediaController): RemoteAssistanceController
