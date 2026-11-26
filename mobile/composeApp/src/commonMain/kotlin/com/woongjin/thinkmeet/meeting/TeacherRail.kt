package com.woongjin.thinkmeet.meeting

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.woongjin.thinkmeet.data.MeetingSnapshot
import com.woongjin.thinkmeet.design.DesignIcon
import com.woongjin.thinkmeet.design.DesignWeight
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import kotlinx.coroutines.delay

/** Lesson owner's materials card under the participant videos in the right rail (web: TeacherRail.tsx). */
@Composable
internal fun MaterialsCard(
    textbookEnabled: Boolean, onTextbook: () -> Unit, modifier: Modifier = Modifier,
    /** classroom.subject-switch; without it the subject button only shows the coming-soon notice. */
    subjectEnabled: Boolean = true, onSubject: (() -> Unit)? = null,
) {
    var notice by remember { mutableStateOf(0) }
    LaunchedEffect(notice) { if (notice > 0) { delay(2_500); notice = 0 } }
    val comingSoon: () -> Unit = { notice += 1 }
    MeetingLightPanel(modifier) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(Space.S16), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            Text(DesignContent.MeetingMaterialsTitle, Modifier.padding(bottom = Space.S4).semantics { heading() },
                style = MaterialTheme.typography.titleSmall.copy(fontSize = Type.Body, lineHeight = Type.Body * 1.5f), fontWeight = DesignWeight.Bold, color = Palette.Ink)
            MaterialsButton(DesignContent.MeetingMaterialsTextbook, "grid", Palette.ControlInactive, Palette.Ink, enabled = textbookEnabled, onClick = onTextbook)
            MaterialsButton(DesignContent.MeetingMaterialsWorksheet, "file", Palette.ControlInactive, Palette.Ink, onClick = comingSoon)
            MaterialsButton(DesignContent.MeetingMaterialsSubject, null, Palette.White, Palette.Primary, border = BorderStroke(Space.S2, Palette.Primary),
                enabled = onSubject == null || subjectEnabled, onClick = onSubject ?: comingSoon)
            MaterialsButton(DesignContent.MeetingMaterialsHomework, "calendar", Palette.HomeworkAction, Palette.White, Modifier.padding(top = Space.S4), onClick = comingSoon)
            Text(if (notice > 0) DesignContent.MeetingMaterialsComingSoon else "", Modifier.heightIn(min = 20.dp).semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted)
        }
    }
}

@Composable
private fun MaterialsButton(
    label: String, icon: String?, background: Color, content: Color, modifier: Modifier = Modifier,
    border: BorderStroke? = null, enabled: Boolean = true, onClick: () -> Unit,
) {
    // Items with an icon start-align like list rows; the subject and homework actions are centered as in the design.
    val list = background == Palette.ControlInactive
    Surface(onClick = onClick, enabled = enabled, modifier = modifier.fillMaxWidth(), shape = RoundedCornerShape(Corner.R8),
        color = background.copy(alpha = if (enabled) 1f else .5f), contentColor = content, border = border) {
        Row(Modifier.heightIn(min = Space.S44).padding(horizontal = Space.S12), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = if (list) Arrangement.spacedBy(Space.S8) else Arrangement.spacedBy(Space.S8, Alignment.CenterHorizontally)) {
            icon?.let { DesignIcon(it, Modifier.size(Space.S18), if (list) Palette.Primary else content) }
            Text(label, style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), fontWeight = DesignWeight.SemiBold)
        }
    }
}

/** Main stage guidance for the lesson owner while nothing is shared, including a mirroring request awaiting the student (web: TeacherStageGuide). */
@Composable
internal fun TeacherStageGuide(
    snapshot: MeetingSnapshot?, enabled: Boolean, onShare: () -> Unit, onPickStudent: () -> Unit,
    onCancelRequest: () -> Unit, cancelEnabled: Boolean, modifier: Modifier = Modifier,
) {
    val phase = snapshot?.instruction?.phase
    val session = snapshot?.assistance
    val student = session?.let { current -> snapshot.participants.firstOrNull { it.user.id == current.studentId }?.user?.name }
    val waiting = phase == "mirroring" && session != null
    val message = when {
        waiting && session?.status == "pending" -> listOfNotNull(student, DesignContent.MeetingMirroringWaiting).joinToString(" ")
        waiting -> DesignContent.RemoteAssistPreparing
        phase == "classroom" -> DesignContent.MeetingStageClassroom
        phase == "mirroring" -> DesignContent.MeetingStageMirroring
        else -> DesignContent.MeetingStagePreparing
    }
    Column(modifier.background(Palette.MeetingTile, RoundedCornerShape(Corner.R12)).border(Space.S1, Palette.MeetingBorder, RoundedCornerShape(Corner.R12))
        .padding(Space.S24).semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.S16, Alignment.CenterVertically)) {
        Box(Modifier.size(88.dp).background(Palette.MeetingMediaActive, CircleShape), contentAlignment = Alignment.Center) {
            DesignIcon("screen", Modifier.size(34.dp), Palette.PrimaryOnDark)
        }
        val size = if (waiting) Type.Heading else Type.Body
        Text(message, Modifier.widthIn(max = 420.dp), textAlign = TextAlign.Center, color = Palette.MeetingText,
            style = MaterialTheme.typography.bodyLarge.copy(fontSize = size, lineHeight = size * 1.5f), fontWeight = if (waiting) DesignWeight.Bold else DesignWeight.SemiBold)
        if (waiting) Surface(onClick = onCancelRequest, enabled = cancelEnabled, shape = RoundedCornerShape(percent = 50), color = Color.Transparent,
            contentColor = Palette.MeetingMuted, border = BorderStroke(Space.S1, Palette.MeetingBorder)) {
            Box(Modifier.heightIn(min = Space.S44).widthIn(min = 200.dp).padding(horizontal = Space.S24), contentAlignment = Alignment.Center) {
                Text(if (session?.status == "pending") DesignContent.MeetingLessonCancelRequest else DesignContent.RemoteAssistStop,
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), fontWeight = DesignWeight.SemiBold)
            }
        }
        val action = when {
            phase == "classroom" -> DesignContent.MeetingStageClassroomAction to onShare
            phase == "mirroring" && session == null -> DesignContent.MeetingStageMirroringAction to onPickStudent
            else -> null
        }
        action?.let { (label, onClick) ->
            Surface(onClick = onClick, enabled = enabled, shape = RoundedCornerShape(Corner.R8), color = Palette.MeetingControl.copy(alpha = if (enabled) 1f else .5f),
                contentColor = Palette.MeetingText, border = BorderStroke(Space.S1, Palette.MeetingBorder)) {
                Box(Modifier.heightIn(min = Space.S44).padding(horizontal = Space.S24), contentAlignment = Alignment.Center) {
                    Text(label, style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), fontWeight = DesignWeight.SemiBold)
                }
            }
        }
    }
}
