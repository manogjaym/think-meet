package com.woongjin.thinkmeet.platform

import androidx.compose.ui.graphics.ImageBitmap

internal const val TextbookThumbnailSide = 240

internal interface TextbookPreview {
    val pageCount: Int
    fun render(page: Int): ImageBitmap
    fun close()
}

internal expect fun openTextbookPreview(bytes: ByteArray): TextbookPreview
