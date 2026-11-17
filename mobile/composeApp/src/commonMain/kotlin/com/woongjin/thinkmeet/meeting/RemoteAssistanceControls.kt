package com.woongjin.thinkmeet.meeting

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.woongjin.thinkmeet.data.AssistanceSession
import com.woongjin.thinkmeet.data.User
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner

@Composable
internal fun RemoteAssistanceControls(
    session: AssistanceSession, user: User, supported: Boolean, busy: Boolean, modifier: Modifier = Modifier,
    onApprove: () -> Unit, onDecline: () -> Unit, onStop: () -> Unit,
) {
    val student = session.studentId == user.id
    Surface(modifier, color = Palette.MeetingTile, shape = RoundedCornerShape(Corner.R8)) {
        Row(Modifier.padding(horizontal = Space.S12, vertical = Space.S8), verticalAlignment = Alignment.CenterVertically) {
            Text(when {
                student && !supported -> DesignContent.RemoteAssistUnsupported
                session.status == "pending" -> DesignContent.RemoteAssistWaiting
                session.status == "approved" -> DesignContent.RemoteAssistPreparing
                student -> DesignContent.RemoteAssistActiveStudent
                else -> DesignContent.RemoteAssistActive
            }, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = Palette.MeetingText)
            TextButton(onClick = onStop, enabled = !busy || student) { Text(DesignContent.RemoteAssistStop, color = Palette.PrimaryOnDark) }
        }
    }
    if (student && session.status == "pending") MeetingLightTheme {
        AlertDialog(onDismissRequest = { if (!busy) onDecline() },
            title = { Text(DesignContent.RemoteAssistTitle) },
            text = { Text(if (supported) DesignContent.RemoteAssistConsent else DesignContent.RemoteAssistUnsupported) },
            confirmButton = { if (supported) TextButton(onClick = onApprove, enabled = !busy) { Text(DesignContent.RemoteAssistApprove) } },
            dismissButton = { TextButton(onClick = onDecline, enabled = !busy) { Text(DesignContent.RemoteAssistDecline) } })
    }
}
