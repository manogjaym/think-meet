import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readSources, compileSources, generate } from '../scripts/generate.mjs'
import { assertCompatible, assertRouteCoverage, serverSourceFiles } from '../scripts/check.mjs'
import { validateCatalog, validateChange } from '../../features/check.mjs'

const clone = value => structuredClone(value)
const source = await readSources()
const prior = { openapi: clone(source.api), realtime: clone(source.realtime) }

test('one shared field reaches TypeScript and Kotlin; omitted optional requestId stays omitted while endsAt stays explicit null', () => {
  const changed = clone(source)
  changed.api.components.schemas.Lesson.properties.topic = { type: 'string' }
  const output = compileSources(changed)
  assert.match(output.get('web/src/generated/contracts.ts'), /topic\?: string/)
  const kt = output.get('mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/data/generated/ContractModels.kt')
  assert.match(kt, /@EncodeDefault\(EncodeDefault.Mode.NEVER\)\n    val topic: String\? = null/)
  assert.match(kt, /@EncodeDefault\(EncodeDefault.Mode.NEVER\)\n    val requestId: String\? = null/)
  const input = kt.split('data class LessonInput(')[1].split('\n)')[0]
  assert.match(input, /val endsAt: String\?,/)
  assert.doesNotMatch(input, /EncodeDefault[\s\S]*val endsAt/)
})

test('backward compatibility accepts new optional fields but rejects removal, new required fields, null and enum changes', () => {
  const additive = clone(prior)
  additive.openapi.components.schemas.User.properties.nickname = { type: 'string' }
  assert.doesNotThrow(() => assertCompatible(prior, additive))
  for (const mutate of [
    s => { delete s.openapi.components.schemas.User.properties.name },
    s => { s.openapi.components.schemas.User.properties.nickname = { type: 'string' }; s.openapi.components.schemas.User.required.push('nickname') },
    s => { s.openapi.components.schemas.User.properties.name.nullable = true },
    s => { s.openapi.components.schemas.Role.enum.push('admin') },
    s => { delete s.realtime.commands['chat.send'] },
  ]) {
    const changed = clone(prior); mutate(changed)
    assert.throws(() => assertCompatible(prior, changed), /Backward compatibility failed/)
  }
})

test('read-only check catches missing and edited output without rewriting it', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'thinkmeet-contract-'))
  try {
    await assert.rejects(generate({ check: true, outputRoot: temporary }), /Stale\/missing/)
    await generate({ outputRoot: temporary })
    await generate({ check: true, outputRoot: temporary })
    const file = path.join(temporary, 'web/src/generated/contracts.ts')
    await fs.writeFile(file, 'manually edited')
    await assert.rejects(generate({ check: true, outputRoot: temporary }), /Stale\/missing/)
    assert.equal(await fs.readFile(file, 'utf8'), 'manually edited')
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
})

test('ready requires all advertised implementations and real verification references; new operations cannot hide under baseline', async () => {
  const changed = clone(source)
  const revision = changed.api['x-contract-revision'] + 1
  changed.api['x-contract-revision'] = revision
  const feature = clone(changed.catalog.features[0])
  Object.assign(feature, { id: 'meeting.reactions', title: '수업 반응 기능', stage: 'ready', requiresRevision: revision, defaultEnabled: false, contracts: { operations: [], events: [], commands: [] } })
  feature.implementation.ios = { status: 'pending', files: [] }
  changed.catalog.features.push(feature)
  await assert.rejects(validateCatalog(changed, { verifyFiles: false, baseline: prior }), /passing core checks|pending/)
  const bypass = clone(source)
  bypass.api.paths['/lessons/{id}/reaction'] = { post: clone(bypass.api.paths['/lessons/{id}/leave'].post) }
  bypass.api.paths['/lessons/{id}/reaction'].post.operationId = 'sendReaction'
  bypass.catalog.features[0].contracts.operations.push('sendReaction')
  await assert.rejects(validateCatalog(bypass, { verifyFiles: false, baseline: prior }), /must belong to a separately registered feature/)
})

