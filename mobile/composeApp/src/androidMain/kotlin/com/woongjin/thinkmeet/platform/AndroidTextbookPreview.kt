package com.woongjin.thinkmeet.platform

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.ui.graphics.asImageBitmap
import java.io.File

internal actual fun openTextbookPreview(bytes: ByteArray): TextbookPreview {
    val file = File.createTempFile("textbook-preview-", ".pdf", AndroidPlatform.context.cacheDir)
    val renderer = try {
        file.writeBytes(bytes)
        val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        try {
            PdfRenderer(descriptor)
        } catch (error: Throwable) {
            descriptor.close()
            throw error
        }
    } catch (error: Throwable) {
        file.delete()
        throw error
    }
    return object : TextbookPreview {
        override val pageCount = renderer.pageCount

        override fun render(page: Int) = renderer.openPage(page - 1).use { source ->
            val scale = TextbookThumbnailSide.toFloat() / maxOf(source.width, source.height)
            val bitmap = Bitmap.createBitmap(
                (source.width * scale).toInt().coerceAtLeast(1),
                (source.height * scale).toInt().coerceAtLeast(1),
                Bitmap.Config.ARGB_8888,
            )
            bitmap.eraseColor(Color.WHITE)
            source.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            bitmap.asImageBitmap()
        }

        override fun close() {
            try { renderer.close() } finally { file.delete() }
        }
    }
}
