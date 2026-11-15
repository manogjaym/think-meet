import { CAPABILITY_HEADERS } from './generated/feature-policy'
import type { ClientPlatform, FeatureDefinition } from './generated/feature-policy'
export type { ClientPlatform, FeatureDefinition } from './generated/feature-policy'

/** Client metadata selects compatibility only; it never establishes identity or permissions. */
export type FeatureClient = { platform: ClientPlatform | null; contractRevision: number }
export type ClientHeaders = Readonly<Record<string, unknown>>
export type FeatureDecision = { available: true } | { available: false; code: 'FEATURE_UNAVAILABLE' | 'CLIENT_UPDATE_REQUIRED' }

function header(headers: ClientHeaders, name: string): string | undefined {
  const value = headers[name] ?? Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
  // Ambiguous duplicate headers are legacy metadata, rather than a negotiated capability.
  return typeof value === 'string' ? value.trim() : undefined
}

export function featureClient(headers: ClientHeaders = {}): FeatureClient {
  const platform = header(headers, CAPABILITY_HEADERS.platform.toLowerCase())
  if (platform !== 'web' && platform !== 'android' && platform !== 'ios') return { platform: null, contractRevision: 0 }
  const rawRevision = header(headers, CAPABILITY_HEADERS.revision.toLowerCase())
  const revision = rawRevision && /^(0|[1-9][0-9]*)$/.test(rawRevision) ? Number(rawRevision) : 0
  return { platform, contractRevision: Number.isSafeInteger(revision) ? revision : 0 }
}

/** Browser WebSockets use handshake.auth because browsers cannot set arbitrary upgrade headers. */
export function socketFeatureClient(headers: ClientHeaders = {}, auth: unknown = {}): FeatureClient {
  const metadata = auth !== null && typeof auth === 'object' && !Array.isArray(auth) ? auth as Record<string, unknown> : {}
  const hasHeader = (name: string) => Object.keys(headers).some(key => key.toLowerCase() === name)
  const platformHeader = CAPABILITY_HEADERS.platform.toLowerCase()
  const revisionHeader = CAPABILITY_HEADERS.revision.toLowerCase()
  const revision = metadata.contractRevision
  return featureClient({
    ...headers,
    ...(hasHeader(platformHeader) ? {} : { [platformHeader]: metadata.platform }),
    ...(hasHeader(revisionHeader) ? {} : { [revisionHeader]: typeof revision === 'number' ? String(revision) : revision }),
  })
}

/** Parse once on server startup. A typo must not silently enable or disable a different feature. */
export function parseFeatureFlags(raw: string | undefined, featureIds: Iterable<string>): Readonly<Record<string, boolean>> {
  if (raw === undefined) return Object.freeze({})
  let input: unknown
  try { input = JSON.parse(raw) } catch { throw new Error('THINK_MEET_FEATURE_FLAGS must be a JSON object of feature IDs and booleans') }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('THINK_MEET_FEATURE_FLAGS must be a JSON object of feature IDs and booleans')
  const known = new Set(featureIds)
  for (const [id, enabled] of Object.entries(input)) {
    if (!known.has(id)) throw new Error(`THINK_MEET_FEATURE_FLAGS contains unknown feature: ${id}`)
    if (typeof enabled !== 'boolean') throw new Error(`THINK_MEET_FEATURE_FLAGS requires a boolean for feature: ${id}`)
  }
  return Object.freeze(Object.fromEntries(Object.entries(input)) as Record<string, boolean>)
}

export function configuredFeatureFlags(raw: string | undefined, definitions: readonly FeatureDefinition[]): Readonly<Record<string, boolean>> {
  const flags = parseFeatureFlags(raw, definitions.map(feature => feature.id))
  for (const feature of definitions) {
    if (flags[feature.id] === true && feature.stage !== 'baseline' && feature.stage !== 'ready') {
      throw new Error(`THINK_MEET_FEATURE_FLAGS cannot enable a feature before it is ready: ${feature.id}`)
    }
  }
  return flags
}

export function featureDecision(feature: FeatureDefinition, client: FeatureClient, flags: Readonly<Record<string, boolean>>): FeatureDecision {
  // New functionality is opt-in even if an accidentally edited definition claims a default of true.
  const defaultEnabled = feature.stage === 'baseline' && feature.requiresRevision === 0 && feature.defaultEnabled
  if ((feature.stage !== 'baseline' && feature.stage !== 'ready') || !(flags[feature.id] ?? defaultEnabled)) return { available: false, code: 'FEATURE_UNAVAILABLE' }
  if (!feature.platforms.includes(client.platform ?? 'web')) return { available: false, code: 'FEATURE_UNAVAILABLE' }
  if (client.contractRevision < feature.requiresRevision) return { available: false, code: 'CLIENT_UPDATE_REQUIRED' }
  return { available: true }
}

