import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Request } from 'express'
import { Reflector } from '@nestjs/core'
import { APP_GUARD } from '@nestjs/core'
import { AuthGuard, CONTROLLERS, SystemController } from '../src/http'
import { AppModule } from '../src/main'
import { ApiError } from '../src/errors'
import { FeaturePolicy, HttpFeatureGuard } from '../src/features'
import { Gateway } from '../src/gateway'
import { CONTRACT_REVISION } from '../src/generated/contracts'
import { FEATURE_DEFINITIONS } from '../src/generated/feature-policy'

function policy(unavailable: string[] = []) {
  const policy = new FeaturePolicy()
  // Model an unimplemented feature to exercise compatibility and cleanup rejection paths.
  const definitions = (policy as any).definitions
  for (const id of unavailable) definitions.set(id, { ...definitions.get(id), stage: 'planned', defaultEnabled: false })
  return policy
}
const errorCode = (code: string) => (error: unknown) => error instanceof ApiError && (error.getResponse() as { code: string }).code === code
const student = { id: randomUUID(), username: 'student', name: 'Student', role: 'student' as const }
const lessonId = randomUUID()

test('capabilities is public, contains only contract availability and respects platform support', () => {
  const controller = new SystemController({} as any, {} as any, {} as any, policy())
  const legacy = controller.capabilities({ headers: {} } as Request)
  assert.deepEqual(Object.keys(legacy).sort(), ['contractRevision', 'features'])
  assert.equal(legacy.contractRevision, CONTRACT_REVISION)
  assert.deepEqual(Object.keys(legacy.features).sort(), FEATURE_DEFINITIONS.map(feature => feature.id).sort())
  assert.equal(legacy.features['classroom.core'], true)
  assert.equal(legacy.features['meeting.pip'], false)
  const headers = { 'x-thinkmeet-platform': 'android', 'x-thinkmeet-contract-revision': '1' }
  assert.equal(controller.capabilities({ headers } as Request).features['meeting.pip'], true)
  assert.equal(policy(['meeting.pip']).capabilities(headers).features['meeting.pip'], false)
})

test('obsolete environment flags cannot disable implemented features or prevent startup', () => {
  const previous = process.env.THINK_MEET_FEATURE_FLAGS
  try {
    for (const raw of ['{"meeting.remote-assistance":false,"classroom.core":false}', 'invalid JSON']) {
      process.env.THINK_MEET_FEATURE_FLAGS = raw
      const features = new FeaturePolicy()
      for (const platform of ['web', 'android', 'ios']) {
        const headers = { 'x-thinkmeet-platform': platform, 'x-thinkmeet-contract-revision': String(CONTRACT_REVISION) }
        assert.equal(features.capabilities(headers).features['meeting.remote-assistance'], true)
        assert.equal(features.capabilities(headers).features['classroom.core'], true)
        assert.doesNotThrow(() => features.assertEvent('command', { type: 'assistance.request' }, headers))
      }
    }
  } finally {
    if (previous === undefined) delete process.env.THINK_MEET_FEATURE_FLAGS
    else process.env.THINK_MEET_FEATURE_FLAGS = previous
  }
})

test('HTTP gate blocks disabled or unregistered operations while exempt routes and legacy baseline remain usable', () => {
  const disabled = policy(['classroom.core'])
  const guard = new HttpFeatureGuard(disabled)
  const context = (method: string, path: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method, path, headers: {} }) }) }) as any
  assert.throws(() => guard.canActivate(context('POST', `/api/v1/lessons/${lessonId}/join`)), errorCode('FEATURE_UNAVAILABLE'))
  assert.throws(() => guard.canActivate(context('HEAD', `/api/v1/lessons/${lessonId}/snapshot`)), errorCode('FEATURE_UNAVAILABLE'))
  for (const [method, path] of [['GET', '/api/v1/health'], ['GET', '/api/v1/capabilities'], ['POST', '/api/v1/auth/login'], ['POST', '/api/v1/webhooks/livekit'], ['GET', '/internal/livekit-auth']]) {
    assert.equal(guard.canActivate(context(method, path)), true)
  }
  assert.throws(() => policy().assertHttp('POST', '/api/v1/unregistered-feature', {}), errorCode('FEATURE_UNAVAILABLE'))
  assert.doesNotThrow(() => policy().assertHttp('GET', `/api/v1/lessons/${lessonId}/snapshot`, {}))
})

test('Socket gates reject bypassed UI commands, subscribe and previews before lesson mutations', async () => {
  let authenticated = 0
  const emitted: Array<{ event: string; payload: any }> = []
  const gateway = new Gateway({ userFromCookie: async () => { authenticated++; return student } } as any, {
    command: () => assert.fail('disabled command must not mutate a lesson'),
    snapshot: () => assert.fail('disabled subscription must not disclose a snapshot'),
    access: () => assert.fail('disabled preview must not broadcast'),
  } as any, policy(['classroom.core']))
  const socket = { id: 'socket', handshake: { headers: { cookie: 'valid' }, auth: { platform: 'web', contractRevision: 1, role: 'teacher' } }, emit: (event: string, payload: any) => emitted.push({ event, payload }) } as any
  assert.deepEqual(await gateway.command(socket, { lessonId, type: 'chat.send', payload: { text: 'Hello', clientId: 'one' } }), { ok: false, error: { code: 'FEATURE_UNAVAILABLE', message: '현재 사용할 수 없는 기능입니다.' } })
  assert.equal((await gateway.subscribe(socket, { lessonId })).ok, false)
  await gateway.preview(socket, { lessonId, shareId: randomUUID(), page: 1, tool: 'pen', color: '#ff0000', points: [] })
  assert.equal(authenticated, 3)
  assert.deepEqual(emitted.map(entry => [entry.event, entry.payload.code]), [['room:error', 'FEATURE_UNAVAILABLE']])
})

