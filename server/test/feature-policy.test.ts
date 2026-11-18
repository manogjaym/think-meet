import { test } from 'node:test'
import assert from 'node:assert/strict'
import { featureClient, featureDecision, socketFeatureClient, type FeatureDefinition } from '../src/feature-policy'

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

const baseline: FeatureDefinition = { id: 'baseline', stage: 'baseline', requiresRevision: 0, defaultEnabled: true, platforms: ['web', 'android', 'ios'] }
const implemented: FeatureDefinition = { id: 'new-feature', stage: 'in-progress', requiresRevision: 4, defaultEnabled: true, platforms: ['web', 'android', 'ios'] }

test('implemented features are enabled without rollout overrides and keep platform and revision checks', () => {
  assert.deepEqual(featureDecision(baseline, featureClient()), { available: true })
  for (const platform of ['web', 'android', 'ios'] as const) {
    const current = { platform, contractRevision: 4 }
    assert.deepEqual(featureDecision(implemented, current), { available: true })
    assert.deepEqual(featureDecision({ ...implemented, stage: 'ready' }, current), { available: true })
    assert.deepEqual(featureDecision(implemented, { ...current, contractRevision: 3 }), { available: false, code: 'CLIENT_UPDATE_REQUIRED' })
    assert.deepEqual(featureDecision({ ...implemented, platforms: [] }, current), { available: false, code: 'FEATURE_UNAVAILABLE' })
    assert.deepEqual(featureDecision({ ...implemented, stage: 'planned', defaultEnabled: false }, current), { available: false, code: 'FEATURE_UNAVAILABLE' })
  }
  assert.deepEqual(featureDecision(implemented, featureClient()), { available: false, code: 'CLIENT_UPDATE_REQUIRED' })
})

test('browser handshake metadata is a fallback and cannot override supplied HTTP capability headers', () => {
  assert.deepEqual(socketFeatureClient({}, { platform: 'web', contractRevision: 1 }), { platform: 'web', contractRevision: 1 })
  assert.deepEqual(socketFeatureClient({ 'X-ThinkMeet-Platform': 'android', 'X-ThinkMeet-Contract-Revision': '0' }, { platform: 'ios', contractRevision: 99 }), { platform: 'android', contractRevision: 0 })
  assert.deepEqual(socketFeatureClient({ 'x-thinkmeet-platform': 'invalid', 'x-thinkmeet-contract-revision': 'bad' }, { platform: 'web', contractRevision: 99 }), { platform: null, contractRevision: 0 })
  assert.deepEqual(socketFeatureClient({}, { platform: 'ios', contractRevision: -1, role: 'teacher' }), { platform: 'ios', contractRevision: 0 })
})

