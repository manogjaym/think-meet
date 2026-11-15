package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable

/** Platform chrome follows the canonical light pages / dark classroom theme. */
@Composable
expect fun ConfigureSystemAppearance(dark: Boolean)
