import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONTRACT_REVISION } from '../src/generated/contracts.ts'

let serial = 0
const freshStore = () => import(`../src/lib/features.ts?test=${serial++}`)
const capabilities = features => new Response(JSON.stringify({ contractRevision: 1, features }), { headers: { 'Content-Type': 'application/json' } })

test('an explicit legacy 404 caches only the supported baseline and rejects unregistered operations', async () => {
  const original = globalThis.fetch
  let requests = 0
  globalThis.fetch = async (_url, options) => {
    requests++
    const headers = new Headers(options.headers)
    assert.equal(headers.get('X-ThinkMeet-Platform'), 'web')
    assert.equal(headers.get('X-ThinkMeet-Contract-Revision'), String(CONTRACT_REVISION))
    return new Response('', { status: 404 })
  }
  try {
    const store = await freshStore()
    await store.loadCapabilities()
    await store.loadCapabilities()
    assert.equal(requests, 1)
    assert.equal(store.getCapabilityState().status, 'legacy')
    assert.equal(store.isFeatureEnabled('classroom.core'), true)
    assert.equal(store.isFeatureEnabled('meeting.pip'), false)
    assert.equal(store.isFeatureEnabled('unknown.feature'), false)
    await assert.rejects(store.requireHttpFeature('POST', '/lessons/id/unknown-feature'), store.FeatureUnavailableError)
    await assert.rejects(store.requireEventFeature('command', { type: 'unknown.command' }), store.FeatureUnavailableError)
  } finally { globalThis.fetch = original }
})

test('authentication and network failures are retried and server flags cannot enable unknown features', async () => {
  const original = globalThis.fetch
  try {
    for (const failure of [() => new Response('', { status: 401 }), () => { throw new TypeError('offline') }]) {
      let requests = 0
      globalThis.fetch = async () => ++requests === 1 ? failure() : capabilities({ 'classroom.core': false, 'unknown.feature': true, 'meeting.pip': true })
      const store = await freshStore()
      await assert.rejects(store.loadCapabilities())
      assert.equal(store.getCapabilityState().status, 'error')
      await store.loadCapabilities()
      assert.equal(requests, 2)
      assert.equal(store.isFeatureEnabled('classroom.core'), false)
      assert.equal(store.isFeatureEnabled('unknown.feature'), false)
      assert.equal(store.isFeatureEnabled('meeting.pip'), false)
    }
  } finally { globalThis.fetch = original }
})

test('cancelling one caller does not poison the shared capability request', async () => {
  const original = globalThis.fetch
  let finish
  let requests = 0
  globalThis.fetch = () => { requests++; return new Promise(resolve => { finish = resolve }) }
  try {
    const store = await freshStore()
    const controller = new AbortController()
    const cancelled = store.loadCapabilities({ signal: controller.signal })
    controller.abort()
    await assert.rejects(cancelled, { name: 'AbortError' })
    const remaining = store.loadCapabilities()
    finish(capabilities({ 'classroom.core': true }))
    await remaining
    assert.equal(requests, 1)
    assert.equal(store.getCapabilityState().status, 'ready')
    assert.equal(store.isFeatureEnabled('classroom.core'), true)
    const cached = store.getCapabilityState().response
    const refresh = store.loadCapabilities({ force: true })
    assert.equal(store.getCapabilityState().status, 'loading')
    assert.equal(store.getCapabilityState().response, cached)
    finish(capabilities({ 'classroom.core': false }))
    await refresh
    assert.equal(requests, 2)
    assert.equal(store.isFeatureEnabled('classroom.core'), false)
  } finally { globalThis.fetch = original }
})

test('an explicit baseline denial survives expiry and network failure until an explicit recovery', async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  globalThis.fetch = async () => capabilities({ 'classroom.core': false })
  try {
    const store = await freshStore()
    await store.loadCapabilities()
    now += 120_001
    assert.equal(store.isFeatureEnabled('classroom.core'), false)
    globalThis.fetch = async () => { throw new TypeError('offline') }
    const failed = store.loadCapabilities()
    assert.equal(store.isFeatureEnabled('classroom.core'), false)
    await assert.rejects(failed)
    assert.equal(store.isFeatureEnabled('classroom.core'), false)
    assert.equal(store.isFeatureEnabled('unknown.feature'), false)
    globalThis.fetch = async () => capabilities({ 'classroom.core': true })
    await store.loadCapabilities()
    assert.equal(store.isFeatureEnabled('classroom.core'), true)
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow }
})
