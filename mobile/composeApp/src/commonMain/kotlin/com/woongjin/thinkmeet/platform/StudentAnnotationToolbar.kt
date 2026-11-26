package com.woongjin.thinkmeet.platform

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import com.woongjin.thinkmeet.design.DesignIcon
import com.woongjin.thinkmeet.design.ThinkMeetTheme
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space

/** Blue, red and black from the classroom annotation palette (persisted stroke colours). */
val StudentAnnotationColors = listOf("#4386d8", "#ef6461", "#1f2937")

/**
 * The mirroring student's own annotation tools over other apps: pen, eraser, colours and undo.
 * Tapping the selected tool again releases it so the app underneath can be used; there is no close button,
 * because only the teacher ends the student's annotation mode.
 */
@Composable
fun StudentAnnotationToolbar(tool: String?, color: String, onTool: (String?) -> Unit, onColor: (String) -> Unit, onUndo: () -> Unit) {
    ThinkMeetTheme {
        // The margin keeps the shadow inside this small transparent window. The whole bar stays under 320dp because
        // Android first measures wrap-content overlay windows at its preferred dialog width.
        Surface(Modifier.padding(start = Space.S8, end = Space.S8, top = Space.S6, bottom = Space.S12), shape = RoundedCornerShape(Space.S48), color = Palette.White, shadowElevation = Space.S6) {
            Row(Modifier.padding(horizontal = Space.S6, vertical = Space.S4), horizontalArrangement = Arrangement.spacedBy(Space.S4),
                verticalAlignment = Alignment.CenterVertically) {
                listOf("pen" to "펜", "eraser" to "지우개").forEach { (value, label) ->
                    val selected = tool == value
                    Box(Modifier.size(Space.S40).clip(CircleShape).background(if (selected) Palette.Primary else Color.Transparent)
                        .clickable(role = Role.Button) { onTool(if (selected) null else value) }
                        .semantics { contentDescription = label; this.selected = selected }, contentAlignment = Alignment.Center) {
                        DesignIcon(value, Modifier.size(Space.S20), if (selected) Palette.White else Palette.Ink)
                    }
                }
                Divider()
                StudentAnnotationColors.forEach { value ->
                    val selected = color == value
                    Box(Modifier.size(Space.S40).clip(CircleShape).clickable(role = Role.Button) { onColor(value) }
                        .semantics { contentDescription = "색상 $value"; this.selected = selected }, contentAlignment = Alignment.Center) {
                        Box(Modifier.size(Space.S32).border(Space.S2, if (selected) Palette.Primary else Color.Transparent, CircleShape)
                            .padding(Space.S4).clip(CircleShape).background(hexColor(value)))
                    }
                }
                Divider()
                Box(Modifier.size(Space.S40).clip(CircleShape).clickable(role = Role.Button, onClick = onUndo)
                    .semantics { contentDescription = "실행 취소" }, contentAlignment = Alignment.Center) {
                    DesignIcon("undo", Modifier.size(Space.S20), Palette.Ink)
                }
            }
        }
    }
}

@Composable
private fun Divider() = Box(Modifier.width(Space.S1).height(Space.S28).background(Palette.Line))

private fun hexColor(value: String): Color =
    value.removePrefix("#").toLongOrNull(16)?.let { Color(0xFF000000 or it) } ?: Palette.Ink
