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

/** Implemented features are always available when the client supports their contract. */
export function featureDecision(feature: FeatureDefinition, client: FeatureClient): FeatureDecision {
  if (!feature.defaultEnabled || feature.stage === 'planned') return { available: false, code: 'FEATURE_UNAVAILABLE' }
  if (!feature.platforms.includes(client.platform ?? 'web')) return { available: false, code: 'FEATURE_UNAVAILABLE' }
  if (client.contractRevision < feature.requiresRevision) return { available: false, code: 'CLIENT_UPDATE_REQUIRED' }
  return { available: true }
}
