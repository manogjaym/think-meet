#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { root, readSources, validateSources } from '../contracts/scripts/generate.mjs'

const platforms = ['server', 'web', 'android', 'ios']
const text = s => typeof s === 'string' && s.trim().length >= 10
const safePath = p => typeof p === 'string' && !path.isAbsolute(p) && !p.split('/').includes('..') && !/\.(env|pem|key)$/.test(p)
async function exists(relative) {
  if (!safePath(relative)) throw new Error(`Invalid feature evidence/source path: ${relative}`)
  if (!(await fs.stat(path.join(root, relative)).catch(() => null))?.isFile()) throw new Error(`Feature file does not exist: ${relative}`)
}

export async function validateCatalog(sources, { verifyFiles = true, baseline } = {}) {
  const operations = validateSources(sources), { catalog, api, realtime } = sources
  const featureById = new Map(catalog.features.map(f => [f.id, f]))
  const prior = baseline ?? JSON.parse(await fs.readFile(path.join(root, 'contracts/compatibility/v1.json'), 'utf8'))
  const priorOperationIds = new Set(Object.values(prior.openapi.paths).flatMap(methods => Object.values(methods).map(op => op.operationId)))
  for (const feature of catalog.features) {
    if (!text(feature.title) && !feature.title?.trim()) throw new Error(`Feature requires title: ${feature.id}`)
    if (!safePath(feature.spec) || !feature.spec.endsWith('.md')) throw new Error(`Feature requires a spec: ${feature.id}`)
    if (verifyFiles) await exists('features/' + feature.spec)
    for (const platform of platforms) {
      const implementation = feature.implementation?.[platform]
      if (!implementation || !['pending', 'done', 'not-applicable'].includes(implementation.status)) throw new Error(`${feature.id}: missing ${platform} implementation status`)
      if (implementation.status === 'not-applicable' && !text(implementation.reason)) throw new Error(`${feature.id}.${platform}: an explicit exemption reason is required`)
      if (implementation.status === 'done') {
        if (!implementation.files?.length) throw new Error(`${feature.id}.${platform}: implementation files required`)
        const prefixes = { server: /^server\/src\//, web: /^web\/src\//, android: /^mobile\/composeApp\/src\/(commonMain|androidMain)\//, ios: /^mobile\/(composeApp\/src\/(commonMain|iosMain)\/|iosApp\/)/ }
        if (implementation.files.some(file => !prefixes[platform].test(file))) throw new Error(`${feature.id}.${platform}: implementation must reference that platform's source`)
        if (verifyFiles) for (const file of implementation.files) await exists(file)
      }
      if (feature.stage === 'ready' || feature.stage === 'baseline') {
        const supported = platform === 'server' || feature.platforms.includes(platform)
        if (supported && implementation.status === 'pending') throw new Error(`${feature.id}: ${platform} is pending; feature cannot be ready`)
        if (platform !== 'server' && supported && implementation.status !== 'done') throw new Error(`${feature.id}: advertised platform ${platform} is not implemented`)
        if (platform !== 'server' && !supported && implementation.status !== 'not-applicable') throw new Error(`${feature.id}: unsupported platform ${platform} requires an exemption`)
      }
      if (feature.stage === 'ready' && implementation.status === 'done') {
        const verification = feature.verification?.[platform]
        if (verification?.status !== 'passed' || !verification.checks?.length || !verification.evidence?.length) throw new Error(`${feature.id}.${platform}: passing core checks and evidence required before ready`)
        if (verifyFiles) for (const file of [...verification.checks, ...verification.evidence]) await exists(file)
        if (platform !== 'server' && feature.ui !== false) for (const size of ['phone', 'tablet']) {
          const screen = verification.screens?.[size]
          if (screen?.status !== 'passed' || !screen.evidence?.length) throw new Error(`${feature.id}.${platform}: ${size} comparison evidence required`)
          if (verifyFiles) for (const file of screen.evidence) await exists(file)
        }
      }
    }
    for (const category of ['operations', 'events', 'commands']) {
      if (!Array.isArray(feature.contracts?.[category])) throw new Error(`${feature.id}: missing ${category} references`)
      for (const id of feature.contracts[category]) {
        const owner = category === 'operations' ? Object.values(api.paths).flatMap(Object.values).find(op => op.operationId === id)?.['x-feature'] : realtime[category][id]?.feature
        if (owner !== feature.id) throw new Error(`${feature.id}: stale ${category} reference ${id}`)
      }
    }
  }
  for (const op of operations) {
    const source = Object.values(api.paths).flatMap(Object.values).find(o => o.operationId === op.id)
    if (source['x-feature'] && !featureById.get(source['x-feature']).contracts.operations.includes(op.id)) throw new Error(`Feature catalog is missing operation ${op.id}`)
    if (!priorOperationIds.has(op.id) && featureById.get(source['x-feature'])?.stage === 'baseline') throw new Error(`New operation ${op.id} must belong to a new, default-off feature; baseline cannot auto-enable it`)
    if (!priorOperationIds.has(op.id) && !source['x-feature']) throw new Error(`New operation ${op.id} must declare its feature`)
  }
  for (const category of ['events', 'commands']) for (const [id, spec] of Object.entries(realtime[category])) {
    if (spec.feature && !featureById.get(spec.feature).contracts[category].includes(id)) throw new Error(`Feature catalog is missing ${category}.${id}`)
    if (!Object.hasOwn(prior.realtime[category], id) && (!spec.feature || featureById.get(spec.feature)?.stage === 'baseline')) throw new Error(`New ${category}.${id} needs a new, default-off feature`)
  }
}

export function validateChange(change, changedFiles) {
  if (!change.id || !text(change.summary) || !['shared', 'server-only', 'platform-only', 'design-only', 'infrastructure'].includes(change.scope)) throw new Error('Feature change requires id, summary and explicit scope')
  if (!Array.isArray(change.featureIds) || !change.featureIds.length) throw new Error(`${change.id}: feature IDs are required`)
  for (const platform of platforms) {
    const state = change.platforms?.[platform]
    if (!state || !['implemented', 'unchanged', 'not-applicable'].includes(state.status)) throw new Error(`${change.id}: ${platform} disposition missing`)
    if (state.status !== 'implemented' && !text(state.reason)) throw new Error(`${change.id}: ${platform} exclusion needs a concrete reason`)
  }
  const touched = {
    server: changedFiles.some(f => /^server\/src\//.test(f) && !f.includes('/generated/')),
    web: changedFiles.some(f => /^web\/src\//.test(f) && !f.includes('/generated/')),
    android: changedFiles.some(f => /^mobile\/composeApp\/src\/(commonMain|androidMain)\//.test(f) && !f.includes('/generated/')),
    ios: changedFiles.some(f => /^mobile\/(composeApp\/src\/(commonMain|iosMain)\/|iosApp\/)/.test(f) && !f.includes('/generated/')),
  }
  for (const platform of platforms) if (touched[platform] && change.platforms[platform].status !== 'implemented') throw new Error(`${change.id}: changed ${platform} source cannot be marked unchanged/not-applicable`)
  if (change.scope === 'shared' && (touched.web || touched.android || touched.ios)) {
    for (const platform of ['web', 'android', 'ios']) if (change.platforms[platform].status !== 'implemented') throw new Error(`${change.id}: shared UI change requires web, Android and iOS; use explicit platform-only scope/reason for exceptions`)
  }
  if (!change.verification?.length) throw new Error(`${change.id}: record the necessary verification commands`)
}

export async function checkFeatures(changedFiles) {
  const sources = await readSources()
  await validateCatalog(sources)
  if (changedFiles) {
    const productChanged = changedFiles.some(f => /^(server\/src|web\/src|mobile\/(composeApp\/src|iosApp)|contracts\/|design\/)/.test(f))
    if (productChanged) {
      const records = changedFiles.filter(f => /^features\/changes\/[a-z0-9.-]+\.json$/.test(f))
      if (!records.length) throw new Error('Product/contract changes require a new or updated features/changes/*.json record')
      const changes = await Promise.all(records.map(async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'))))
      // A single feature change can describe several implementation commits in the same PR.
      for (const change of changes) {
        validateChange(change, changedFiles)
        for (const id of change.featureIds) if (!sources.catalog.features.some(f => f.id === id)) throw new Error(`Change references unknown feature: ${id}`)
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length && (args[0] !== '--changed-files' || args.length !== 2)) throw new Error('Usage: node features/check.mjs [--changed-files path-to-newline-list]')
    const changed = args.length ? (await fs.readFile(args[1], 'utf8')).split(/\r?\n/).filter(Boolean) : undefined
    await checkFeatures(changed); console.log('Features: implementation/readiness/contract checks passed')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
