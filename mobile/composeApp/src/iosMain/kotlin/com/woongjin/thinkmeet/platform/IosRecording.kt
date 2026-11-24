@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)
package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import platform.Foundation.NSApplicationSupportDirectory
import platform.Foundation.NSFileHandle
import platform.Foundation.NSFileManager
import platform.Foundation.NSFileSize
import platform.Foundation.NSNumber
import platform.Foundation.NSSearchPathForDirectoriesInDomains
import platform.Foundation.NSUserDomainMask
import platform.Foundation.closeFile
import platform.Foundation.fileHandleForReadingAtPath
import platform.Foundation.readDataOfLength
import platform.Foundation.seekToFileOffset
import platform.posix.memcpy

private fun native() = checkNotNull(IosPlatform.bridge) { "NativeBridge must be installed before MainViewController" }

/** Application Support survives app restarts; the container path itself may change, so only names are stored. */
private fun recordingDirectory(): String {
    val base = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, true).first() as String
    val directory = "$base/recordings"
    NSFileManager.defaultManager.createDirectoryAtPath(directory, withIntermediateDirectories = true, attributes = null, error = null)
    return directory
}
internal fun recordingPath(name: String): String {
    require(name.matches(Regex("[A-Za-z0-9_.-]{1,120}")) && !name.startsWith(".")) { "Invalid recording name" }
    return "${recordingDirectory()}/$name"
}

actual fun lessonRecordingSupported(): Boolean = IosPlatform.bridge?.recordingAvailable() == true
internal actual fun recordingFileSize(name: String): Long {
    val path = recordingPath(name)
    if (!NSFileManager.defaultManager.fileExistsAtPath(path)) return -1
    val attributes = NSFileManager.defaultManager.attributesOfItemAtPath(path, null) ?: return -1
    return (attributes[NSFileSize] as? NSNumber)?.longLongValue ?: -1
}
internal actual suspend fun readRecordingChunk(name: String, offset: Long, length: Int): ByteArray = withContext(Dispatchers.Default) {
    val handle = NSFileHandle.fileHandleForReadingAtPath(recordingPath(name)) ?: error("녹화 파일을 열지 못했어요.")
    try {
        handle.seekToFileOffset(offset.toULong())
        val data = handle.readDataOfLength(length.toULong())
        val bytes = ByteArray(data.length.toInt())
        if (bytes.isNotEmpty()) bytes.usePinned { memcpy(it.addressOf(0), data.bytes, data.length) }
        bytes
    } finally { handle.closeFile() }
}
internal actual fun deleteRecordingFile(name: String) {
    NSFileManager.defaultManager.removeItemAtPath(recordingPath(name), null)
}

@Composable internal actual fun RecordingPlayerDialog(url: String, cookie: String, onClose: () -> Unit) {
    val close by rememberUpdatedState(onClose)
    DisposableEffect(url, cookie) {
        native().playRecording(url, cookie) { close() }
        onDispose { }
    }
}
