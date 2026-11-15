/** Shared vector/copy/font outputs. Source geometry is extracted unchanged from the canonical web. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const base = 'mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/design/generated/'
const resources = 'mobile/composeApp/src/commonMain/composeResources/font/'
const quote = value => JSON.stringify(value).replaceAll('$', '\\$')
const number = value => Number(value).toString()

/** Convert SVG primitives exactly to paths; all paths retain the web's 24×24 coordinate system. */
export function primitivePath({ type, attributes: a }) {
  if (type === 'path') return a.d
  if (type === 'circle' || type === 'ellipse') {
    const cx = Number(a.cx), cy = Number(a.cy), rx = Number(a.rx ?? a.r), ry = Number(a.ry ?? a.r)
    return `M${number(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`
  }
  if (type === 'rect') {
    const x = Number(a.x), y = Number(a.y), w = Number(a.width), h = Number(a.height)
    const rx = Math.min(Number(a.rx ?? a.ry ?? 0), w / 2), ry = Math.min(Number(a.ry ?? a.rx ?? 0), h / 2)
    if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`
    return `M${x + rx} ${y}H${x + w - rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}V${y + h - ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}H${x + rx}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}V${y + ry}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`
  }
  throw Error(`Unsupported shared SVG primitive: ${type}`)
}

export function compileVectors(vectors) {
  if (vectors.version !== 1 || vectors.brand.viewBox !== '0 0 24 24' || vectors.brand.paths.length !== 2) throw Error('Invalid shared vector source')
  const output = new Map()
  const style = vectors.iconStyle
  const caps = { round: 'Round', butt: 'Butt', square: 'Square' }, joins = { round: 'Round', miter: 'Miter', bevel: 'Bevel' }
  if (style?.viewBox !== '0 0 24 24' || style.fill !== 'none' || style.stroke !== 'currentColor' || !caps[style.strokeLinecap] || !joins[style.strokeLinejoin] || typeof style.strokeWidth !== 'number' || style.strokeWidth <= 0) throw Error('Invalid shared monochrome icon style')
  output.set('web/src/generated/design-vectors.ts', `// Generated from design/assets/vectors.json.\nexport type SharedVectorPart = { type: string; attributes: Record<string, string> };\nexport const designIcons: Record<string, SharedVectorPart[]> = ${JSON.stringify(vectors.icons, null, 2)};\nexport const brandPaths = ${JSON.stringify(vectors.brand.paths)};\nexport const iconStyle = ${JSON.stringify(style)} as const;\n`)
  const kt = ['// Generated from design/assets/vectors.json. Do not edit.', 'package com.woongjin.thinkmeet.design.generated', '',
    'import androidx.compose.ui.graphics.Color', 'import androidx.compose.ui.graphics.SolidColor', 'import androidx.compose.ui.graphics.StrokeCap', 'import androidx.compose.ui.graphics.StrokeJoin',
    'import androidx.compose.ui.graphics.vector.ImageVector', 'import androidx.compose.ui.graphics.vector.PathParser', 'import androidx.compose.ui.unit.dp', '', 'object DesignVectors {']
  const all = { brand: vectors.brand.paths.map(d => ({ type: 'path', attributes: { d, fill: 'currentColor', stroke: 'none' } })), ...vectors.icons }
  for (const [name, parts] of Object.entries(all)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name) || !parts.length) throw Error(`Invalid shared icon: ${name}`)
    kt.push(`    private val ${name} by lazy {`, `        ImageVector.Builder(name = ${quote(name)}, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f).apply {`)
    for (const part of parts) {
      const allowed = { path: ['d', 'fill', 'stroke'], circle: ['cx', 'cy', 'r', 'fill', 'stroke'], ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke'] }[part.type]
      if (!allowed || Object.keys(part.attributes).some(key => !allowed.includes(key)) || ['fill', 'stroke'].some(key => part.attributes[key] && !['none', 'currentColor'].includes(part.attributes[key]))) throw Error(`Unsupported shared SVG attributes in ${name}; extend both renderers before changing the asset`)
      const fill = part.attributes.fill === 'currentColor' ? 'SolidColor(Color.Black)' : 'null'
      const stroke = part.attributes.stroke === 'none' ? 'null' : 'SolidColor(Color.Black)'
      kt.push(`            addPath(pathData = PathParser().parsePathString(${quote(primitivePath(part))}).toNodes(), fill = ${fill}, stroke = ${stroke}, strokeLineWidth = ${style.strokeWidth}f, strokeLineCap = StrokeCap.${caps[style.strokeLinecap]}, strokeLineJoin = StrokeJoin.${joins[style.strokeLinejoin]})`)
    }
    kt.push('        }.build()', '    }')
  }
  kt.push('    fun icon(name: String): ImageVector = when (name) {')
  for (const name of Object.keys(all)) kt.push(`        ${quote(name)} -> ${name}`)
  kt.push('        else -> error("Unknown shared icon: $name")', '    }', '}', '')
  output.set(base + 'DesignVectors.kt', kt.join('\n'))
  return output
}

