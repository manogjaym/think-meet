import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { compileTokens, outputPaths, resolveTokens, syncGenerated } from '../scripts/generate.mjs'
import { primitivePath } from '../scripts/assets.mjs'

const leaf = ($type, $value) => ({ $type, $value })
const fixture = () => ({
  version: 1,
  tokens: {
    color: { primary: leaf('color', '#533afd'), muted: leaf('color', '#61718a'), accent: leaf('color', '{color.primary}') },
    spacing: { s8: leaf('dimension', { value: 8, unit: 'px' }) },
    fontSize: { s16: leaf('fontSize', { value: 1, unit: 'rem' }) },
  },
})
const aliases = { version: 1, aliases: { '--accent': 'color.accent', '--muted': 'color.muted' } }

test('rounded rect inherits an omitted SVG radius from the other axis', () => {
  const expected = 'M7 10H17a2 2 0 0 1 2 2V19a2 2 0 0 1 -2 2H7a2 2 0 0 1 -2 -2V12a2 2 0 0 1 2 -2Z'
  assert.deepEqual([{ rx: '2' }, { ry: '2' }].map(radius => primitivePath({ type: 'rect', attributes: { x: '5', y: '10', width: '14', height: '11', ...radius } })), [expected, expected])
})

test('aliases and typed color/unit conversion produce identical canonical values', () => {
  const source = fixture()
  source.tokens.color.alpha = leaf('color', { colorSpace: 'srgb', components: [1, 0, 0], alpha: .5 })
  source.tokens.color.short = leaf('color', '#abcd')
  const result = compileTokens(source, aliases)
  const css = result.get(outputPaths.css)
  const kotlin = result.get(outputPaths.kotlin)
  assert.match(css, /--tm-color-muted: #61718a;/)
  assert.match(kotlin, /val Muted = Color\(0xFF61718A\)/)
  assert.match(css, /--tm-color-accent: #533afd;/)
  assert.match(css, /--accent: var\(--tm-color-accent\);/)
  assert.match(css, /--tm-color-alpha: #ff000080;/)
  assert.match(kotlin, /val Alpha = Color\(0x80FF0000\)/)
  assert.match(kotlin, /val Short = Color\(0xDDAABBCC\)/)
  assert.match(css, /--tm-font-size-s16: 1rem;/)
  assert.match(kotlin, /val S16 = 16.sp/)
  assert.match(kotlin, /val S8 = 8.dp/)
  // JSON insertion order cannot affect committed generated output.
  const reversed = structuredClone(source)
  reversed.tokens = Object.fromEntries(Object.entries(reversed.tokens).reverse())
  reversed.tokens.color = Object.fromEntries(Object.entries(reversed.tokens.color).reverse())
  assert.deepEqual(compileTokens(reversed, aliases), result)
  const changed = structuredClone(source)
  changed.tokens.color.primary.$value = '#1248ab'
  const regenerated = compileTokens(changed, aliases)
  assert.match(regenerated.get(outputPaths.css), /--tm-color-primary: #1248ab;/)
  assert.match(regenerated.get(outputPaths.css), /--tm-color-accent: #1248ab;/)
  assert.match(regenerated.get(outputPaths.kotlin), /val Primary = Color\(0xFF1248AB\)/)
  assert.match(regenerated.get(outputPaths.kotlin), /val Accent = Color\(0xFF1248AB\)/)
  assert.match(regenerated.get(outputPaths.kotlin), /val Muted = Color\(0xFF61718A\)/)
})

test('missing aliases, cycles, type mismatches and malformed overrides fail before output', () => {
  let source = fixture()
  source.tokens.color.accent.$value = '{color.absent}'
  assert.throws(() => compileTokens(source, aliases), /Missing alias target: color.absent/)
  source = fixture()
  source.tokens.color.primary.$value = '{color.accent}'
  assert.throws(() => compileTokens(source, aliases), /Alias cycle/)
  source = fixture()
  source.tokens.color.accent.$value = '{spacing.s8}'
  assert.throws(() => compileTokens(source, aliases), /alias type mismatch/)
  source = fixture()
  source.platformOverrides = { mobile: {} }
  source.platformOverrides.mobile['color.primary'] = { $value: '{color.accent}', $description: 'An invalid native-only cycle.' }
  assert.throws(() => compileTokens(source, aliases), /Visual platform overrides are not allowed/)
  source = fixture()
  source.tokens.spacing.s8.$value.unit = 'rem'
  assert.throws(() => resolveTokens(source), /expected a nonnegative dimension/)
  source = fixture()
  source.tokens.color.primary.$type = 'dimension'
  assert.throws(() => compileTokens(source, aliases), /color tokens require \$type color/)
  assert.throws(() => compileTokens(fixture(), { version: 1, aliases: { '--missing': 'color.absent' } }), /missing token/)
})

test('check detects missing/stale files without writing; generation is atomic and write-if-changed', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'thinkmeet-design-tokens-'))
  try {
    const outputs = compileTokens(fixture(), aliases)
    assert.deepEqual(await syncGenerated(outputs, { outDir: directory, check: true }), [...outputs.keys()])
    assert.deepEqual(await fs.readdir(directory), [])
    await Promise.all([syncGenerated(outputs, { outDir: directory }), syncGenerated(outputs, { outDir: directory })])
    assert.deepEqual(await syncGenerated(outputs, { outDir: directory, check: true }), [])
    const target = path.join(directory, outputPaths.css)
    const initial = await fs.stat(target)
    assert.deepEqual(await syncGenerated(outputs, { outDir: directory }), [])
    assert.equal((await fs.stat(target)).mtimeMs, initial.mtimeMs)
    await fs.writeFile(target, 'stale content\n')
    assert.deepEqual(await syncGenerated(outputs, { outDir: directory, check: true }), [outputPaths.css])
    assert.equal(await fs.readFile(target, 'utf8'), 'stale content\n')
    await syncGenerated(outputs, { outDir: directory })
    assert.equal(await fs.readFile(target, 'utf8'), outputs.get(outputPaths.css))
    assert.deepEqual((await fs.readdir(path.dirname(target))).filter(name => name.endsWith('.tmp')), [])
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
