package com.woongjin.thinkmeet.design

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Component as Component
import com.woongjin.thinkmeet.design.generated.DesignVectors

/** Exact canonical SVG paths, shared with React rather than substituted Material symbols. */
@Composable
fun BrandSymbol(modifier: Modifier = Modifier, tint: Color = Brand) = Icon(DesignVectors.icon("brand"), null, modifier.size(28.dp), tint = tint)

@Composable
fun DesignIcon(name: String, modifier: Modifier = Modifier, tint: Color = Ink, contentDescription: String? = null) =
    Icon(DesignVectors.icon(name), contentDescription, modifier.size(20.dp), tint = tint)

fun designAvatarColor(identity: String): Color {
    val colors = listOf(Palette.AvatarSage, Palette.AvatarClay, Palette.AvatarSlate, Palette.AvatarGold, Palette.AvatarBlue)
    var sum = 0
    var index = 0
    while (index < identity.length) {
        val value = identity[index]
        sum += value.code
        index += if (value.isHighSurrogate() && index + 1 < identity.length && identity[index + 1].isLowSurrogate()) 2 else 1
    }
    return colors[sum % colors.size]
}

@Composable
fun DesignAvatar(name: String, identity: String, modifier: Modifier = Modifier, size: Dp = 44.dp, small: Boolean = false) {
    val actualSize = if (small && size == 44.dp) 32.dp else size
    val fontSize = when { actualSize <= 28.dp -> 9.sp; actualSize <= 30.dp -> 11.sp; small || actualSize <= 36.dp -> 13.sp; actualSize >= 88.dp -> 32.sp; actualSize >= 72.dp -> 27.sp; else -> 18.sp }
    Box(modifier.size(actualSize).clip(CircleShape).background(designAvatarColor(identity)), contentAlignment = Alignment.Center) {
        Text(name.replace(Regex("\\s*(선생님|학생)$"), "").takeLast(2), color = Palette.White, fontSize = fontSize, fontWeight = DesignWeight.SemiBold)
    }
}

/** Web .field: external label and a 48px outlined input without floating labels. */
@Composable
fun DesignTextField(value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier,
    label: String? = null, placeholder: String? = null, singleLine: Boolean = true, enabled: Boolean = true,
    isError: Boolean = false, minLines: Int = 1, visualTransformation: VisualTransformation = VisualTransformation.None,
    leadingIcon: (@Composable () -> Unit)? = null, trailingIcon: (@Composable () -> Unit)? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default, keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(Component.InputRadius)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (label != null) Text(buildAnnotatedString {
            if (label.endsWith(" *")) {
                append(label.dropLast(1))
                withStyle(SpanStyle(color = Palette.Danger)) { append("*") }
            } else append(label)
        }, color = Palette.TextSecondary, style = MaterialTheme.typography.bodySmall, fontWeight = DesignWeight.Medium)
        BasicTextField(value, onValueChange, Modifier.fillMaxWidth().heightIn(min = if (!singleLine && minLines > 1) Component.TextareaMinHeight else Component.InputHeight)
            .alpha(if (enabled) 1f else .45f).onFocusChanged { focused = it.isFocused }
            .semantics { if (label != null) contentDescription = label }
            .background(Palette.White, shape)
            .border(if (focused) 2.dp else 1.dp, if (isError) Palette.Danger else if (focused) Palette.PrimarySoft else Palette.LineInput, shape),
            enabled = enabled, singleLine = singleLine, minLines = if (singleLine) 1 else minLines,
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = Ink), cursorBrush = SolidColor(Brand),
            visualTransformation = visualTransformation, keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
            decorationBox = { input ->
                Row(Modifier.fillMaxWidth().padding(Component.InputPadding + 1.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    leadingIcon?.invoke()
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty() && placeholder != null) Text(placeholder, color = Muted, style = MaterialTheme.typography.bodyMedium)
                        input()
                    }
                    trailingIcon?.invoke()
                }
            })
    }
}

@Composable
fun DesignButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    secondary: Boolean = false, danger: Boolean = false, icon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    textStyle: TextStyle = MaterialTheme.typography.labelLarge,
) {
    val background = when { danger -> Palette.Danger; secondary -> Palette.White; else -> Brand }
    val foreground = if (secondary) Palette.TextSecondary else Palette.White
    Button(onClick, modifier.heightIn(min = Component.ButtonHeight).alpha(if (enabled) 1f else .45f), enabled = enabled,
        shape = RoundedCornerShape(Component.ButtonRadius), border = if (secondary) BorderStroke(1.dp, Palette.Line) else null,
        contentPadding = PaddingValues(horizontal = Component.ButtonPaddingX, vertical = 8.dp),
        colors = ButtonDefaults.buttonColors(containerColor = background, contentColor = foreground, disabledContainerColor = background, disabledContentColor = foreground)) {
        if (icon != null) { icon(); Spacer(Modifier.width(Component.ButtonGap)) }
        Text(text, style = textStyle, fontWeight = DesignWeight.SemiBold)
        if (trailingIcon != null) { Spacer(Modifier.width(Component.ButtonGap)); trailingIcon() }
    }
}