export function compileContent(system, tokenSource) {
  if (system.version !== 1 || !system.copy || !system.screens) throw Error('Invalid design/system.json')
  for (const [screen, spec] of Object.entries(system.screens)) {
    if (!spec.sections?.length || !spec.web?.startsWith('web/') || !spec.native?.startsWith('mobile/')) throw Error(`Invalid screen contract: ${screen}`)
    for (const token of spec.layout) {
      const [group, name] = token.split('.')
      if (!tokenSource.tokens[group]?.[name]) throw Error(`Screen ${screen}: missing design token ${token}`)
    }
  }
  const lines = ['// Generated from design/system.json.', 'package com.woongjin.thinkmeet.design.generated', '', 'object DesignContent {']
  for (const [key, value] of Object.entries(system.copy)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(key) || typeof value !== 'string') throw Error(`Invalid shared copy: ${key}`)
    lines.push(`    const val ${key[0].toUpperCase() + key.slice(1)} = ${quote(value)}`)
  }
  lines.push('}', '')
  return new Map([
    ['web/src/generated/design-content.ts', `// Generated from design/system.json.\nexport const designContent = ${JSON.stringify(system.copy, null, 2)} as const;\nexport const screenContract = ${JSON.stringify(system.screens, null, 2)} as const;\n`],
    [base + 'DesignContent.kt', lines.join('\n')],
  ])
}

export async function compileAssets(tokenSource, resolvedLayout, resolvedColors) {
  const read = file => fs.readFile(path.join(root, 'design', file), 'utf8').then(JSON.parse)
  const [vectors, system, fonts] = await Promise.all(['assets/vectors.json', 'system.json', 'fonts/manifest.json'].map(read))
  const output = new Map([...compileVectors(vectors), ...compileContent(system, tokenSource)])
  output.set('web/src/generated/design-layout.json', JSON.stringify(resolvedLayout, null, 2) + '\n')
  output.set('web/src/generated/design-palette.ts', `// Generated from design/tokens.json.\nexport const avatarColors = ${JSON.stringify(['avatarSage', 'avatarClay', 'avatarSlate', 'avatarGold', 'avatarBlue'].map(name => resolvedColors[name]))} as const;\n`)
  for (const spec of Object.values(system.screens)) for (const file of [spec.web, spec.native]) await fs.access(path.join(root, file))
  if (fonts.version !== 1 || fonts.family !== 'Pretendard Variable' || fonts.files.map(f => f.weight).join(',') !== '400,500,600,700') throw Error('Shared font manifest must define Pretendard 400/500/600/700')
  const css = ['/* Generated from design/fonts/manifest.json. Same release and weights are bundled in Compose. */']
  const kt = ['// Generated from design/fonts/manifest.json.', 'package com.woongjin.thinkmeet.design.generated', '', 'import androidx.compose.runtime.Composable', 'import androidx.compose.runtime.remember', 'import androidx.compose.ui.text.font.FontFamily', 'import androidx.compose.ui.text.font.FontWeight', 'import org.jetbrains.compose.resources.Font', 'import thinkmeetmobile.composeapp.generated.resources.*', '', '@Composable', 'fun sharedFontFamily(): FontFamily {']
  const fontVars = []
  for (const entry of fonts.files) {
    for (const [key, hashKey, destination] of [['nativeFile', 'nativeSha256', resources + `pretendard_${entry.name.toLowerCase()}.otf`], ['webFile', 'webSha256', 'web/public/design/fonts/' + entry.webFile]]) {
      if (!/^Pretendard-[A-Za-z]+\.(otf|woff2)$/.test(entry[key])) throw Error('Invalid shared font filename')
      const bytes = await fs.readFile(path.join(root, 'design/fonts', entry[key]))
      if (createHash('sha256').update(bytes).digest('hex') !== entry[hashKey]) throw Error(`Shared font checksum mismatch: ${entry[key]}`)
      output.set(destination, bytes)
    }
    css.push(`@font-face { font-family: '${fonts.family}'; font-style: normal; font-weight: ${entry.weight}; font-display: swap; src: url('/design/fonts/${entry.webFile}?v=${entry.webSha256.slice(0, 12)}') format('woff2'); }`)
    const name = entry.name.toLowerCase(); fontVars.push(name)
    kt.push(`    val ${name} = Font(Res.font.pretendard_${name}, weight = FontWeight(${entry.weight}))`)
  }
  kt.push(`    return remember(${fontVars.join(', ')}) { FontFamily(${fontVars.join(', ')}) }`, '}', '')
  output.set('web/src/generated/design-fonts.css', css.join('\n') + '\n')
  output.set(base + 'SharedFonts.kt', kt.join('\n'))
  const license = await fs.readFile(path.join(root, 'design/fonts/LICENSE.txt'))
  output.set('web/public/design/fonts/LICENSE.txt', license)
  output.set('mobile/composeApp/src/commonMain/composeResources/files/Pretendard-LICENSE.txt', license)
  return output
}
