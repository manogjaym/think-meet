#!/usr/bin/env node
/** Read-only compatibility and server-route coverage checks; no database or app needed. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { root, readSources, validateSources } from './generate.mjs'

const ignored = key => ['description', 'title', 'example', 'examples', 'summary', 'tags'].includes(key) || key.startsWith('x-')
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(k => !ignored(k)).sort().map(k => [k, comparable(value[k])]))
  return value
}
const equal = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))

/** Existing wire fields stay invariant; only optional properties and new operations are additive. */
export function assertCompatible(previous, current) {
  const issues = []
  function schema(before, after, location) {
    if (!after) { issues.push(`${location}: removed`); return }
    if (before.type === 'object' && before.properties && after.type === 'object' && after.properties) {
      const oldRequired = new Set(before.required ?? []), nextRequired = new Set(after.required ?? [])
      for (const [name, property] of Object.entries(before.properties)) {
        schema(property, after.properties[name], `${location}.${name}`)
        if (oldRequired.has(name) !== nextRequired.has(name)) issues.push(`${location}.${name}: changed required/optional contract`)
      }
      for (const name of nextRequired) if (!Object.hasOwn(before.properties, name)) issues.push(`${location}.${name}: added required field breaks old requests`)
      const { properties: _p, required: _r, ...rest } = before
      const { properties: _np, required: _nr, ...nextRest } = after
      if (!equal(rest, nextRest)) issues.push(`${location}: changed object wire constraints`)
    } else if (!equal(before, after)) issues.push(`${location}: changed wire type/default/enum/constraints`)
  }
  for (const [name, model] of Object.entries(previous.openapi.components.schemas)) schema(model, current.openapi.components.schemas[name], `model ${name}`)
  for (const [route, methods] of Object.entries(previous.openapi.paths)) for (const [method, op] of Object.entries(methods)) {
    const next = current.openapi.paths[route]?.[method]
    if (!next) { issues.push(`${method.toUpperCase()} ${route}: removed`); continue }
    const { parameters: oldParameters = [], ...oldOperation } = op
    const { parameters: nextParameters = [], ...nextOperation } = next
    if (!equal(oldOperation, nextOperation)) issues.push(`${method.toUpperCase()} ${route}: changed existing operation contract`)
    for (const parameter of oldParameters) if (!nextParameters.some(p => p.name === parameter.name && p.in === parameter.in && equal(p, parameter))) issues.push(`${method.toUpperCase()} ${route}: changed/removed parameter ${parameter.name}`)
    for (const parameter of nextParameters) if (parameter.required && !oldParameters.some(p => p.name === parameter.name && p.in === parameter.in)) issues.push(`${method.toUpperCase()} ${route}: added required parameter ${parameter.name}`)
  }
  for (const category of ['events', 'commands']) for (const [name, spec] of Object.entries(previous.realtime[category])) {
    const next = current.realtime[category][name]
    // Delivery policy may be reclassified without changing payload formats.
    const { feature: _f, cleanup: _c, ...wire } = spec
    const { feature: _nf, cleanup: _nc, ...nextWire } = next ?? {}
    if (!next || !equal(wire, nextWire)) issues.push(`Socket ${category}.${name}: removed or changed wire contract`)
  }
  if (current.openapi['x-contract-revision'] < previous.openapi['x-contract-revision']) issues.push('Contract revision decreased')
  if (!equal(previous.realtime.handshake, current.realtime.handshake) || previous.realtime.path !== current.realtime.path) issues.push('Socket handshake/path changed; existing clients need a versioned migration')
  if (issues.length) throw new Error('Backward compatibility failed:\n' + issues.map(i => '  ' + i).join('\n'))
}

export function assertRouteCoverage(controllerSource, gatewaySource, api, realtime) {
  const apiController = controllerSource.split("@Controller('api/v1')")[1]?.split("@Controller('internal')")[0]
  if (!apiController) throw new Error('Cannot identify ApiController for route coverage')
  const actual = new Set([...apiController.matchAll(/@(Get|Post|Patch|Delete|Put|Head|Options)\('([^']+)'\)/g)].map(([, method, route]) => `${method.toLowerCase()} /${route.replace(/:([A-Za-z][A-Za-z0-9]*)/g, '{$1}')}`))
  const specified = new Set(Object.entries(api.paths).flatMap(([route, methods]) => Object.keys(methods).map(method => `${method} ${route}`)))
  for (const route of actual) if (!specified.has(route)) throw new Error(`Server route is missing from contracts/openapi.json: ${route}`)
  for (const route of specified) if (!actual.has(route)) throw new Error(`Contract route has no server handler: ${route}`)
  // @SubscribeMessage can use a generated event constant, so resolve names from realtime.json.
  const eventName = name => Object.keys(realtime.events).find(e => e.split(/[.:-]/).map(p => p[0].toUpperCase() + p.slice(1)).join('') === name)
  const handledEvents = new Set()
  for (const [, literal, constant] of gatewaySource.matchAll(/@SubscribeMessage\((?:'([^']+)'|SOCKET_EVENTS\.([A-Za-z]+))\)/g)) {
    const event = literal ?? eventName(constant)
    if (!event || !['client', 'bidirectional'].includes(realtime.events[event]?.direction)) throw new Error(`Server Socket event missing from contract: ${literal ?? constant}`)
    handledEvents.add(event)
  }
  for (const [event, spec] of Object.entries(realtime.events)) if (['client', 'bidirectional'].includes(spec.direction) && !handledEvents.has(event)) throw new Error(`Contract Socket event has no server handler: ${event}`)
}

export async function checkContracts() {
  const sources = await readSources()
  validateSources(sources)
  const baselines = (await fs.readdir(path.join(root, 'contracts/compatibility'))).filter(file => /^v\d+\.json$/.test(file))
  if (!baselines.length) throw new Error('At least one immutable compatibility baseline is required')
  for (const file of baselines) assertCompatible(JSON.parse(await fs.readFile(path.join(root, 'contracts/compatibility', file), 'utf8')), { openapi: sources.api, realtime: sources.realtime })
  const [controllers, gateway] = await Promise.all(['server/src/controllers.ts', 'server/src/gateway.ts'].map(p => fs.readFile(path.join(root, p), 'utf8')))
  assertRouteCoverage(controllers, gateway, sources.api, sources.realtime)
  async function inspect(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'generated') await inspect(full); continue }
      if (!entry.name.endsWith('.ts')) continue
      const source = await fs.readFile(full, 'utf8')
      if (entry.name !== 'controllers.ts' && /@Controller\(\s*['"`]api\//.test(source)) throw new Error(`Additional public controller requires route coverage registration: ${full}`)
      if (entry.name !== 'gateway.ts' && /@SubscribeMessage\(/.test(source)) throw new Error(`Additional gateway requires Socket contract/policy registration: ${full}`)
    }
  }
  await inspect(path.join(root, 'server/src'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await checkContracts(); console.log('Contracts: compatibility and server route coverage passed') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
