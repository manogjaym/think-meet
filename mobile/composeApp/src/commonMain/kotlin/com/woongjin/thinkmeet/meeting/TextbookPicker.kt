package com.woongjin.thinkmeet.meeting

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import com.woongjin.thinkmeet.data.Material
import com.woongjin.thinkmeet.data.Share
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.design.DesignButton
import com.woongjin.thinkmeet.design.DesignIcon
import com.woongjin.thinkmeet.design.DesignWeight
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import com.woongjin.thinkmeet.platform.TextbookPreview
import com.woongjin.thinkmeet.platform.openTextbookPreview
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

private data class TextbookSelection(val id: String, val page: Int)

@Composable
internal fun ColumnScope.TextbookPicker(
    api: ThinkMeetApi,
    materials: List<Material>,
    share: Share?,
    busy: Boolean,
    connected: Boolean,
    unclassifiedTag: Boolean = false,
    onOpen: (Material, Int) -> Unit,
    onDelete: (Material) -> Unit,
) {
    var selection by remember { mutableStateOf<TextbookSelection?>(null) }
    val material = materials.firstOrNull { it.id == selection?.id }
        ?: materials.firstOrNull { it.id == share?.materialId } ?: materials.firstOrNull()
    if (material == null) {
        TextbookNotice(DesignContent.TextbookEmpty)
        return
    }
    val page = selection?.takeIf { it.id == material.id }?.page
        ?: share?.takeIf { it.materialId == material.id }?.page ?: 1
    var expanded by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
            OutlinedButton(onClick = { expanded = true }, enabled = !busy, shape = RoundedCornerShape(Corner.R8),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = DesignContent.TextbookSelect }) {
                Text(material.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelMedium)
                if (unclassifiedTag && material.subject == null) SubjectUnclassifiedTag(Modifier.padding(horizontal = Space.S4))
                DesignIcon("chevron", Modifier.size(Space.S16).rotate(90f), Palette.Muted)
            }
            DropdownMenu(expanded, onDismissRequest = { expanded = false }, modifier = Modifier.heightIn(max = Space.S96 * 3)) {
                materials.forEach { item ->
                    DropdownMenuItem(
                        text = {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
                                Text(item.name, Modifier.weight(1f, fill = false), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                if (unclassifiedTag && item.subject == null) SubjectUnclassifiedTag()
                            }
                        },
                        onClick = {
                            if (item.id != material.id) selection = TextbookSelection(item.id, 1)
                            expanded = false
                        },
                    )
                }
            }
        }
        IconButton(onClick = { onDelete(material) }, enabled = !busy && share?.materialId != material.id) {
            DesignIcon("trash", Modifier.size(Space.S17), if (share?.materialId == material.id) Palette.Line else Palette.MeetingWeak, "${material.name} 삭제")
        }
    }
    key(material.id) {
        var attempt by remember { mutableIntStateOf(0) }
        key(attempt) {
            TextbookPages(api, material, page, busy, connected,
                onSelect = { selection = TextbookSelection(material.id, it) },
                onOpen = { selection = TextbookSelection(material.id, it); onOpen(material, it) },
                onRetry = { attempt++ })
        }
    }
}