test('baseline Socket compatibility never replaces session or teacher authorization', async () => {
  const features = policy()
  const socket = { id: 'legacy', handshake: { headers: { cookie: 'valid' }, auth: {} } } as any
  let mutations = 0
  const gateway = new Gateway({ userFromCookie: async () => student } as any, { command: async () => { mutations++; return { seq: 1 } } } as any, features)
  assert.equal((await gateway.command(socket, { lessonId, type: 'chat.send', payload: { text: 'Hello', clientId: 'one' } })).ok, true)
  assert.equal(mutations, 1)
  for (const type of ['future.action', '__proto__']) {
    const rejected = await gateway.command(socket, { lessonId, type, payload: {} })
    assert.equal(rejected.ok, false)
    assert.equal((rejected as any).error.code, 'FEATURE_UNAVAILABLE')
  }
  assert.equal(mutations, 1)
  const expired = new Gateway({ userFromCookie: async () => { throw new ApiError('UNAUTHENTICATED', 'expired', 401) } } as any, {} as any, features)
  assert.equal((await expired.command(socket, { lessonId, type: 'hand.set', payload: { raised: true } }) as any).error.code, 'UNAUTHENTICATED')
  const forbidden = new Gateway({ userFromCookie: async () => student } as any, { command: async () => { throw new ApiError('FORBIDDEN', 'teacher only', 403) } } as any, features)
  socket.handshake.auth = { platform: 'ios', contractRevision: 99, role: 'teacher' }
  assert.equal((await forbidden.command(socket, { lessonId, type: 'media.update', payload: { playing: true, position: 0 } }) as any).error.code, 'FORBIDDEN')
})

test('disabled classroom keeps cleanup available without bypassing authentication or ownership', async () => {
  const features = policy(['classroom.core'])
  const guard = new HttpFeatureGuard(features)
  const context = (action: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method: 'POST', path: `/api/v1/lessons/${lessonId}/${action}`, headers: {} }) }) }) as any
  for (const action of ['leave', 'end']) assert.equal(guard.canActivate(context(action)), true)
  assert.throws(() => guard.canActivate(context('join')), errorCode('FEATURE_UNAVAILABLE'))

  const commands: string[] = []
  const socket = { id: 'cleanup', handshake: { headers: { cookie: 'valid' }, auth: {} } } as any
  const gateway = new Gateway({ userFromCookie: async () => student } as any, { command: async (_user: unknown, command: { type: string }) => { commands.push(command.type); return { seq: 1 } } } as any, features)
  assert.equal((await gateway.command(socket, { lessonId, type: 'share.stop', payload: {} })).ok, true)
  assert.equal((await gateway.command(socket, { lessonId, type: 'chat.send', payload: { text: 'Hello', clientId: 'one' } }) as any).error.code, 'FEATURE_UNAVAILABLE')
  assert.deepEqual(commands, ['share.stop'])

  const expired = new Gateway({ userFromCookie: async () => { throw new ApiError('UNAUTHENTICATED', 'expired', 401) } } as any, {} as any, features)
  assert.equal((await expired.command(socket, { lessonId, type: 'share.stop', payload: {} }) as any).error.code, 'UNAUTHENTICATED')
  const forbidden = new Gateway({ userFromCookie: async () => student } as any, { command: async () => { throw new ApiError('FORBIDDEN', 'not the sharer or owner', 403) } } as any, features)
  assert.equal((await forbidden.command(socket, { lessonId, type: 'share.stop', payload: {} }) as any).error.code, 'FORBIDDEN')
})

test('every HTTP route requires a session unless it is explicitly public, and 401 precedes the feature gate', async () => {
  const user = { id: randomUUID(), username: 'teacher', name: 'Teacher', role: 'teacher' as const }
  let lookups = 0
  const guard = new AuthGuard({ user: async (req: any) => { lookups++; if (!req.headers.cookie) throw new ApiError('UNAUTHENTICATED', 'login', 401); return user } } as any, new Reflector())
  const context = (controller: any, handler: string, headers: Record<string, string> = {}) => {
    const req: any = { headers }
    return { req, value: { getHandler: () => controller.prototype[handler], getClass: () => controller, switchToHttp: () => ({ getRequest: () => req }) } as any }
  }
  const publicRoutes = new Set(['SystemController.capabilities', 'SystemController.health', 'SystemController.webhook', 'InternalController.auth', 'AuthController.login', 'AuthController.logout'])
  for (const controller of CONTROLLERS) for (const handler of Object.getOwnPropertyNames(controller.prototype).filter(name => name !== 'constructor')) {
    const { value, req } = context(controller, handler)
    const name = `${controller.name}.${handler}`
    if (publicRoutes.has(name)) assert.equal(await guard.canActivate(value), true, name)
    else {
      await assert.rejects(guard.canActivate(value), errorCode('UNAUTHENTICATED'), name)
      const signedIn = context(controller, handler, { cookie: 'think_meet_session=x' })
      assert.equal(await guard.canActivate(signedIn.value), true, name)
      assert.equal(signedIn.req.user, user, name)
      assert.equal(req.user, undefined)
    }
  }
  assert.ok(lookups > 0)
  const guards = (Reflect.getMetadata('providers', AppModule) as any[]).filter(provider => provider?.provide === APP_GUARD).map(provider => provider.useClass)
  assert.deepEqual(guards, [AuthGuard, HttpFeatureGuard])
})
