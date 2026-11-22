import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { AccessToken, TrackSource } from 'livekit-server-sdk'
import { Lessons, lessonInput } from '../src/lessons'
import { ApiError } from '../src/errors'
import { Gateway } from '../src/gateway'
import { publicUser, tokenHash, Auth } from '../src/auth'
import type { PublicUser } from '../src/types'
const teacher: PublicUser = { id: randomUUID(), username: 'teacher', name: 'Teacher', role: 'teacher' }
const student: PublicUser = { id: randomUUID(), username: 'student', name: 'Student', role: 'student' }
const id = randomUUID()
const base = { id, teacherId: teacher.id, members: [{ userId: teacher.id, banned: false }, { userId: student.id, banned: false }], status: 'LIVE', roomName: 'opaque-room' }
function service(lesson: any = base) { return new Lessons({ lesson: { findUnique: async () => lesson }, teacherStudent: { count: async () => 1 } } as any) }
function code(expected: string) { return (error: any) => error instanceof ApiError && (error.getResponse() as any).code === expected }
test('public users never contain password hash', () => { assert.deepEqual(publicUser({ ...student, passwordHash: 'secret' } as any), student) })
test('session IDs are SHA256 digests, never stored as raw cookie', () => { const value = tokenHash('private-cookie'); assert.equal(value.length, 64); assert.notEqual(value, 'private-cookie') })
test('booking validates duration, future date and selected students', () => {
  const startsAt = new Date(Date.now() + 3600000).toISOString()
  assert.equal(lessonInput.safeParse({ title: 'Valid', startsAt, endsAt: new Date(Date.now() + 7200000).toISOString(), studentIds: [student.id] }).success, true)
  for (const changes of [{ title: ' ' }, { endsAt: startsAt }, { studentIds: [] }, { startsAt: 'yesterday' }]) assert.equal(lessonInput.safeParse({ title: 'Valid', startsAt, endsAt: new Date(Date.now() + 7200000).toISOString(), studentIds: [student.id], ...changes }).success, false)
})
test('uninvited account cannot access lesson with known ID', async () => { await assert.rejects(service().access(id, { ...student, id: randomUUID() }), code('ACCOUNT')) })
test('student cannot act as teacher by providing role payload', async () => { await assert.rejects(service().access(id, student, false, true), code('FORBIDDEN')) })
test('kicked account is denied even when class exists', async () => { await assert.rejects(service({ ...base, members: [{ userId: student.id, banned: true }] }).access(id, student), code('KICKED')) })
test('ended and cancelled classes reject realtime commands', async () => {
  await assert.rejects(service({ ...base, status: 'ENDED' }).access(id, student, true), code('ENDED'))
  await assert.rejects(service({ ...base, status: 'CANCELLED' }).access(id, student, true), code('CANCELLED'))
})
test('student waits without calling LiveKit before teacher starts', async () => {
  const svc = service({ ...base, status: 'SCHEDULED' }); svc.dto = async () => ({ id }) as any
  const result = await svc.join(id, student)
  assert.equal(result.waiting, true); assert.equal('token' in result, false)
})
test('students cannot update teacher video or PDF page', async () => {
  for (const type of ['media.update','document.page']) await assert.rejects(service().command(student, { lessonId: id, type, payload: {} }), code('FORBIDDEN'))
})
test('students cannot stop another sharer', async () => {
  await assert.rejects(service({ ...base, share: { id: randomUUID(), ownerId: teacher.id, type: 'screen' } }).command(student, { lessonId: id, type: 'share.stop', payload: {} }), code('FORBIDDEN'))
})
test('guarded Socket stops preserve a replacement and keep legacy stops and owner permissions', async () => {
  const oldScreenId = randomUUID()
  const document = { id: randomUUID(), ownerId: teacher.id, type: 'document' }
  let share: typeof document | null = document
  let writes = 0
  let actor = teacher
  const svc = new Lessons({
    lesson: {
      findUnique: async () => ({ ...base, seq: 1, share }),
      update: async () => { writes++; share = null },
    },
    user: { findMany: async () => [teacher, student] },
    message: { findMany: async () => [] },
    stroke: { findMany: async () => [] },
  } as any)
  svc.dto = async () => ({ id }) as any
  svc.broadcast = async () => ({ share }) as any
  const gateway = new Gateway({ userFromCookie: async () => actor } as any, svc)
  const socket = { id: 'socket', handshake: { headers: {} } } as any
  const input = { lessonId: id, type: 'share.stop' }
  const stale = await gateway.command(socket, { ...input, expectedShareId: oldScreenId })
  assert.equal(stale.ok, true)
  assert.deepEqual(stale.snapshot?.share, document)
  assert.equal(writes, 0)

  actor = student
  assert.equal((await gateway.command(socket, { ...input, expectedShareId: document.id })).error?.code, 'FORBIDDEN')
  assert.equal(writes, 0)
  actor = teacher
  assert.equal((await gateway.command(socket, { ...input, expectedShareId: document.id })).ok, true)
  assert.equal(share, null)
  share = document
  assert.equal((await gateway.command(socket, input)).ok, true)
  assert.equal(share, null)
  assert.equal(writes, 2)
})
test('student cannot end whole class', async () => { await assert.rejects(service().end(id, student), code('FORBIDDEN')) })
test('lesson commands run serially and recover after rejected command', async () => {
  const svc = service(); const values: string[] = []
  await Promise.allSettled([
    svc.locked(id, async () => { values.push('a'); await new Promise(resolve => setTimeout(resolve, 5)); values.push('b'); throw new Error('failed') }),
    svc.locked(id, async () => { values.push('c') }),
  ])
  assert.deepEqual(values, ['a','b','c'])
})
test('proxy rejects correctly signed cached token after kick and after replacement', async () => {
  process.env.LIVEKIT_API_KEY = 'test-key'; process.env.LIVEKIT_API_SECRET = 'test-secret-with-minimum-32-characters'; process.env.PROXY_AUTH_SECRET = 'proxy-secret'
  const admissionId = randomUUID()
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: student.id, metadata: JSON.stringify({ admissionId }), ttl: '2m' })
  token.addGrant({ roomJoin: true, room: base.roomName })
  const uri = `/livekit/rtc?access_token=${encodeURIComponent(await token.toJwt())}`
  const lesson = { ...base, members: [{ userId: student.id, admissionId, banned: false }] }
  assert.deepEqual(await service(lesson).authorizeLivekit(uri, 'proxy-secret'), { ok: true })
  await assert.rejects(service({ ...lesson, members: [{ userId: student.id, admissionId, banned: true }] }).authorizeLivekit(uri, 'proxy-secret'), code('FORBIDDEN'))
  await assert.rejects(service({ ...lesson, members: [{ userId: student.id, admissionId: randomUUID(), banned: false }] }).authorizeLivekit(uri, 'proxy-secret'), code('FORBIDDEN'))
  await assert.rejects(service({ ...lesson, status: 'ENDED' }).authorizeLivekit(uri, 'proxy-secret'), code('FORBIDDEN'))
  await assert.rejects(service(lesson).authorizeLivekit(uri, 'wrong-proxy'), code('FORBIDDEN'))
})
test('missing and expired login cookies cannot authenticate', async () => {
  const auth = new Auth({ loginSession: { findUnique: async () => ({ expiresAt: new Date(0), user: student }) } } as any)
  await assert.rejects(auth.userFromCookie(), code('UNAUTHENTICATED'))
  await assert.rejects(auth.userFromCookie('think_meet_session=expired'), code('UNAUTHENTICATED'))
})