test('shared change records reject one-sided completion and permit explicit server-only unchanged reasons', () => {
  const changed = { id: 'lesson-change', summary: '수업 입장 정책을 공통으로 보완합니다.', scope: 'shared', featureIds: ['classroom.core'], platforms: Object.fromEntries(['server','web','android','ios'].map(p => [p, { status: 'implemented' }])), verification: ['core tests'] }
  assert.doesNotThrow(() => validateChange(changed, ['web/src/App.tsx','mobile/composeApp/src/commonMain/kotlin/Example.kt']))
  changed.platforms.ios = { status: 'unchanged', reason: 'iOS 변경이 없다고 명시했지만 shared 작업입니다.' }
  assert.throws(() => validateChange(changed, ['web/src/App.tsx']), /requires web, Android and iOS/)
  changed.scope = 'server-only'
  for (const p of ['web','android','ios']) changed.platforms[p] = { status: 'unchanged', reason: '응답 형식과 클라이언트 동작을 유지하는 서버 내부 수정입니다.' }
  assert.doesNotThrow(() => validateChange(changed, ['server/src/lessons.ts']))
})

test('missing REST/Socket handlers and unknown body/query schema references fail before shipping', async () => {
  const broken = clone(source)
  broken.api.paths['/auth/me'].get.responses['200'].content['application/json'].schema = { $ref: '#/components/schemas/Missing' }
  assert.throws(() => compileSources(broken), /Unknown schema reference/)
  const badQuery = clone(source)
  badQuery.api.paths['/lessons'].get.parameters = [{ name: 'search', in: 'query', required: false, schema: { $ref: '#/components/schemas/Missing' } }]
  assert.throws(() => compileSources(badQuery), /Unknown schema reference/)
  assert.throws(() => assertRouteCoverage(["@Controller('api/v1') class Api { @Get('missing') get() {} }"], source.api, source.realtime), /missing from contracts/)
  const sources = await serverSourceFiles()
  assert.doesNotThrow(() => assertRouteCoverage(sources, source.api, source.realtime))
  const missingHandler = clone(source.realtime)
  missingHandler.events['reaction.send'] = { direction: 'client', schema: 'SuccessAck', feature: 'classroom.core' }
  assert.throws(() => assertRouteCoverage(sources, source.api, missingHandler), /no server handler: reaction.send/)
  missingHandler.events['reaction.send'].direction = 'server'
  assert.doesNotThrow(() => assertRouteCoverage(sources, source.api, missingHandler))
})

test('routes may be split across controller files and composed from a controller prefix', () => {
  const api = { paths: { '/lessons/{id}': { get: {} }, '/health': { get: {} } } }
  const realtime = { events: {} }
  const split = ["@Controller('api/v1/lessons') class A { @Get(':id') get() {} }", "@Controller('api/v1') class B { @Get('health') h() {} } @Controller('internal') class C { @Get('livekit-auth') x() {} }"]
  assert.doesNotThrow(() => assertRouteCoverage(split, api, realtime))
  assert.throws(() => assertRouteCoverage([split[1]], api, realtime), /no server handler: get \/lessons\/\{id\}/)
  assert.throws(() => assertRouteCoverage([...split, "@Controller('api/v2') class D {}"], api, realtime), /must start with api\/v1/)
  assert.throws(() => assertRouteCoverage(["@Controller('api/v1') class E { @Get(PATH) g() {} }"], api, realtime), /single-quoted/)
})

test('capability header names have one source and optional query parameters are additive', () => {
  const changed = clone(source)
  changed.realtime.handshake.headers.revision = 'X-ThinkMeet-Next-Revision'
  const output = compileSources(changed)
  assert.match(output.get('web/src/generated/feature-policy.ts'), /X-ThinkMeet-Next-Revision/)
  assert.match(output.get('mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/data/generated/ContractProtocol.kt'), /RevisionHeader = "X-ThinkMeet-Next-Revision"/)
  assert.throws(() => assertCompatible(prior, { openapi: changed.api, realtime: changed.realtime }), /handshake/)
  const query = clone(prior)
  query.openapi.paths['/lessons'].get.parameters = [{ name: 'search', in: 'query', required: false, schema: { type: 'string' } }]
  assert.doesNotThrow(() => assertCompatible(prior, query))
  query.openapi.paths['/lessons'].get.parameters[0].required = true
  assert.throws(() => assertCompatible(prior, query), /required parameter/)
})
