package com.woongjin.thinkmeet.platform

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.woongjin.thinkmeet.data.Share
import com.woongjin.thinkmeet.data.ThinkMeetApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.abs
import kotlin.time.Clock
import kotlin.time.Instant

@Composable actual fun MaterialSurface(api: ThinkMeetApi, share: Share, lessonId: String, modifier: Modifier, onAspectRatio: (Float) -> Unit) {
    val id = share.materialId ?: return
    val context = LocalContext.current
    val aspect by rememberUpdatedState(onAspectRatio)
    var error by remember(id) { mutableStateOf<String?>(null) }
    Box(modifier, contentAlignment = Alignment.Center) {
        if (share.type == "document") {
            var file by remember(id) { mutableStateOf<File?>(null) }
            var bitmap by remember(id) { mutableStateOf<Bitmap?>(null) }
            var renderedPage by remember(id) { mutableIntStateOf(0) }
            LaunchedEffect(id) {
                var temporary: File? = null
                try {
                    file = withContext(Dispatchers.IO) {
                        File.createTempFile("lesson-document-", ".pdf", context.cacheDir).also { temporary = it; it.writeBytes(api.downloadMaterial(id, lessonId)) }
                    }
                } catch (cancelled: CancellationException) { temporary?.delete(); throw cancelled }
                catch (failure: Throwable) { temporary?.delete(); error = "자료를 불러오지 못했어요: ${failure.message}" }
            }
            LaunchedEffect(file, share.page) {
                val source = file ?: return@LaunchedEffect
                runCatching { withContext(Dispatchers.IO) {
                    PdfRenderer(ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY)).use { renderer ->
                        renderer.openPage((share.page - 1).coerceIn(0, renderer.pageCount - 1)).use { page ->
                            // At most 1600px: keeps the same PDF readable on tablets without retaining full-resolution pages.
                            val scale = minOf(1600f / page.width, 1600f / page.height)
                            Bitmap.createBitmap((page.width * scale).toInt().coerceAtLeast(1), (page.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888).also {
                                it.eraseColor(Color.WHITE); page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            }
                        }
                    }
                } }.onSuccess { next -> bitmap = next; renderedPage = share.page; error = null; aspect(next.width.toFloat() / next.height) }
                    .onFailure { if (it is CancellationException) throw it; error = "PDF를 표시하지 못했어요: ${it.message}" }
            }
            DisposableEffect(id) { onDispose { file?.delete() } }
            val image = bitmap
            if (image != null) Image(image.asImageBitmap(), "${share.material?.name ?: "공유 PDF"} ${renderedPage}페이지", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            else if (error == null) CircularProgressIndicator()
        } else {
            var cookie by remember(id) { mutableStateOf<String?>(null) }
            LaunchedEffect(id) { cookie = api.cookieHeader() }
            if (cookie != null) {
                val player = remember(id, cookie) {
                    val http = DefaultHttpDataSource.Factory().setDefaultRequestProperties(mapOf("Cookie" to cookie!!))
                    ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(http)).build().apply {
                        setMediaItem(MediaItem.fromUri(api.materialContentUrl(id, lessonId))); prepare()
                    }
                }
                DisposableEffect(player) {
                    val listener = object : Player.Listener {
                        override fun onVideoSizeChanged(videoSize: VideoSize) {
                            if (videoSize.height > 0) aspect(videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height)
                        }
                        override fun onPlayerError(e: androidx.media3.common.PlaybackException) { error = "영상을 재생하지 못했어요: ${e.localizedMessage}" }
                    }
                    player.addListener(listener)
                    onDispose { player.removeListener(listener); player.release() }
                }
                LaunchedEffect(player, share.updatedAt, share.position, share.playing) {
                    fun expected(): Long {
                        val elapsed = if (share.playing) runCatching { (Clock.System.now() - Instant.parse(share.updatedAt)).inWholeMilliseconds }.getOrDefault(0) else 0
                        return (share.position * 1000 + elapsed).toLong().coerceAtLeast(0)
                    }
                    player.seekTo(expected()); player.playWhenReady = share.playing
                    while (true) { delay(2000); if (share.playing && abs(player.currentPosition - expected()) > 1500) player.seekTo(expected()) }
                }
                AndroidView(factory = { PlayerView(it).apply { this.player = player; useController = false } }, modifier = Modifier.fillMaxSize())
            } else CircularProgressIndicator()
        }
        error?.let { Text(it) }
    }
}