test('native bearer admission uses the same proxy, ban, replacement and closure checks', async () => {
  process.env.LIVEKIT_API_KEY = 'test-key'; process.env.LIVEKIT_API_SECRET = 'test-secret-with-minimum-32-characters'; process.env.PROXY_AUTH_SECRET = 'proxy-secret'
  const admissionId = randomUUID()
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: student.id, metadata: JSON.stringify({ admissionId }), ttl: '2m' })
  token.addGrant({ roomJoin: true, room: base.roomName })
  const jwt = await token.toJwt(), header = `Bearer ${jwt}`
  const lesson = { ...base, members: [{ userId: student.id, admissionId, banned: false }] }
  assert.deepEqual(await service(lesson).authorizeLivekit('/livekit/rtc', 'proxy-secret', header), { ok: true })
  for (const changed of [
    { ...lesson, members: [{ userId: student.id, admissionId, banned: true }] },
    { ...lesson, members: [{ userId: student.id, admissionId: randomUUID(), banned: false }] },
    { ...lesson, status: 'ENDED' },
  ]) await assert.rejects(service(changed).authorizeLivekit('/livekit/rtc', 'proxy-secret', header), code('FORBIDDEN'))
  await assert.rejects(service(lesson).authorizeLivekit('/livekit/rtc', 'wrong-proxy', header), code('FORBIDDEN'))
  await assert.rejects(service(lesson).authorizeLivekit('/livekit/rtc?access_token=other', 'proxy-secret', header), code('UNAUTHENTICATED'))
  await assert.rejects(service(lesson).authorizeLivekit('/livekit/rtc', 'proxy-secret', 'Basic invalid'), code('UNAUTHENTICATED'))
})

