@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.woongjin.thinkmeet.meeting

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowColumn
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.woongjin.thinkmeet.data.MeetingParticipant
import com.woongjin.thinkmeet.data.ParticipantControlPayload
import com.woongjin.thinkmeet.design.DesignIcon
import com.woongjin.thinkmeet.design.DesignWeight
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.platform.MediaParticipant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type

/** Everything a video tile needs to show controls; absent when the feature is unavailable. */
@Stable
internal class ParticipantControlState(
    val viewerId: String,
    val teacherId: String,
    /** Annotation permission exists only in lessons that use lesson modes. */
    val lessonModes: Boolean,
    private val participants: List<MeetingParticipant>,
    val control: suspend (ParticipantControlPayload) -> Unit,
    val setMicrophone: suspend (Boolean) -> Unit,
    val setCamera: suspend (Boolean) -> Unit,
    val report: (Throwable) -> Unit,
) {
    fun annotationAllowed(userId: String) = participants.firstOrNull { it.user.id == userId }?.annotationAllowed ?: true
    fun online(userId: String) = participants.any { it.user.id == userId && it.online }
    /** Only the teacher sees tile controls: their own and each student's. Students use the call bar for their own devices. */
    fun visibleFor(userId: String, self: Boolean) = viewerId == teacherId && (self || userId != teacherId)
}

internal val LocalParticipantControls = compositionLocalOf<ParticipantControlState?> { null }

internal fun participantControlsHeight(compact: Boolean): Dp = if (compact) Space.S28 else Space.S36

/** Width of the phone strip's control column beside a tile of [tileHeight]; buttons wrap into a second column when the tile is short. */
internal fun participantControlsColumnWidth(tileHeight: Dp, buttons: Int): Dp {
    val button = participantControlsHeight(true)
    val perColumn = ((tileHeight + Space.S2) / (button + Space.S2)).toInt().coerceAtLeast(1)
    val columns = (buttons + perColumn - 1) / perColumn
    return button * columns + Space.S2 * (columns - 1)
}

@Composable
internal fun ParticipantControlsRow(userId: String, name: String, participant: MediaParticipant?, self: Boolean, state: ParticipantControlState, modifier: Modifier = Modifier, iconOnly: Boolean = false, beside: Boolean = false) {
    val compact = LocalMeetingCompact.current
    val scope = rememberCoroutineScope()
    var pending by remember(userId) { mutableStateOf(false) }
    val microphone = participant?.microphone == true
    val camera = participant?.camera == true
    val available = participant != null && (self || state.online(userId))
    fun run(action: suspend () -> Unit) {
        pending = true
        scope.launch {
            try { action() } catch (error: CancellationException) { throw error } catch (error: Throwable) { state.report(error) } finally { pending = false }
        }
    }
    fun toggleMicrophone() = run { if (self) state.setMicrophone(!microphone) else state.control(ParticipantControlPayload(userId, microphone = !microphone)) }
    fun toggleCamera() = run { if (self) state.setCamera(!camera) else state.control(ParticipantControlPayload(userId, camera = !camera)) }
    val height = participantControlsHeight(compact)
    val buttons: @Composable (Modifier) -> Unit = { annotationModifier ->
        ControlButton(if (microphone) "mic" else "micOff", null, "$name ${if (microphone) DesignContent.ParticipantMicOff else DesignContent.ParticipantMicOn}",
            off = !microphone, selected = false, enabled = available && !pending, height = height, onClick = ::toggleMicrophone)
        ControlButton(if (camera) "video" else "videoOff", null, "$name ${if (camera) DesignContent.ParticipantCameraOff else DesignContent.ParticipantCameraOn}",
            off = !camera, selected = false, enabled = available && !pending, height = height, onClick = ::toggleCamera)
        if (!self && state.lessonModes) {
            val allowed = state.annotationAllowed(userId)
            ControlButton("pen", if ((compact && iconOnly) || beside) null else DesignContent.ParticipantAnnotation, "$name ${DesignContent.ParticipantAnnotation}",
                off = false, selected = allowed, enabled = state.online(userId) && !pending, height = height,
                modifier = annotationModifier) { run { state.control(ParticipantControlPayload(userId, annotation = !allowed)) } }
        }
    }
    val label = Modifier.testTag("participant-controls-$userId").semantics { contentDescription = "$name ${DesignContent.ParticipantControlsLabel}" }
    // Same visual spacing as the web; Material's 48dp minimum would otherwise widen the gaps.
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp) {
        // Phone strip: icon buttons stack beside the tile (web: .participant-controls column) so the strip keeps the tile's height.
        // Wraps at the tile height; the tile row centres the whole block, so a lone button in a second column sits at the top like the web grid.
        if (beside) FlowColumn(modifier.then(label), verticalArrangement = Arrangement.spacedBy(Space.S2),
            horizontalArrangement = Arrangement.spacedBy(Space.S2)) { buttons(Modifier) }
        else Row(modifier.height(height).then(label), horizontalArrangement = Arrangement.spacedBy(if (compact) Space.S4 else Space.S8), verticalAlignment = Alignment.CenterVertically) {
            buttons(Modifier.weight(1f, fill = false))
        }
    }
}

@Composable
private fun ControlButton(icon: String, label: String?, description: String, off: Boolean, selected: Boolean, enabled: Boolean, height: Dp, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val background = when { off -> Palette.MicMuted; selected -> Palette.Selection; else -> Palette.MeetingControl }
    val ink = when { off -> Palette.MeetingMutedInk; selected -> Palette.PrimaryPressed; else -> Palette.MeetingText }
    Surface(onClick = onClick, enabled = enabled, shape = RoundedCornerShape(Corner.R8), color = background,
        border = if (off || selected) null else BorderStroke(Space.S1, Palette.MeetingBorder),
        modifier = modifier.widthIn(min = height).height(height).alpha(if (enabled) 1f else .45f)
            .semantics { contentDescription = description; role = Role.Button; this.selected = selected || off }) {
        Row(Modifier.padding(horizontal = if (label == null) Space.S6 else Space.S10), horizontalArrangement = Arrangement.spacedBy(Space.S4, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
            DesignIcon(icon, Modifier.size(if (height < Space.S36) Space.S15 else Space.S18), ink)
            if (label != null) Text(label, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = DesignWeight.SemiBold,
                style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
        }
    }
}

