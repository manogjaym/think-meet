import { API_BASE_PATH, CONTRACT_REVISION, type CapabilitiesResponse } from "../generated/contracts.ts"
import { CAPABILITY_HEADERS, FEATURE_DEFINITIONS, baselineFeatures, featureForEvent, featureForHttp, isKnownEvent, isKnownHttpOperation, type FeatureDefinition } from "../generated/feature-policy.ts"

type CapabilityState = {
  status: "idle" | "loading" | "ready" | "legacy" | "error"
  response?: CapabilitiesResponse
}
const baseline = baselineFeatures("web")
const baselineDenials = new Set<string>()
const listeners = new Set<() => void>()
const cacheMillis = 120_000
let state: CapabilityState = { status: "idle" }
let expiresAt = 0
let pending: Promise<CapabilitiesResponse> | undefined

export class FeatureUnavailableError extends Error {
  readonly code = "FEATURE_UNAVAILABLE"
  constructor() { super("현재 서버에서 사용할 수 없는 기능이에요. 잠시 후 다시 확인해 주세요."); this.name = "FeatureUnavailableError" }
}

export const capabilityHeaders = () => ({
  [CAPABILITY_HEADERS.platform]: "web",
  [CAPABILITY_HEADERS.revision]: String(CONTRACT_REVISION),
})
export const getCapabilityState = () => state
export function subscribeCapabilities(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function publish(next: CapabilityState) {
  state = next
  listeners.forEach(listener => listener())
}
function aborted(signal: AbortSignal) { return signal.reason ?? new DOMException("Aborted", "AbortError") }
function withSignal<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(aborted(signal))
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted(signal))
    signal.addEventListener("abort", cancel, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel))
  })
}

/** Only successful responses and an explicit legacy 404 are cached; failures remain retryable. */
export function loadCapabilities({ force = false, signal }: { force?: boolean; signal?: AbortSignal | null } = {}): Promise<CapabilitiesResponse> {
  if (signal?.aborted) return Promise.reject(aborted(signal))
  if (!force && state.response && expiresAt > Date.now()) return withSignal(Promise.resolve(state.response), signal)
  if (!pending) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    publish({ status: "loading", response: state.response })
    pending = (async () => {
      const response = await fetch(`${API_BASE_PATH}/capabilities`, { credentials: "include", headers: capabilityHeaders(), signal: controller.signal })
      const legacy = response.status === 404
      if (!response.ok && !legacy) throw new Error(`Capabilities HTTP ${response.status}`)
      const value: unknown = legacy ? { contractRevision: CONTRACT_REVISION, features: baseline } : await response.json()
      if (!value || typeof value !== "object" || !("contractRevision" in value) || !Number.isInteger(value.contractRevision) || Number(value.contractRevision) < 1 || !("features" in value) || !value.features || typeof value.features !== "object" || Array.isArray(value.features) || Object.values(value.features).some(flag => typeof flag !== "boolean")) throw new Error("Invalid capabilities response")
      const capabilities = value as CapabilitiesResponse
      if (legacy) baselineDenials.clear()
      else for (const definition of FEATURE_DEFINITIONS) {
        if (definition.stage !== "baseline") continue
        if (capabilities.features[definition.id] === false) baselineDenials.add(definition.id)
        else if (capabilities.features[definition.id] === true) baselineDenials.delete(definition.id)
      }
      expiresAt = Date.now() + cacheMillis
      publish({ status: legacy ? "legacy" : "ready", response: capabilities })
      return capabilities
    })().catch(error => {
      expiresAt = 0
      publish({ status: "error" })
      throw error
    }).finally(() => { clearTimeout(timeout); pending = undefined })
  }
  // Cancelling one view must not poison the shared fetch or other callers' capability state.
  return withSignal(pending, signal)
}

export function isFeatureEnabled(id: string): boolean {
  const definition: FeatureDefinition | undefined = FEATURE_DEFINITIONS.find(feature => feature.id === id)
  if (!definition || !definition.platforms.some(platform => platform === "web") || definition.requiresRevision > CONTRACT_REVISION || !definition.defaultEnabled || definition.stage === "planned") return false
  if (state.response && expiresAt > Date.now()) return state.response.contractRevision >= definition.requiresRevision && state.response.features[id] === true
  // Temporary capability failures must not prevent sign-in or existing classroom flows.
  return definition.stage === "baseline" && baseline[id] === true && !baselineDenials.has(id)
}

export async function requireFeature(id: string | undefined, signal?: AbortSignal | null): Promise<void> {
  if (!id) throw new FeatureUnavailableError()
  try { await loadCapabilities({ signal }) }
  catch (error) {
    if (signal?.aborted) throw aborted(signal)
    if (!isFeatureEnabled(id)) throw error
  }
  if (signal?.aborted) throw aborted(signal)
  if (!isFeatureEnabled(id)) throw new FeatureUnavailableError()
}
export async function requireHttpFeature(method: string, path: string, signal?: AbortSignal | null): Promise<void> {
  if (!isKnownHttpOperation(method.toUpperCase(), path)) throw new FeatureUnavailableError()
  const feature = featureForHttp(method.toUpperCase(), path)
  if (feature) await requireFeature(feature, signal)
}
export async function requireEventFeature(event: string, payload?: Record<string, unknown>): Promise<void> {
  if (!isKnownEvent(event, payload)) throw new FeatureUnavailableError()
  const feature = featureForEvent(event, payload)
  if (feature) await requireFeature(feature)
}