test('snapshot delivery removes sockets whose invitation was revoked', async () => {
  const { Gateway } = await import('../src/gateway')
  const emitted: string[] = []
  const socket = { id: 'socket', rooms: new Set([`lesson:${id}`]), handshake: { headers: { cookie: 'valid' } }, emit: (event: string) => emitted.push(event), leave: (room: string) => socket.rooms.delete(room), disconnect: () => {} }
  const gateway = new Gateway({ userFromCookie: async () => student } as any, service())
  gateway.server = { sockets: { sockets: new Map([['socket', socket]]) } } as any
  await gateway.emitAuthorized(id, 'snapshot', { confidential: true }, new Set([teacher.id]))
  assert.deepEqual(emitted, ['room:error'])
  assert.equal(socket.rooms.has(`lesson:${id}`), false)
})
test('snapshot delivery disconnects revoked login sessions before emitting data', async () => {
  const { Gateway } = await import('../src/gateway')
  const emitted: string[] = []; let disconnected = false
  const socket = { id: 'socket', rooms: new Set([`lesson:${id}`]), handshake: { headers: { cookie: 'expired' } }, emit: (event: string) => emitted.push(event), leave: (room: string) => socket.rooms.delete(room), disconnect: () => { disconnected = true } }
  const gateway = new Gateway({ userFromCookie: async () => { throw new ApiError('UNAUTHENTICATED','expired',401) } } as any, service())
  gateway.server = { sockets: { sockets: new Map([['socket', socket]]) } } as any
  await gateway.emitAuthorized(id, 'snapshot', { confidential: true }, new Set([student.id]))
  assert.deepEqual(emitted, ['room:error']); assert.equal(disconnected, true)
})
test('file deletion and simultaneous share cannot create a dangling active material', async () => {
  const { Materials } = await import('../src/materials')
  const materialId = randomUUID(); let material: any = { id: materialId, ownerId: teacher.id, kind: 'document', name: 'test.pdf', size: 100, objectKey: 'test.pdf', pages: 1, createdAt: new Date() }; let share: any = null
  const db: any = {
    material: { findUnique: async () => material, delete: async () => { material = null } },
    lesson: { findFirst: async () => share ? { id } : null, update: async ({ data }: any) => { share = data.share } },
  }
  const svc = new Lessons(db); svc.access = async () => ({ ...base, share: null }) as any; svc.broadcast = async () => ({ share }) as any
  const files = new Materials(db, svc); (files.s3 as any).send = async () => { await new Promise(resolve => setTimeout(resolve, 10)); return {} }
  const deleting = files.remove(teacher, materialId)
  const starting = svc.command(teacher, { lessonId: id, type: 'share.start', payload: { type: 'document', materialId } })
  await deleting
  await assert.rejects(starting, code('INVALID_MATERIAL'))
  assert.equal(share, null)
})
test('share expiration still runs when all admission IDs have been cleared', async () => {
  let share: any = { id: randomUUID(), type: 'screen', ownerId: student.id }
  const lesson: any = { ...base, share, members: [{ userId: student.id, online: false, admissionId: null, disconnectedAt: new Date(Date.now() - 40000) }] }
  const db: any = {
    lesson: { findMany: async ({ where }: any) => { assert.equal(where.OR.some((entry: any) => entry.share), true); return [lesson] }, findUnique: async () => ({ ...lesson, share }), update: async () => { share = null } },
    lessonMember: { findUnique: async () => lesson.members[0] },
    loginSession: { deleteMany: async () => {} }, webhookEvent: { deleteMany: async () => {} },
  }
  const svc = new Lessons(db); svc.livekit.listParticipants = async () => []; svc.broadcast = async () => ({}) as any
  await svc.reconcile(); assert.equal(share, null)
})

