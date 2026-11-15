// Generated from design/fonts/manifest.json.
package com.woongjin.thinkmeet.design.generated

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import org.jetbrains.compose.resources.Font
import thinkmeetmobile.composeapp.generated.resources.*

@Composable
fun sharedFontFamily(): FontFamily {
    val regular = Font(Res.font.pretendard_regular, weight = FontWeight(400))
    val medium = Font(Res.font.pretendard_medium, weight = FontWeight(500))
    val semibold = Font(Res.font.pretendard_semibold, weight = FontWeight(600))
    val bold = Font(Res.font.pretendard_bold, weight = FontWeight(700))
    return remember(regular, medium, semibold, bold) { FontFamily(regular, medium, semibold, bold) }
}
