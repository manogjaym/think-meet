import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configuredFeatureFlags, featureClient, featureDecision, parseFeatureFlags, socketFeatureClient, type FeatureDefinition } from '../src/feature-policy'

test('missing, unknown or ambiguous client metadata remains legacy revision zero', () => {
  assert.deepEqual(featureClient(), { platform: null, contractRevision: 0 })
  assert.deepEqual(featureClient({ 'x-thinkmeet-platform': 'desktop', 'x-thinkmeet-contract-revision': '99' }), { platform: null, contractRevision: 0 })
  assert.deepEqual(featureClient({ 'x-thinkmeet-platform': ['web', 'android'], 'x-thinkmeet-contract-revision': '1' }), { platform: null, contractRevision: 0 })
  for (const revision of ['', '-1', '1.5', '1e2', '01', '1, 2', '9007199254740992', ['1', '2']]) {
    assert.deepEqual(featureClient({ 'x-thinkmeet-platform': 'android', 'x-thinkmeet-contract-revision': revision }), { platform: 'android', contractRevision: 0 })
  }
})

test('all supported clients negotiate an integer contract revision from HTTP or handshake headers', () => {
  for (const platform of ['web', 'android', 'ios'] as const) {
    assert.deepEqual(featureClient({ 'X-ThinkMeet-Platform': platform, 'X-ThinkMeet-Contract-Revision': '1' }), { platform, contractRevision: 1 })
    assert.deepEqual(featureClient({ 'x-thinkmeet-platform': platform }), { platform, contractRevision: 0 })
  }
})

test('runtime flags accept only known feature IDs with explicit boolean values', () => {
  assert.deepEqual(parseFeatureFlags(undefined, ['baseline', 'future']), {})
  assert.deepEqual(parseFeatureFlags('{"baseline":false,"future":true}', ['baseline', 'future']), { baseline: false, future: true })
  assert.equal(Object.isFrozen(parseFeatureFlags('{}', [])), true)
  for (const raw of ['', 'true', 'null', '[]', '{invalid', '{"unknown":true}', '{"baseline":"false"}', '{"baseline":1}', '{"baseline":null}']) {
    assert.throws(() => parseFeatureFlags(raw, ['baseline', 'future']), /THINK_MEET_FEATURE_FLAGS/)
  }
})

const baseline: FeatureDefinition = { id: 'baseline', stage: 'baseline', requiresRevision: 0, defaultEnabled: true, platforms: ['web', 'android', 'ios'] }
const future: FeatureDefinition = { id: 'future', stage: 'ready', requiresRevision: 2, defaultEnabled: false, platforms: ['web', 'android', 'ios'] }

test('baseline features remain available to legacy and current clients unless explicitly disabled', () => {
  for (const client of [featureClient(), featureClient({ 'x-thinkmeet-platform': 'ios', 'x-thinkmeet-contract-revision': '1' })]) {
    assert.deepEqual(featureDecision(baseline, client, {}), { available: true })
    assert.deepEqual(featureDecision(baseline, client, { baseline: false }), { available: false, code: 'FEATURE_UNAVAILABLE' })
  }
})

test('future features require explicit enablement, readiness, platform support and a compatible revision', () => {
  const current = { platform: 'android', contractRevision: 2 } as const
  assert.deepEqual(featureDecision(future, current, {}), { available: false, code: 'FEATURE_UNAVAILABLE' })
  assert.deepEqual(featureDecision({ ...future, defaultEnabled: true }, current, {}), { available: false, code: 'FEATURE_UNAVAILABLE' })
  assert.deepEqual(featureDecision(future, current, { future: true }), { available: true })
  assert.deepEqual(featureDecision(future, featureClient(), { future: true }), { available: false, code: 'CLIENT_UPDATE_REQUIRED' })
  assert.deepEqual(featureDecision(future, { ...current, contractRevision: 1 }, { future: true }), { available: false, code: 'CLIENT_UPDATE_REQUIRED' })
  assert.deepEqual(featureDecision({ ...future, platforms: ['ios'] }, current, { future: true }), { available: false, code: 'FEATURE_UNAVAILABLE' })
  for (const stage of ['planned', 'in-progress'] as const) {
    const unfinished = { ...future, stage }
    assert.deepEqual(featureDecision(unfinished, current, { future: true }), { available: false, code: 'FEATURE_UNAVAILABLE' })
    assert.throws(() => configuredFeatureFlags('{"future":true}', [unfinished]), /before it is ready/)
    assert.deepEqual(configuredFeatureFlags('{"future":false}', [unfinished]), { future: false })
  }
})

test('browser handshake metadata is a fallback and cannot override supplied HTTP capability headers', () => {
  assert.deepEqual(socketFeatureClient({}, { platform: 'web', contractRevision: 1 }), { platform: 'web', contractRevision: 1 })
  assert.deepEqual(socketFeatureClient({ 'X-ThinkMeet-Platform': 'android', 'X-ThinkMeet-Contract-Revision': '0' }, { platform: 'ios', contractRevision: 99 }), { platform: 'android', contractRevision: 0 })
  assert.deepEqual(socketFeatureClient({ 'x-thinkmeet-platform': 'invalid', 'x-thinkmeet-contract-revision': 'bad' }, { platform: 'web', contractRevision: 99 }), { platform: null, contractRevision: 0 })
  assert.deepEqual(socketFeatureClient({}, { platform: 'ios', contractRevision: -1, role: 'teacher' }), { platform: 'ios', contractRevision: 0 })
})