test('ordinary screen share survives unpublish and republish, and expires if the video stays missing', async t => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const firstShare = { id: randomUUID(), type: 'screen', ownerId: teacher.id }
  let share: typeof firstShare | null = firstShare
  const owner = { userId: teacher.id, online: true, banned: false }
  const audio = { sid: 'screen-audio', source: TrackSource.SCREEN_SHARE_AUDIO }
  let tracks = [audio]
  const lesson = () => ({ ...base, share, members: [owner] })
  const svc = new Lessons({
    lesson: {
      findMany: async () => [lesson()],
      findUnique: async () => lesson(),
      update: async () => { share = null },
    },
    lessonMember: { findUnique: async () => owner },
    loginSession: { deleteMany: async () => {} },
    webhookEvent: { deleteMany: async () => {} },
  } as any)
  svc.broadcast = async () => ({ share }) as any
  svc.livekit.listParticipants = async () => [{ identity: owner.userId, tracks }] as any
  svc.receiver.receive = async () => ({
    event: 'track_unpublished', room: { name: base.roomName },
    participant: { identity: owner.userId }, track: { sid: 'old-video', source: TrackSource.SCREEN_SHARE },
  }) as any

  await svc.webhook('', '')
  await svc.reconcile()
  now += 29_000
  await svc.reconcile()
  assert.equal(share, firstShare)

  tracks = [audio, { sid: 'new-video', source: TrackSource.SCREEN_SHARE }]
  await svc.webhook('', '')
  now += 10_000
  await svc.reconcile()
  assert.equal(share, firstShare)

  tracks = [audio]
  await svc.reconcile()
  assert.equal(share, firstShare)
  const nextShare = { ...firstShare, id: randomUUID() }
  share = nextShare
  now += 30_000
  await svc.reconcile()
  assert.equal(share, nextShare)
  now += 30_000
  await svc.reconcile()
  assert.equal(share, null)
})
test('status transitions never overwrite a concurrent change made outside this process lock', async () => {
  // The lesson is read in one state, but another instance or webhook changed it before the write.
  const raced = (read: string, actual: string) => {
    const writes: string[] = []
    const lesson = { ...base, status: read, members: [{ userId: teacher.id, banned: false }], accessMode: 'INVITE_ONLY' }
    const db: any = {
      lesson: {
        findUnique: async () => writes.length ? { ...lesson, status: actual } : lesson,
        updateMany: async ({ where }: any) => { writes.push('lesson'); return { count: where.status === actual ? 1 : 0 } },
      },
      lessonMember: { updateMany: async () => { writes.push('members') }, deleteMany: async () => { writes.push('members') }, upsert: async () => { writes.push('members') } },
      attendance: { updateMany: async () => { writes.push('attendance') } },
      teacherStudent: { count: async () => 1 },
      $transaction: async (operation: (tx: any) => Promise<unknown>) => operation(db),
    }
    const svc = new Lessons(db); svc.dto = async (row: any) => row; svc.broadcast = async () => ({}) as any
    svc.livekit.deleteRoom = async () => { writes.push('livekit') }
    return { svc, writes }
  }
  const ended = raced('LIVE', 'ENDED')
  assert.equal(((await ended.svc.end(id, teacher)) as any).status, 'ENDED')
  assert.deepEqual(ended.writes, ['lesson'], 'members and attendance close only with the winning transition')
  const cancelled = raced('SCHEDULED', 'LIVE')
  await assert.rejects(cancelled.svc.cancel(id, teacher), code('CONFLICT'))
  assert.deepEqual(cancelled.writes, ['lesson'], 'a started lesson keeps its LiveKit room')
  const edited = raced('SCHEDULED', 'LIVE')
  const startsAt = new Date(Date.now() + 3600000).toISOString()
  await assert.rejects(edited.svc.edit(id, teacher, { title: 'Edited', startsAt, endsAt: null, studentIds: [student.id] }), code('CONFLICT'))
  assert.deepEqual(edited.writes, ['lesson'], 'the roster is not changed after a lost race')
})
