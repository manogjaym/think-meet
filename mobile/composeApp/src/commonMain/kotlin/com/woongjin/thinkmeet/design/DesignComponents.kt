package com.woongjin.thinkmeet.design

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.woongjin.thinkmeet.design.generated.DesignTokens

/** Shared container for lesson details, roster and booking fields. */
@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    spacing: Dp = DesignTokens.Spacing.S20,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(modifier, shape = RoundedCornerShape(DesignTokens.Component.CardRadius), color = DesignTokens.Colors.Surface, border = BorderStroke(1.dp, DesignTokens.Colors.Line)) {
        Column(Modifier.fillMaxWidth().padding(DesignTokens.Component.CardPadding),
            verticalArrangement = Arrangement.spacedBy(spacing), content = content)
    }
}
