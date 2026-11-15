@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import platform.UIKit.UIApplication
import platform.UIKit.UIUserInterfaceStyle
import platform.UIKit.UIWindow

@Composable
actual fun ConfigureSystemAppearance(dark: Boolean) {
    SideEffect {
        UIApplication.sharedApplication.windows.forEach { value ->
            (value as? UIWindow)?.rootViewController?.let { controller ->
                controller.overrideUserInterfaceStyle = if (dark) UIUserInterfaceStyle.UIUserInterfaceStyleDark else UIUserInterfaceStyle.UIUserInterfaceStyleLight
                controller.setNeedsStatusBarAppearanceUpdate()
            }
        }
    }
}