@Composable
private fun ColumnScope.TextbookPages(
    api: ThinkMeetApi,
    material: Material,
    page: Int,
    busy: Boolean,
    connected: Boolean,
    onSelect: (Int) -> Unit,
    onOpen: (Int) -> Unit,
    onRetry: () -> Unit,
) {
    val rendering = remember { Mutex() }
    var preview by remember { mutableStateOf<TextbookPreview?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(api, material.id) {
        var opened: TextbookPreview? = null
        try {
            withContext(Dispatchers.Default) {
                opened = openTextbookPreview(api.downloadMaterial(material.id))
            }
            preview = opened
            awaitCancellation()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        } finally {
            withContext(NonCancellable + Dispatchers.Default) {
                rendering.withLock { opened?.close() }
            }
        }
    }
    val current = preview
    val count = minOf(current?.pageCount ?: 0, material.pages ?: 1)
    val selected = page.coerceIn(1, count.coerceAtLeast(1))
    if (failed) TextbookRetry(DesignContent.TextbookPreviewError, onRetry)
    if (current == null && !failed) TextbookNotice(DesignContent.TextbookPreviewLoading)
    if (current != null) {
        val grid = rememberLazyGridState(initialFirstVisibleItemIndex = ((selected - 1) / 2) * 2)
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val thumbnailHeight = (maxHeight - Space.S32).coerceIn(Space.S32, Space.S96)
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                state = grid,
                modifier = Modifier.fillMaxSize().testTag("textbook-pages"),
                horizontalArrangement = Arrangement.spacedBy(Space.S8),
                verticalArrangement = Arrangement.spacedBy(Space.S8),
            ) {
                items(count, key = { it + 1 }) { index ->
                    val number = index + 1
                    TextbookPage(current, rendering, number, thumbnailHeight, selected == number, !busy,
                        { onSelect(number) }, { failed = true })
                }
            }
        }
    } else Spacer(Modifier.weight(1f))
    DesignButton(
        DesignContent.TextbookOpenPage.replace("{page}", selected.toString()),
        onClick = { onOpen(selected) }, modifier = Modifier.fillMaxWidth(),
        enabled = count > 0 && connected && !busy,
    )
}

@Composable
private fun TextbookPage(
    preview: TextbookPreview,
    rendering: Mutex,
    page: Int,
    height: Dp,
    selected: Boolean,
    enabled: Boolean,
    onSelect: () -> Unit,
    onError: () -> Unit,
) {
    var bitmap by remember(preview, page) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(preview, page) {
        try {
            bitmap = withContext(Dispatchers.Default) { rendering.withLock { preview.render(page) } }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            onError()
        }
    }
    val shape = RoundedCornerShape(Corner.R8)
    val label = DesignContent.TextbookPage.replace("{page}", page.toString())
    Column(
        Modifier.fillMaxWidth().background(if (selected) Palette.Selection else Palette.White, shape)
            .border(if (selected) Space.S2 else Space.S1, if (selected) Palette.Primary else Palette.Line, shape)
            .selectable(selected, enabled = enabled, role = Role.Button, onClick = onSelect).padding(Space.S4),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.S4),
    ) {
        Box(Modifier.fillMaxWidth().height(height).background(Palette.MeetingSubtle, RoundedCornerShape(Corner.R4))) {
            bitmap?.let { Image(it, contentDescription = null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
        }
        Text(label,
            color = if (selected) Palette.PrimaryPressed else Palette.TextSecondary,
            style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f),
            fontWeight = if (selected) DesignWeight.SemiBold else DesignWeight.Medium)
    }
}

/** Marks a material without a subject while the lesson lists its subject's materials. */
@Composable
internal fun SubjectUnclassifiedTag(modifier: Modifier = Modifier) {
    Text(DesignContent.SubjectUnclassified, modifier.background(Palette.MeetingSubtle, RoundedCornerShape(Corner.R4))
        .padding(horizontal = Space.S6, vertical = Space.S2),
        color = Palette.Muted, maxLines = 1,
        style = MaterialTheme.typography.labelSmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
}

@Composable
internal fun TextbookNotice(message: String) {
    Text(message, Modifier.fillMaxWidth().background(Palette.MeetingSubtle, RoundedCornerShape(Corner.R8)).padding(Space.S12),
        color = Palette.Muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
}

@Composable
internal fun TextbookRetry(message: String, onRetry: () -> Unit) {
    Text(message, color = Palette.Danger, style = MaterialTheme.typography.bodySmall)
    TextButton(onClick = onRetry) { Text(DesignContent.TextbookRetry) }
}
