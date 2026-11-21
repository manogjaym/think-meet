@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.woongjin.thinkmeet.platform

import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.CoreGraphics.CGSizeMake
import platform.Foundation.NSData
import platform.Foundation.create
import platform.Foundation.getBytes
import platform.PDFKit.PDFDocument
import platform.PDFKit.kPDFDisplayBoxCropBox
import platform.UIKit.UIImagePNGRepresentation

internal actual fun openTextbookPreview(bytes: ByteArray): TextbookPreview {
    require(bytes.isNotEmpty())
    val data = bytes.usePinned { NSData.create(bytes = it.addressOf(0), length = bytes.size.toULong()) }
    val pdf = PDFDocument(data)
    require(!pdf.isLocked && pdf.pageCount > 0u)
    return object : TextbookPreview {
        private var document: PDFDocument? = pdf
        override val pageCount = pdf.pageCount.toInt()

        override fun render(page: Int) = kotlinx.cinterop.autoreleasepool {
            val source = checkNotNull(document?.pageAtIndex((page - 1).toULong()))
            val side = TextbookThumbnailSide.toDouble()
            val image = source.thumbnailOfSize(CGSizeMake(side, side), kPDFDisplayBoxCropBox)
            val png = checkNotNull(UIImagePNGRepresentation(image))
            val buffer = ByteArray(png.length.toInt())
            buffer.usePinned { png.getBytes(it.addressOf(0), png.length) }
            checkNotNull(decodeNoteImage(buffer))
        }

        override fun close() { document = null }
    }
}
