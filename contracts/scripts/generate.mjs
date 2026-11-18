#!/usr/bin/env node
/** Project-specific, dependency-free OpenAPI/Socket.IO model compiler. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ktBase = 'mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/data/generated/'
const targets = ['web/src/generated/', 'server/src/generated/']
const quote = JSON.stringify
const ktQuote = s => quote(s).replaceAll('$', '\\$')
const own = (o, k) => Object.hasOwn(o, k)
const refName = s => s.$ref?.replace('#/components/schemas/', '') ?? (s.allOf?.length === 1 ? refName(s.allOf[0]) : undefined)
const pascal = s => s.split(/[.:-]/).map(x => x[0].toUpperCase() + x.slice(1)).join('')
const fail = message => { throw new Error(message) }

export async function readSources() {
  const [api, realtime, catalog] = await Promise.all(['contracts/openapi.json', 'contracts/realtime.json', 'features/catalog.json'].map(async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'))))
  return { api, realtime, catalog }
}

export function validateSources({ api, realtime, catalog }) {
  if (api.openapi !== '3.0.3' || !Number.isSafeInteger(api['x-contract-revision']) || api['x-contract-revision'] < 1) fail('OpenAPI requires 3.0.3 and a positive x-contract-revision')
  if (api.servers?.[0]?.url !== '/api/v1' || realtime.version !== 1 || realtime.path !== '/socket.io') fail('Unexpected REST/Socket base path; use a versioned migration')
  if (!['platform', 'revision'].every(key => /^[A-Za-z][A-Za-z0-9-]+$/.test(realtime.handshake?.headers?.[key] ?? ''))) fail('Capability header names must be defined in realtime.handshake.headers')
  const schemas = api.components?.schemas ?? {}
  function schema(s, location) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) fail(`Invalid schema: ${location}`)
    if (s.$ref && (!s.$ref.startsWith('#/components/schemas/') || !schemas[refName(s)])) fail(`Unknown schema reference: ${location}`)
    if (s.oneOf) s.oneOf.forEach((v, i) => schema(v, `${location}.oneOf.${i}`))
    else if (s.allOf) {
      if (s.allOf.length !== 1 || !refName(s)) fail(`Only a single nullable/default reference wrapper is supported: ${location}`)
      s.allOf.forEach(v => schema(v, location))
    } else if (!s.$ref) {
      if (!['object', 'array', 'string', 'integer', 'number', 'boolean'].includes(s.type)) fail(`Unsupported schema type: ${location}`)
      if (s.type === 'array') schema(s.items, `${location}.items`)
      for (const [key, property] of Object.entries(s.properties ?? {})) {
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) fail(`Unsupported property name: ${location}.${key}`)
        schema(property, `${location}.${key}`)
      }
      if (s.additionalProperties && typeof s.additionalProperties === 'object') schema(s.additionalProperties, `${location}.additionalProperties`)
      if ((s.required ?? []).some(k => !own(s.properties ?? {}, k))) fail(`Unknown required property: ${location}`)
    }
  }
  for (const [name, s] of Object.entries(schemas)) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) fail(`Invalid model name: ${name}`)
    schema(s, name)
  }
  const featureIds = new Set()
  if (catalog.version !== 1 || !Array.isArray(catalog.features)) fail('Invalid feature catalog')
  for (const f of catalog.features) {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(f.id) || featureIds.has(f.id)) fail(`Invalid/duplicate feature: ${f.id}`)
    featureIds.add(f.id)
    if (!['baseline', 'planned', 'in-progress', 'ready'].includes(f.stage) || !Number.isSafeInteger(f.requiresRevision) || f.requiresRevision < 0 || f.requiresRevision > api['x-contract-revision'] || typeof f.defaultEnabled !== 'boolean') fail(`Invalid feature rollout: ${f.id}`)
    if (f.stage === 'baseline' ? f.requiresRevision !== 0 : f.requiresRevision < 1) fail(`New features require a contract revision: ${f.id}`)
    if (!Array.isArray(f.platforms) || !f.platforms.length || new Set(f.platforms).size !== f.platforms.length || f.platforms.some(p => !['web', 'android', 'ios'].includes(p))) fail(`Invalid feature platforms: ${f.id}`)
    const implemented = f.stage !== 'planned' && ['done', 'not-applicable'].includes(f.implementation?.server?.status) && f.platforms.every(p => f.implementation?.[p]?.status === 'done')
    if (f.defaultEnabled !== implemented) fail(`Feature availability must match implementation status: ${f.id}`)
  }
  const operations = [], ids = new Set()
  for (const [route, methods] of Object.entries(api.paths)) for (const [method, operation] of Object.entries(methods)) {
    if (!['get', 'post', 'patch', 'delete', 'put', 'head', 'options'].includes(method)) fail(`Unsupported path item: ${route}.${method}`)
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(operation.operationId) || ids.has(operation.operationId)) fail(`Invalid/duplicate operation ID: ${operation.operationId}`)
    ids.add(operation.operationId)
    if (operation['x-feature'] && !featureIds.has(operation['x-feature'])) fail(`Unknown operation feature: ${operation.operationId}`)
    operations.push({ id: operation.operationId, method: method.toUpperCase(), path: '/api/v1' + route, ...(operation['x-feature'] && !operation['x-cleanup'] ? { feature: operation['x-feature'] } : {}), ...(operation['x-cleanup'] ? { cleanup: true } : {}) })
    for (const parameter of operation.parameters ?? []) schema(parameter.schema, `${operation.operationId}.parameters.${parameter.name}`)
    for (const content of Object.values(operation.requestBody?.content ?? {})) schema(content.schema, `${operation.operationId}.requestBody`)
    for (const response of Object.values(operation.responses ?? {})) for (const content of Object.values(response.content ?? {})) schema(content.schema, `${operation.operationId}.response`)
  }
  for (const [event, spec] of Object.entries(realtime.events)) {
    if (!['client', 'server', 'bidirectional'].includes(spec.direction) || (spec.schema && !schemas[spec.schema]) || (spec.ack && !schemas[spec.ack]) || (spec.feature && !featureIds.has(spec.feature))) fail(`Invalid realtime event: ${event}`)
  }
  for (const [command, spec] of Object.entries(realtime.commands)) if (!schemas[spec.payload] || !featureIds.has(spec.feature)) fail(`Invalid command: ${command}`)
  return operations
}

function tsType(s) {
  let type
  const ref = refName(s)
  if (ref) type = ref
  else if (s.oneOf) type = s.oneOf.map(tsType).join(' | ')
  else if (s.enum) type = s.enum.map(quote).join(' | ')
  else if (s.type === 'array') type = `Array<${tsType(s.items)}>`
  else if (s.type === 'object') {
    if (s.properties) type = Object.keys(s.properties).length ? `{ ${Object.entries(s.properties).map(([k, v]) => `${k}${s.required?.includes(k) ? '' : '?'}: ${tsType(v)}`).join('; ')} }` : 'Record<string, never>'
    else type = `Record<string, ${typeof s.additionalProperties === 'object' ? tsType(s.additionalProperties) : 'unknown'}>`
  } else type = ['integer', 'number'].includes(s.type) ? 'number' : s.type
  return s.nullable ? `(${type}) | null` : type
}

function kotlinType(s) {
  const ref = refName(s)
  let type
  if (ref) type = ref
  else if (s.oneOf) type = 'JsonObject' // discriminated ack is read before decoding its typed success/error branch
  else if (s.type === 'string') type = 'String'
  else if (s.type === 'boolean') type = 'Boolean'
  else if (s.type === 'integer') type = s.format === 'int64' ? 'Long' : 'Int'
  else if (s.type === 'number') type = 'Double'
  else if (s.type === 'array') type = `List<${kotlinType(s.items)}>`
  else if (s.type === 'object') type = typeof s.additionalProperties === 'object' ? `Map<String, ${kotlinType(s.additionalProperties)}>` : 'JsonObject'
  else fail(`Unsupported Kotlin type: ${s.type}`)
  return type + (s.nullable ? '?' : '')
}

function kotlinDefault(value, s) {
  if (value === null) return 'null'
  if (Array.isArray(value) && !value.length) return 'emptyList()'
  if (typeof value === 'object' && !Object.keys(value).length) return 'JsonObject(emptyMap())'
  if (typeof value === 'string') return ktQuote(value)
  if (s.type === 'number') return Number.isInteger(value) ? `${value}.0` : String(value)
  if (s.format === 'int64') return `${value}L`
  return String(value)
}

function kotlinModels(schemas) {
  const lines = ['// Generated from contracts/openapi.json. Do not edit.', '@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)', 'package com.woongjin.thinkmeet.data', '', 'import kotlinx.serialization.Serializable', 'import kotlinx.serialization.EncodeDefault', 'import kotlinx.serialization.json.JsonObject', '']
  for (const [name, s] of Object.entries(schemas)) {
    if (s.type !== 'object' || !s.properties) { lines.push(`typealias ${name} = ${kotlinType(s)}`, ''); continue }
    const props = Object.entries(s.properties)
    if (!props.length) { lines.push('@Serializable', `class ${name}`, ''); continue }
    lines.push('@Serializable', `data class ${name}(`)
    for (const [key, prop] of props) {
      const optional = !s.required?.includes(key), hasDefault = own(prop, 'default')
      let type = kotlinType(prop), value
      if (hasDefault) value = kotlinDefault(prop.default, prop)
      else if (optional) { if (!type.endsWith('?')) type += '?'; value = 'null' }
      if (optional && !hasDefault && !prop.nullable) lines.push('    @EncodeDefault(EncodeDefault.Mode.NEVER)')
      lines.push(`    val ${key}: ${type}${value === undefined ? '' : ` = ${value}`},`)
    }
    if (s['x-kotlin-helper'] === 'user') lines.push(') {', '    val isTeacher: Boolean get() = role == "teacher"', '}')
    else if (s['x-kotlin-helper'] === 'lesson') lines.push(') {', '    val canJoin: Boolean get() = status == "SCHEDULED" || status == "LIVE"', '    val isOpen: Boolean get() = accessMode == "OPEN"', '    fun isOwner(user: User): Boolean = teacher.id == user.id', '}')
    else lines.push(')')
    lines.push('')
  }
  return lines.join('\n')
}

const jsHelpers = `
function matchingOperation(method: string, input: string) {
  const route = input.split("?")[0].replace(/\\/$/, "");
  const absolute = route.startsWith("/api/v1/") ? route : "/api/v1" + (route.startsWith("/") ? route : "/" + route);
  const parts = absolute.split("/");
  return HTTP_OPERATIONS.find(op => op.method === method.toUpperCase() && op.path.split("/").length === parts.length && op.path.split("/").every((part, index) => (part.startsWith("{") || part.startsWith(":")) ? Boolean(parts[index]) : part === parts[index]));
}
export const featureForHttp = (method: string, path: string): string | undefined => matchingOperation(method, path)?.feature;
export const isKnownHttpOperation = (method: string, path: string): boolean => matchingOperation(method, path) !== undefined;
export function featureForEvent(event: string, payload?: Record<string, unknown>): string | undefined {
  return event === "command" ? COMMAND_FEATURES[String(payload?.type)] : EVENT_FEATURES[event];
}
export function isKnownEvent(event: string, payload?: Record<string, unknown>): boolean {
  return event === "command" ? Object.prototype.hasOwnProperty.call(COMMAND_FEATURES, String(payload?.type)) : Object.prototype.hasOwnProperty.call(EVENT_FEATURES, event);
}
export const isKnownFeature = (id: string): boolean => FEATURE_DEFINITIONS.some(feature => feature.id === id);
export const baselineFeatureIds: readonly string[] = FEATURE_DEFINITIONS.filter(f => f.stage === "baseline" && f.defaultEnabled).map(f => f.id);
export function baselineFeatures(platform: string): Record<string, boolean> {
  return Object.fromEntries(FEATURE_DEFINITIONS.map(f => [f.id, f.stage === "baseline" && f.defaultEnabled && (f.platforms as readonly string[]).includes(platform)]));
}
`

function kotlinProtocol(revision, operations, definitions, realtime) {
  const lines = ['// Generated from contracts/ and features/catalog.json. Do not edit.', 'package com.woongjin.thinkmeet.data', '', 'data class ContractHttpOperation(val id: String, val method: String, val path: String, val feature: String?)', 'data class ContractFeature(val id: String, val stage: String, val requiresRevision: Int, val defaultEnabled: Boolean, val platforms: Set<String>)', '', 'object ContractProtocol {', `    const val Revision = ${revision}`, '    const val ApiBasePath = "/api/v1"', `    const val SocketPath = ${ktQuote(realtime.path)}`, `    const val PlatformHeader = ${ktQuote(realtime.handshake.headers.platform)}`, `    const val RevisionHeader = ${ktQuote(realtime.handshake.headers.revision)}`, '    object Events {']
  for (const name of Object.keys(realtime.events)) lines.push(`        const val ${pascal(name)} = ${ktQuote(name)}`)
  lines.push('    }', '    object FeatureIds {')
  for (const f of definitions) lines.push(`        const val ${pascal(f.id)} = ${ktQuote(f.id)}`)
  lines.push('    }', '    val HttpOperations = listOf(')
  for (const op of operations) lines.push(`        ContractHttpOperation(${ktQuote(op.id)}, ${ktQuote(op.method)}, ${ktQuote(op.path)}, ${op.feature ? ktQuote(op.feature) : 'null'}),`)
  lines.push('    )', '    val Features = listOf(')
  for (const f of definitions) lines.push(`        ContractFeature(${ktQuote(f.id)}, ${ktQuote(f.stage)}, ${f.requiresRevision}, ${f.defaultEnabled}, setOf(${f.platforms.map(ktQuote).join(', ')})),`)
  lines.push('    )', '    private val commandFeatures: Map<String, String?> = mapOf(')
  for (const [key, spec] of Object.entries(realtime.commands)) lines.push(`        ${ktQuote(key)} to ${spec.cleanup ? 'null' : ktQuote(spec.feature)},`)
  lines.push('    )', '    private val eventFeatures: Map<String, String?> = mapOf(')
  for (const [key, spec] of Object.entries(realtime.events)) lines.push(`        ${ktQuote(key)} to ${spec.feature ? ktQuote(spec.feature) : 'null'},`)
  lines.push('    )', `    private fun operation(method: String, input: String): ContractHttpOperation? {
        val route = input.substringBefore('?').trimEnd('/')
        val absolute = if (route.startsWith("$ApiBasePath/")) route else ApiBasePath + "/" + route.trimStart('/')
        val parts = absolute.split('/')
        return HttpOperations.firstOrNull { op -> op.method == method.uppercase() && op.path.split('/').let { template ->
            template.size == parts.size && template.indices.all { index -> if (template[index].startsWith("{") || template[index].startsWith(":")) parts[index].isNotBlank() else template[index] == parts[index] }
        } }
    }
    fun featureForHttp(method: String, path: String): String? = operation(method, path)?.feature
    fun isKnownHttpOperation(method: String, path: String): Boolean = operation(method, path) != null
    fun featureForEvent(event: String, type: String? = null): String? = if (event == Events.Command) commandFeatures[type] else eventFeatures[event]
    fun isKnownEvent(event: String, type: String? = null): Boolean = if (event == Events.Command) commandFeatures.containsKey(type) else eventFeatures.containsKey(event)
    fun baselineFeatureIds(platform: String): Set<String> = Features.filter { it.stage == "baseline" && it.defaultEnabled && platform in it.platforms }.map { it.id }.toSet()
    fun isKnownFeature(id: String): Boolean = Features.any { it.id == id }
}`, '')
  return lines.join('\n')
}

export function compileSources(sources) {
  const operations = validateSources(sources), { api, realtime, catalog } = sources
  const revision = api['x-contract-revision'], schemas = api.components.schemas
  const definitions = catalog.features.map(({ id, stage, requiresRevision, defaultEnabled, platforms }) => ({ id, stage, requiresRevision, defaultEnabled, platforms }))
  const events = Object.fromEntries(Object.keys(realtime.events).map(name => [pascal(name), name]))
  const types = ['// Generated from contracts/openapi.json and realtime.json. Do not edit.', `export const CONTRACT_REVISION = ${revision} as const;`, 'export const API_BASE_PATH = "/api/v1" as const;', `export const SOCKET_PATH = ${quote(realtime.path)} as const;`, `export const SOCKET_EVENTS = ${JSON.stringify(events, null, 2)} as const;`, 'export const REALTIME_EVENTS = SOCKET_EVENTS;', ...Object.entries(schemas).map(([name, s]) => `export type ${name} = ${tsType(s)};`), 'export type ApiLesson = Lesson;', `export type CommandType = ${Object.keys(realtime.commands).map(quote).join(' | ')};`, `export type CommandPayloads = { ${Object.entries(realtime.commands).map(([name, spec]) => `${quote(name)}: ${spec.payload}`).join('; ')} };`, '']
  const policy = ['// Generated from features/catalog.json and contracts/. Do not edit.', `export const CONTRACT_REVISION = ${revision} as const;`, `export const CAPABILITY_HEADERS = ${JSON.stringify(realtime.handshake.headers)} as const;`, 'export type ClientPlatform = "web" | "android" | "ios";', 'export type FeatureDefinition = { readonly id: string; readonly stage: "baseline" | "planned" | "in-progress" | "ready"; readonly requiresRevision: number; readonly defaultEnabled: boolean; readonly platforms: readonly ClientPlatform[] };', `export const FEATURE_DEFINITIONS = ${JSON.stringify(definitions, null, 2)} as const satisfies readonly FeatureDefinition[];`, 'export type FeatureId = typeof FEATURE_DEFINITIONS[number]["id"];', `export const HTTP_OPERATIONS: readonly { id: string; method: string; path: string; feature?: string; cleanup?: boolean }[] = ${JSON.stringify(operations, null, 2)};`, `const COMMAND_FEATURES: Record<string, string | undefined> = ${JSON.stringify(Object.fromEntries(Object.entries(realtime.commands).map(([k, v]) => [k, v.cleanup ? null : v.feature]))).replaceAll(':null', ':undefined')};`, `const EVENT_FEATURES: Record<string, string | undefined> = ${JSON.stringify(Object.fromEntries(Object.entries(realtime.events).map(([k, v]) => [k, v.feature ?? null]))).replaceAll(':null', ':undefined')};`, jsHelpers]
  const outputs = new Map()
  for (const target of targets) { outputs.set(target + 'contracts.ts', types.join('\n')); outputs.set(target + 'feature-policy.ts', policy.join('\n')) }
  outputs.set('server/src/generated/openapi-document.ts', '// Generated from contracts/openapi.json. Do not edit.\nexport const OPENAPI_DOCUMENT = ' + JSON.stringify(api, null, 2) + ' as const;\n')
  outputs.set(ktBase + 'ContractModels.kt', kotlinModels(schemas))
  outputs.set(ktBase + 'ContractProtocol.kt', kotlinProtocol(revision, operations, definitions, realtime))
  return outputs
}

export async function generate({ check = false, outputRoot = root } = {}) {
  const outputs = compileSources(await readSources()), stale = []
  for (const [file, content] of outputs) {
    const absolute = path.join(outputRoot, file)
    const actual = await fs.readFile(absolute, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return undefined })
    if (actual === content) continue
    if (check) { stale.push(file); continue }
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    const temporary = absolute + '.' + randomUUID() + '.tmp'
    try { await fs.writeFile(temporary, content, { flag: 'wx' }); await fs.rename(temporary, absolute) }
    finally { await fs.rm(temporary, { force: true }) }
  }
  if (stale.length) fail('Stale/missing shared contracts:\n' + stale.map(s => '  ' + s).join('\n') + '\nRun node contracts/scripts/generate.mjs')
  return outputs
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.some(a => a !== '--check')) fail('Usage: node contracts/scripts/generate.mjs [--check]')
    await generate({ check: args.includes('--check') })
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
