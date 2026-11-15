package com.woongjin.thinkmeet.platform

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.utils.io.jvm.javaio.toByteReadChannel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object AndroidPlatform { lateinit var context: Context }
actual fun platformName() = "Android"
actual fun clientPlatformId() = "android"
actual fun createHttpClient(): HttpClient = HttpClient(OkHttp) { configureThinkMeet() }

private object ProtectedPreferences {
    private val prefs get() = AndroidPlatform.context.getSharedPreferences("thinkmeet", Context.MODE_PRIVATE)
    private val key: SecretKey by lazy {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("thinkmeet.session", null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder("thinkmeet.session", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generateKey()
        }
    }
    fun read(name: String, fallback: String): String {
        val value = prefs.getString(name, null) ?: return fallback
        if (!name.startsWith("session:")) return value
        return runCatching {
            val parts = value.split(':', limit = 2)
            Cipher.getInstance("AES/GCM/NoPadding").run {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
                String(doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
            }
        }.getOrElse { prefs.edit().remove(name).apply(); fallback }
    }
    fun write(name: String, value: String) {
        if (value.isEmpty()) { prefs.edit().remove(name).apply(); return }
        val encoded = if (name.startsWith("session:")) Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.ENCRYPT_MODE, key)
            val bytes = doFinal(value.toByteArray())
            Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(bytes, Base64.NO_WRAP)
        } else value
        prefs.edit().putString(name, encoded).apply()
    }
}
actual fun readPreference(key: String, fallback: String) = ProtectedPreferences.read(key, fallback)
actual fun writePreference(key: String, value: String) = ProtectedPreferences.write(key, value)
actual fun shareLink(url: String) {
    val intent = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url) }
    AndroidPlatform.context.startActivity(Intent.createChooser(intent, "수업 초대 링크").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
actual fun copyText(text: String) {
    (AndroidPlatform.context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("수업 링크", text))
}
@Composable actual fun BackHandler(enabled: Boolean, onBack: () -> Unit) = androidx.activity.compose.BackHandler(enabled, onBack)

@Composable actual fun rememberFilePicker(onResult: (PickedFile?) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val latest by rememberUpdatedState(onResult)
    var pickerPip by remember { mutableStateOf<AndroidPictureInPictureController?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        pickerPip?.endTransientInteraction(); pickerPip = null
        if (uri == null) latest(null) else scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                var name = "자료"
                var size = -1L
                context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
                    if (it.moveToFirst()) { name = it.getString(0); size = if (it.isNull(1)) -1 else it.getLong(1) }
                }
                val mime = context.contentResolver.getType(uri) ?: if (name.endsWith(".pdf", true)) "application/pdf" else "video/mp4"
                val limit = if (mime == "application/pdf") 50L * 1024 * 1024 else 500L * 1024 * 1024
                require(size <= limit && size != 0L) { "PDF 50MB, MP4 500MB까지 선택할 수 있어요." }
                var temporary: java.io.File? = null
                if (size < 0) {
                    // Some cloud providers omit SIZE. Spool once with a bounded buffer to determine it safely.
                    val target = java.io.File.createTempFile("lesson-upload-", ".tmp", context.cacheDir)
                    try {
                        size = 0
                        context.contentResolver.openInputStream(uri)?.use { source -> target.outputStream().use { output ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val count = source.read(buffer); if (count < 0) break
                                size += count; require(size <= limit) { "자료의 크기가 업로드 제한을 넘었어요." }
                                output.write(buffer, 0, count)
                            }
                        } } ?: error("파일을 읽지 못했어요.")
                        require(size > 0) { "빈 파일은 업로드할 수 없어요." }
                        temporary = target
                    } catch (error: Throwable) { target.delete(); throw error }
                }
                PickedFile(name, size, mime, openChannel = {
                    // Stream from the document provider: never hold a 500MB video in the app heap.
                    val source = temporary?.inputStream() ?: context.contentResolver.openInputStream(uri) ?: error("파일을 읽지 못했어요.")
                    source.toByteReadChannel()
                }, release = { temporary?.delete() })
            } }
            result.onFailure { android.widget.Toast.makeText(context, it.message ?: "자료를 읽지 못했어요.", android.widget.Toast.LENGTH_LONG).show() }
            latest(result.getOrNull())
        }
    }
    DisposableEffect(Unit) { onDispose { pickerPip?.endTransientInteraction() } }
    return remember(launcher) { {
        pickerPip = context.findMainActivity()?.pictureInPictureController
        pickerPip?.beginTransientInteraction()
        try { launcher.launch(arrayOf("application/pdf", "video/mp4")) }
        catch (error: RuntimeException) { pickerPip?.endTransientInteraction(); pickerPip = null; throw error }
    } }
}
