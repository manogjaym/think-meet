package com.woongjin.thinkmeet.platform

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.Observer
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import kotlin.math.max
import kotlin.math.roundToInt

internal class WorksheetDraftViewModel : ViewModel() {
    private var studentId: String? = null
    private val draft = mutableStateOf<NoteDraft?>(null)

    fun forStudent(id: String): MutableState<NoteDraft?> {
        if (studentId != id) { studentId = id; draft.value = null }
        return draft
    }
}

@Composable
internal actual fun rememberWorksheetDraft(studentId: String): MutableState<NoteDraft?> {
    val activity = LocalContext.current.findMainActivity()
    // Keep the photo and request ID across Activity recreation without placing image bytes in a Bundle.
    return remember(activity, studentId) {
        if (activity == null) mutableStateOf(null)
        else ViewModelProvider(activity)[WorksheetDraftViewModel::class.java].forStudent(studentId)
    }
}

@Composable
internal actual fun rememberNoteImagePicker(onResult: (ByteArray?, String?) -> Unit): NoteImagePicker {
    val context = LocalContext.current
    val latest by rememberUpdatedState(onResult)
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) latest(null, null) else scope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) {
                    checkNotNull(context.contentResolver.openInputStream(uri)) { "이미지를 열 수 없어요." }.use(::readBoundedNote)
                }
                latest(bytes, null)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                latest(null, error.message ?: "이미지를 열 수 없어요.")
            }
        }
    }
    return NoteImagePicker(true) { picker.launch(arrayOf("image/jpeg", "image/png")) }
}

@Composable
internal actual fun WorksheetCameraPreview(
    modifier: Modifier, onAccess: (WorksheetCameraAccess) -> Unit, onPhoto: (ByteArray?, String?) -> Unit,
) {
    val context = LocalContext.current
    val activity = context.findMainActivity()
    val supported = activity != null && context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    val latestAccess by rememberUpdatedState(onAccess)
    val latestPhoto by rememberUpdatedState(onPhoto)
    var allowed by remember { mutableStateOf(context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var requested by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed = it; requested = true }
    LaunchedEffect(supported) { if (supported && !allowed) permission.launch(Manifest.permission.CAMERA) }
    DisposableEffect(activity) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) allowed = context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        }
        activity?.lifecycle?.addObserver(observer)
        onDispose { activity?.lifecycle?.removeObserver(observer) }
    }
    LaunchedEffect(supported, allowed, requested) {
        when {
            !supported -> latestAccess(WorksheetCameraAccess(error = "이 기기에서 카메라를 사용할 수 없어요."))
            !allowed && requested -> latestAccess(WorksheetCameraAccess(error = "설정에서 카메라 권한을 허용해 주세요.", retry = { permission.launch(Manifest.permission.CAMERA) }))
            !allowed -> latestAccess(WorksheetCameraAccess())
        }
    }
    if (!supported || !allowed) return

    val view = remember(context) { PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE } }
    val scope = rememberCoroutineScope()
    AndroidView(factory = { view }, modifier = modifier)
    DisposableEffect(activity, view, attempt) {
        val executor = ContextCompat.getMainExecutor(context)
        val provider = ProcessCameraProvider.getInstance(context)
        val preview = Preview.Builder().build()
        val capture = ImageCapture.Builder().build()
        var active = true
        fun unavailable() = latestAccess(WorksheetCameraAccess(error = "카메라를 열지 못했어요.", retry = { attempt++ }))
        val shutter = {
            var file: File? = null
            try {
                val folder = File(context.cacheDir, "note-camera").apply { mkdirs() }
                folder.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86_400_000 }?.forEach { it.delete() }
                val output = File.createTempFile("worksheet-", ".jpg", folder).also { file = it }
                view.display?.let { capture.targetRotation = it.rotation }
                capture.takePicture(ImageCapture.OutputFileOptions.Builder(output).build(), executor, object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(results: ImageCapture.OutputFileResults) {
                        if (!active) { output.delete(); return }
                        scope.launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
                            try { latestPhoto(withContext(Dispatchers.IO) { photoBytes(output) }, null) }
                            catch (error: Exception) {
                                if (error is CancellationException) throw error
                                latestPhoto(null, "학습지 사진을 열 수 없어요.")
                            } finally { output.delete() }
                        }
                    }
                    override fun onError(exception: ImageCaptureException) {
                        output.delete()
                        if (active) latestPhoto(null, "촬영하지 못했어요. 다시 시도해 주세요.")
                    }
                })
            } catch (_: Exception) {
                file?.delete()
                latestPhoto(null, "촬영하지 못했어요. 다시 시도해 주세요.")
            }
        }
        latestAccess(WorksheetCameraAccess())
        val stream = Observer<PreviewView.StreamState> { state ->
            if (active) latestAccess(WorksheetCameraAccess(shutter = shutter.takeIf { state == PreviewView.StreamState.STREAMING }))
        }
        provider.addListener({
            if (active) try {
                val camera = provider.get()
                val selector = if (camera.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA
                preview.setSurfaceProvider(view.surfaceProvider)
                camera.bindToLifecycle(activity, selector, preview, capture)
                view.previewStreamState.observe(activity, stream)
            } catch (_: Exception) { unavailable() }
        }, executor)
        onDispose {
            active = false
            view.previewStreamState.removeObserver(stream)
            if (provider.isDone) runCatching { provider.get().unbind(preview, capture) }
        }
    }
}

private fun readBoundedNote(input: InputStream): ByteArray {
    val result = ByteArrayOutputStream()
    val buffer = ByteArray(64 * 1024)
    while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        require(result.size() + count <= NoteImageLimit) { "이미지는 10MiB까지 올릴 수 있어요." }
        result.write(buffer, 0, count)
    }
    val bytes = result.toByteArray()
    require(decodeNoteImage(bytes) != null) { "JPEG 또는 PNG 이미지를 선택해 주세요." }
    return bytes
}

private fun photoBytes(file: File): ByteArray {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    val longEdge = max(bounds.outWidth, bounds.outHeight)
    require(longEdge > 0) { "학습지 사진을 열 수 없어요." }
    var sample = 1
    while (longEdge / (sample * 2) >= NoteImageEdge) sample *= 2
    val image = checkNotNull(BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }))
    val orientation = ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    val matrix = Matrix()
    val scale = minOf(1f, NoteImageEdge.toFloat() / max(image.width, image.height))
    matrix.postScale(scale, scale)
    when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(-90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(-90f)
    }
    val oriented = Bitmap.createBitmap(image, 0, 0, image.width, image.height, matrix, true)
    return checkNotNull(encodeNoteImage(oriented.asImageBitmap()))
}

internal actual fun decodeNoteImage(bytes: ByteArray): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outMimeType !in listOf("image/jpeg", "image/png") || bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth.toLong() * bounds.outHeight > 25_000_000) return null
    val sample = max(1, (max(bounds.outWidth, bounds.outHeight).toFloat() / NoteImageEdge).roundToInt())
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}

internal actual fun encodeNoteImage(image: ImageBitmap): ByteArray? {
    val output = ByteArrayOutputStream()
    return if (image.asAndroidBitmap().compress(Bitmap.CompressFormat.JPEG, 92, output)) output.toByteArray() else null
}
