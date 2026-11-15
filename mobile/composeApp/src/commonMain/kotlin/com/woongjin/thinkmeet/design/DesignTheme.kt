package com.woongjin.thinkmeet.design

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import com.woongjin.thinkmeet.design.generated.sharedFontFamily
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import com.woongjin.thinkmeet.design.generated.DesignTokens.LineHeight as Leading
import com.woongjin.thinkmeet.design.generated.DesignTokens
import com.woongjin.thinkmeet.design.generated.DesignTokens.FontSize as TextSize

// Both platforms use the same generated tokens; theme policy remains in common Compose code.
val Brand = DesignTokens.Colors.Primary
val Ink = DesignTokens.Colors.Ink
val Muted = DesignTokens.Colors.Muted
val Canvas = DesignTokens.Colors.Canvas

private val AppColors = lightColorScheme(
    primary = Brand,
    secondary = DesignTokens.Colors.Secondary,
    background = Canvas,
    surface = DesignTokens.Colors.Surface,
    onSurface = Ink,
    onBackground = Ink,
    surfaceVariant = DesignTokens.Colors.SurfaceVariant,
    onSurfaceVariant = Muted,
    onPrimary = DesignTokens.Colors.White,
    primaryContainer = DesignTokens.Colors.Selection,
    onPrimaryContainer = DesignTokens.Colors.BrandDark,
    secondaryContainer = DesignTokens.Colors.Selection,
    onSecondaryContainer = DesignTokens.Colors.BrandDark,
    outline = DesignTokens.Colors.LineInput,
    outlineVariant = DesignTokens.Colors.Line,
    surfaceTint = Color.Transparent,
    errorContainer = DesignTokens.Colors.ErrorBackground,
    onErrorContainer = DesignTokens.Colors.ErrorInk,
    error = DesignTokens.Colors.Danger,
)
private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(DesignTokens.Radius.R4),
    small = RoundedCornerShape(DesignTokens.Radius.Small),
    medium = RoundedCornerShape(DesignTokens.Radius.Medium),
    large = RoundedCornerShape(DesignTokens.Radius.Large),
    extraLarge = RoundedCornerShape(DesignTokens.Radius.R28),
)
/** Web typography: the same Pretendard release, sizes, weights, line heights and tracking. */
@Composable
private fun webTypography(): Typography {
    val family = sharedFontFamily()
    return remember(family) {
        fun style(size: TextUnit, height: TextUnit, weight: FontWeight = DesignWeight.Regular, tracking: Float = -.02f) =
            TextStyle(fontFamily = family, fontSize = size, lineHeight = height, fontWeight = weight, letterSpacing = tracking.em,
                lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None))
        Typography(
            displayLarge = style(Type.Display, Leading.Display, DesignWeight.Bold, -.025f),
            displayMedium = style(Type.Title, Leading.Title, DesignWeight.Bold, -.025f),
            displaySmall = style(Type.Dialog, Leading.Dialog, DesignWeight.Bold),
            headlineLarge = style(Type.Display, Leading.Display, DesignWeight.Bold, -.025f),
            headlineMedium = style(Type.Title, Leading.Title, DesignWeight.Bold, -.025f),
            headlineSmall = style(Type.Dialog, Leading.Dialog, DesignWeight.Bold),
            titleLarge = style(Type.Heading, Leading.Heading, DesignWeight.Bold),
            titleMedium = style(Type.Label, 24.sp, DesignWeight.SemiBold),
            titleSmall = style(Type.Support, 22.5.sp, DesignWeight.SemiBold),
            bodyLarge = style(Type.Body, 25.5.sp),
            bodyMedium = style(Type.Label, 24.sp),
            bodySmall = style(Type.Support, 22.5.sp),
            labelLarge = style(Type.Label, 24.sp, DesignWeight.SemiBold),
            labelMedium = style(Type.Caption, 19.5.sp, DesignWeight.Medium),
            labelSmall = style(Type.Caption, 19.5.sp, DesignWeight.Medium),
        )
    }
}

object DesignWeight {
    val Regular = FontWeight(DesignTokens.Weight.Regular)
    val Medium = FontWeight(DesignTokens.Weight.Medium)
    val SemiBold = FontWeight(DesignTokens.Weight.SemiBold)
    val Bold = FontWeight(DesignTokens.Weight.Bold)
}

@Composable
fun ThinkMeetTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = AppColors, typography = webTypography(), shapes = AppShapes, content = content)
}
