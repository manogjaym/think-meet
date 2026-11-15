#!/usr/bin/env node
/** Project token compiler: Node core only, deterministic, and safe for concurrent builds. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { compileAssets } from './assets.mjs'

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const outputPaths = Object.freeze({
  css: 'web/src/generated/design-tokens.css',
  kotlin: 'mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/design/generated/DesignTokens.kt',
})
const groups = Object.freeze({ color: 'Colors', spacing: 'Spacing', radius: 'Radius', fontSize: 'FontSize', typography: 'Typography', lineHeight: 'LineHeight', weight: 'Weight', layout: 'Layout', component: 'Component', opacity: 'Opacity' })
const groupTypes = Object.freeze({ color: 'color', spacing: 'dimension', radius: 'dimension', fontSize: 'fontSize', typography: 'fontSize', lineHeight: 'fontSize', weight: 'fontWeight', layout: 'dimension', component: 'dimension', opacity: 'number' })
const types = new Set(['color', 'dimension', 'fontSize', 'fontWeight', 'number'])
const tokenKey = /^[a-zA-Z][a-zA-Z0-9]*$/
const aliasPattern = /^\{([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)\}$/
const kebab = value => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const cssName = name => `--tm-${name.split('.').map(kebab).join('-')}`
const kotlinName = name => name.split('.').slice(1).map(part => part[0].toUpperCase() + part.slice(1)).join('')
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const number = value => value.toString()
const fail = message => { throw new Error(message) }

function assertKeys(value, allowed, location) {
  if (!isObject(value)) fail(`${location}: expected an object`)
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${location}: unsupported key ${key}`)
}

function flatten(source) {
  assertKeys(source, ['version', 'description', 'tokens', 'platformOverrides'], 'tokens.json')
  if (source.version !== 1) fail('tokens.json: version must be 1')
  if (!isObject(source.tokens)) fail('tokens.json: tokens must be an object')
  const flattened = new Map()
  function visit(node, segments) {
    const location = segments.join('.')
    if (!isObject(node)) fail(`${location}: expected a token or group`)
    if ('$type' in node || '$value' in node) {
      assertKeys(node, ['$type', '$value', '$description'], location)
      if (!types.has(node.$type)) fail(`${location}: unsupported $type ${node.$type}`)
      if (node.$type !== groupTypes[segments[0]]) fail(`${location}: ${segments[0]} tokens require $type ${groupTypes[segments[0]]}`)
      if (!Object.hasOwn(node, '$value')) fail(`${location}: missing $value`)
      if (node.$description !== undefined && typeof node.$description !== 'string') fail(`${location}: $description must be text`)
      if (segments.length < 2) fail(`${location}: tokens need a group and a name`)
      flattened.set(location, { type: node.$type, value: node.$value })
      return
    }
    if (!Object.keys(node).length) fail(`${location || 'tokens'}: empty group`)
    for (const [key, child] of Object.entries(node)) {
      if (!tokenKey.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail(`${location}: invalid token name ${key}`)
      if (!segments.length && !Object.hasOwn(groups, key)) fail(`Unknown token group: ${key}`)
      visit(child, [...segments, key])
    }
  }
  visit(source.tokens, [])
  return flattened
}

function normalizeColor(value, location) {
  if (typeof value === 'string' && /^#[0-9a-f]{3,4}(?:[0-9a-f]{2}){0,2}$/i.test(value)) {
    let hex = value.slice(1).toLowerCase()
    // Only CSS's exact 3/4/6/8 digit forms are accepted.
    if (![3, 4, 6, 8].includes(hex.length)) fail(`${location}: expected #RGB, #RGBA, #RRGGBB or #RRGGBBAA`)
    if (hex.length <= 4) hex = [...hex].map(char => char + char).join('')
    return `#${hex}`
  }
  if (isObject(value)) {
    assertKeys(value, ['colorSpace', 'components', 'alpha'], location)
    if (value.colorSpace !== 'srgb' || !Array.isArray(value.components) || value.components.length !== 3) fail(`${location}: color objects require srgb and three components`)
    const rgba = [...value.components, value.alpha ?? 1]
    if (rgba.some(component => typeof component !== 'number' || !Number.isFinite(component) || component < 0 || component > 1)) fail(`${location}: sRGB components and alpha must be finite numbers in [0, 1]`)
    const hex = rgba.map(component => Math.round(component * 255).toString(16).padStart(2, '0'))
    return `#${hex.slice(0, 3).join('')}${hex[3] === 'ff' ? '' : hex[3]}`
  }
  fail(`${location}: expected a hex color or an sRGB color object`)
}

function normalizeValue(type, value, location) {
  if (type === 'color') return normalizeColor(value, location)
  if (type === 'dimension' || type === 'fontSize') {
    assertKeys(value, ['value', 'unit'], location)
    const units = type === 'dimension' ? ['px', 'dp'] : ['px', 'sp', 'rem']
    if (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < 0 || !units.includes(value.unit)) fail(`${location}: expected a nonnegative ${type} in ${units.join('/')}`)
    // Rem tokens use the project's conventional 16px base, while CSS remains scalable rem.
    return { value: value.value * (value.unit === 'rem' ? 16 : 1), unit: type === 'dimension' ? 'dp' : 'sp' }
  }
  if (type === 'fontWeight') {
    if (!Number.isInteger(value) || value < 1 || value > 1000) fail(`${location}: fontWeight must be an integer in [1, 1000]`)
    return value
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${location}: expected a finite number`)
  if (location.startsWith('opacity.') && (value < 0 || value > 1)) fail(`${location}: opacity must be in [0, 1]`)
  return value
}

/** Resolve aliases independently for each platform, validating override-only failures too. */
export function resolveTokens(source, platform = 'web') {
  if (!['web', 'mobile'].includes(platform)) fail(`Unsupported platform: ${platform}`)
  const tokens = flatten(source)
  const overrides = source.platformOverrides ?? {}
  assertKeys(overrides, ['web', 'mobile'], 'platformOverrides')
  for (const [target, entries] of Object.entries(overrides)) {
    if (!isObject(entries)) fail(`platformOverrides.${target}: expected an object`)
    if (Object.keys(entries).length) fail(`Visual platform overrides are not allowed: ${target}. Web and native must resolve the same design values; use OS insets/hit-slop for platform behavior.`)
    for (const [name, override] of Object.entries(entries)) {
      if (!tokens.has(name)) fail(`platformOverrides.${target}: missing token ${name}`)
      assertKeys(override, ['$value', '$description'], `platformOverrides.${target}.${name}`)
      if (!Object.hasOwn(override, '$value')) fail(`platformOverrides.${target}.${name}: missing $value`)
      if (typeof override.$description !== 'string' || !override.$description.trim()) fail(`platformOverrides.${target}.${name}: explain the platform difference in $description`)
    }
  }
  for (const [name, override] of Object.entries(overrides[platform] ?? {})) tokens.set(name, { ...tokens.get(name), value: override.$value })
  const resolved = new Map()
  const visiting = []
  function resolve(name) {
    if (resolved.has(name)) return resolved.get(name)
    const token = tokens.get(name)
    if (!token) fail(`Missing alias target: ${name}`)
    if (visiting.includes(name)) fail(`Alias cycle (${platform}): ${[...visiting, name].join(' -> ')}`)
    visiting.push(name)
    let value
    if (typeof token.value === 'string' && aliasPattern.test(token.value)) {
      const reference = token.value.match(aliasPattern)[1]
      const target = resolve(reference)
      if (target.type !== token.type) fail(`${name}: alias type mismatch (${token.type} -> ${target.type})`)
      value = target.value
    } else value = normalizeValue(token.type, token.value, name)
    const result = { type: token.type, value }
    visiting.pop()
    resolved.set(name, result)
    return result
  }
  for (const name of [...tokens.keys()].sort()) resolve(name)
  return new Map([...resolved.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
}

function cssValue(token) {
  if (token.type === 'dimension') return `${number(token.value.value)}px`
  if (token.type === 'fontSize') return `${number(token.value.value / 16)}rem`
  return String(token.value)
}

function kotlinValue(token) {
  if (token.type === 'color') {
    const hex = token.value.slice(1)
    const argb = hex.length === 8 ? hex.slice(6) + hex.slice(0, 6) : 'ff' + hex
    return `Color(0x${argb.toUpperCase()})`
  }
  if (token.type === 'dimension') return `${number(token.value.value)}.dp`
  if (token.type === 'fontSize') return `${number(token.value.value)}.sp`
  if (token.type === 'fontWeight') return String(token.value)
  return `${number(token.value)}f`
}

/** Pure compilation: output content does not depend on cwd, clocks, locale or installed packages. */
export function compileTokens(source, aliasSource) {
  const web = resolveTokens(source, 'web')
  const mobile = resolveTokens(source, 'mobile')
  assertKeys(aliasSource, ['version', 'aliases'], 'web-aliases.json')
  if (aliasSource.version !== 1 || !isObject(aliasSource.aliases)) fail('web-aliases.json: version 1 and aliases object are required')
  const cssNames = new Set()
  const kotlinNames = new Set()
  for (const name of web.keys()) {
    const identifier = cssName(name)
    if (cssNames.has(identifier)) fail(`CSS name collision: ${identifier}`)
    cssNames.add(identifier)
    const kotlinIdentifier = `${groups[name.split('.')[0]]}.${kotlinName(name)}`
    if (kotlinNames.has(kotlinIdentifier)) fail(`Kotlin name collision: ${kotlinIdentifier}`)
    kotlinNames.add(kotlinIdentifier)
  }
  const css = ['/* Generated by design/scripts/generate.mjs. Edit design/tokens.json, not this file. */', ':root {']
  for (const [name, token] of web) css.push(`  ${cssName(name)}: ${cssValue(token)};`)
  css.push('', '  /* Existing web variables remain stable while their values come from shared tokens. */')
  for (const name of Object.keys(aliasSource.aliases).sort()) {
    if (!/^--[a-z][a-z0-9-]*$/.test(name) || name.startsWith('--tm-')) fail(`Invalid or reserved CSS alias: ${name}`)
    const target = aliasSource.aliases[name]
    if (typeof target !== 'string' || !web.has(target)) fail(`${name}: missing token ${target}`)
    css.push(`  ${name}: var(${cssName(target)});`)
  }
  css.push('}', '')
  const kotlin = [
    '// Generated by design/scripts/generate.mjs. Edit design/tokens.json, not this file.',
    'package com.woongjin.thinkmeet.design.generated', '',
    'import androidx.compose.ui.graphics.Color',
    'import androidx.compose.ui.unit.dp',
    'import androidx.compose.ui.unit.sp', '',
    '/** Canonical web design values, identical on Android and iOS. */',
    'object DesignTokens {',
  ]
  for (const [group, objectName] of Object.entries(groups)) {
    const entries = [...mobile].filter(([name]) => name.startsWith(`${group}.`))
    if (!entries.length) continue
    kotlin.push(`    object ${objectName} {`)
    for (const [name, token] of entries) kotlin.push(`        val ${kotlinName(name)} = ${kotlinValue(token)}`)
    kotlin.push('    }', '')
  }
  kotlin.pop()
  kotlin.push('}', '')
  return new Map([[outputPaths.css, css.join('\n')], [outputPaths.kotlin, kotlin.join('\n')]])
}

/** --check never writes. Normal generation replaces only stale files, atomically per file. */
export async function syncGenerated(outputs, { outDir = repositoryRoot, check = false } = {}) {
  const stale = []
  for (const [relative, expected] of outputs) {
    const target = path.resolve(outDir, relative)
    if (!target.startsWith(`${path.resolve(outDir)}${path.sep}`)) fail(`Output escapes destination: ${relative}`)
    let actual
    try { actual = await fs.readFile(target) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const bytes = typeof expected === 'string' ? Buffer.from(expected) : expected
    if (actual?.equals(bytes)) continue
    stale.push(relative)
    if (check) continue
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' })
      await fs.rename(temporary, target)
    } finally { await fs.rm(temporary, { force: true }) }
  }
  return stale
}

export async function main(args = process.argv.slice(2)) {
  let check = false
  let outDir = repositoryRoot
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check') check = true
    else if (args[index] === '--out-dir' && args[index + 1] && !args[index + 1].startsWith('--')) outDir = path.resolve(args[++index])
    else fail(`Unknown argument: ${args[index]}. Usage: node design/scripts/generate.mjs [--check] [--out-dir directory]`)
  }
  const [source, aliases] = await Promise.all(['tokens.json', 'web-aliases.json'].map(async name => JSON.parse(await fs.readFile(path.join(repositoryRoot, 'design', name), 'utf8'))))
  const layout = Object.fromEntries([...resolveTokens(source)].filter(([name]) => name.startsWith('layout.')).map(([name, token]) => [name.slice('layout.'.length), token.value.value]))
  const colors = Object.fromEntries([...resolveTokens(source)].filter(([name]) => name.startsWith('color.')).map(([name, token]) => [name.slice('color.'.length), token.value]))
  const outputs = new Map([...compileTokens(source, aliases), ...await compileAssets(source, layout, colors)])
  const stale = await syncGenerated(outputs, { outDir, check })
  if (check && stale.length) fail(`Generated design tokens are missing or stale:\n${stale.map(name => `  ${name}`).join('\n')}\nRun: node design/scripts/generate.mjs`)
  if (!check && stale.length) process.stdout.write(`Generated ${stale.length} design token file(s).\n`)
  return stale
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
