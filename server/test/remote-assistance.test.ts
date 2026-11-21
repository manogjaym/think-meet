import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { TrackSource } from 'livekit-server-sdk'
import { AssistanceSessions } from '../src/assistance'
import { Lessons } from '../src/lessons'
import { Gateway } from '../src/gateway'
import { FeaturePolicy } from '../src/features'
import { ApiError } from '../src/errors'
import type { AssistanceGeometry, CommandEnvelope, User } from '../src/generated/contracts'

const geometry: AssistanceGeometry = { width: 1080, height: 2400, rotation: 0, version: 1 }
async function fixture(features = new FeaturePolicy()) {
  const id = randomUUID(), clock = { now: Date.now() }
  const teacher: User = { id: randomUUID(), role: 'teacher', name: 'Teacher', username: 'teacher' }
  const student: User = { id: randomUUID(), role: 'student', name: 'Student', username: 'student' }
  const other: User = { id: randomUUID(), role: 'student', name: 'Other', username: 'other' }
  const identities = new Map([['teacher', teacher], ['student', student], ['other', other]])
  const lesson: any = { id, teacherId: teacher.id, title: 'Class', description: '', accessMode: 'INVITE_ONLY', status: 'LIVE', roomName: 'room',
    startsAt: new Date(), startedAt: new Date(), seq: 0, code: 'code', share: null,
    members: [teacher, student, other].map(user => ({ userId: user.id, banned: false, online: true, raised: false, admissionId: randomUUID() })) }
  const materials = new Map<string, { id: string; ownerId: string; kind: string; pages?: number; size: number; name: string; createdAt: Date }>()
  const db: any = {
    lesson: {
      findUnique: async () => lesson, findMany: async () => [lesson],
      update: async ({ data }: any) => {
        if (data.seq) lesson.seq += data.seq.increment
        if ('share' in data) lesson.share = data.share === Prisma.DbNull ? null : structuredClone(data.share)
        for (const key of ['status', 'endedAt', 'instructionPhase', 'instructionStartedAt']) if (key in data) lesson[key] = data[key]
        return lesson
      },
    },
    lessonMember: {
      findUnique: async ({ where }: any) => lesson.members.find((m: any) => m.userId === where.lessonId_userId.userId),
      update: async ({ where, data }: any) => Object.assign(lesson.members.find((m: any) => m.userId === where.lessonId_userId.userId), data),
      updateMany: async ({ where, data }: any) => { for (const m of lesson.members) if (!where.userId || m.userId === where.userId) Object.assign(m, data) },
    },
    user: { findMany: async () => [teacher, student, other] }, message: { findMany: async () => [] }, stroke: { findMany: async () => [] },
    material: { findUnique: async ({ where }: { where: { id: string } }) => materials.get(where.id) },
    attendance: { findMany: async () => [], findFirst: async () => null, updateMany: async () => ({ count: 1 }) },
    loginSession: { deleteMany: async () => {} }, webhookEvent: { deleteMany: async () => {} },
    $transaction: async (operations: Promise<any>[]) => Promise.all(operations),
  }
  const lessons = new Lessons(db)
  ;(lessons as any).assistance = new AssistanceSessions(() => clock.now)
  const media = { published: true, trackSid: 'current-student-track' }
  lessons.livekit.getParticipant = async () => ({ identity: student.id, metadata: JSON.stringify({ admissionId: lesson.members[1].admissionId }), tracks: media.published ? [{ source: TrackSource.SCREEN_SHARE, muted: false, sid: media.trackSid }] : [] }) as any
  lessons.livekit.removeParticipant = async () => {}; lessons.livekit.deleteRoom = async () => {}
  lessons.livekit.listParticipants = async () => lesson.members.filter((m: any) => m.online).map((m: any) => ({ identity: m.userId }))
  const gateway = new Gateway({ userFromCookie: async (cookie: string) => {
    const user = identities.get(cookie)
    if (!user) throw new ApiError('UNAUTHENTICATED', 'expired', 401)
    return user
  } } as any, lessons, features)
  const makeSocket = (name: string, user: User, platform: string) => {
    const events: Array<{ event: string; payload: any }> = [], rooms = new Set<string>()
    return { id: name + randomUUID(), data: { user }, events, rooms,
      handshake: { headers: { cookie: name }, auth: { platform, contractRevision: 4 } },
      emit: (event: string, payload: any) => events.push({ event, payload }),
      volatile: { emit: (event: string, payload: any) => events.push({ event, payload }) },
      join: (room: string) => rooms.add(room), leave: (room: string) => rooms.delete(room), disconnect: () => rooms.clear(),
    }
  }
  const teacherSocket = makeSocket('teacher', teacher, 'web'), studentSocket = makeSocket('student', student, 'android'), otherSocket = makeSocket('other', other, 'android')
  const sockets = new Map([teacherSocket, studentSocket, otherSocket].map(socket => [socket.id, socket]))
  gateway.server = { sockets: { sockets }, to: () => ({ emit: () => {} }), emit: () => {} } as any
  gateway.onModuleInit()
  for (const socket of sockets.values()) assert.equal((await gateway.subscribe(socket as any, { lessonId: id })).ok, true)
  const command = (socket: typeof teacherSocket, type: CommandEnvelope['type'], payload: any, expectedShareId?: string) =>
    gateway.command(socket as any, { lessonId: id, type, payload, expectedShareId, requestId: randomUUID() })
  const request = async () => {
    const result = await command(teacherSocket, 'assistance.request', { studentId: student.id })
    assert.equal(result.ok, true, JSON.stringify(result))
    return (result as any).snapshot.assistance
  }
  const activate = async () => {
    const session = await request()
    assert.equal((await command(studentSocket, 'assistance.respond', { sessionId: session.id, approved: true })).ok, true)
    const started = await command(studentSocket, 'assistance.start', { sessionId: session.id, geometry })
    assert.equal(started.ok, true, JSON.stringify(started))
    return (started as any).snapshot.assistance
  }
  const pointer = (session: any, overrides = {}) => ({ lessonId: id, sessionId: session.id, shareId: session.shareId, geometryVersion: session.geometry.version, x: .25, y: .75, ...overrides })
  return { id, teacher, student, other, lesson, lessons, gateway, features, identities, media, clock, sockets, teacherSocket, studentSocket, otherSocket, makeSocket, command, request, activate, pointer, materials }
}
const code = (response: any) => response.error?.code
const pointers = (socket: { events: Array<{ event: string; payload: any }> }) => socket.events.filter(entry => entry.event === 'assistance.pointer')

test('textbook sharing publishes the selected first page to legacy students and preserves an open document', async () => {
  const f = await fixture()
  f.teacherSocket.handshake.auth.contractRevision = 11
  f.lesson.instructionPhase = 'classroom'
  const add = (ownerId: string, kind = 'document') => {
    const id = randomUUID()
    f.materials.set(id, { id, ownerId, kind, pages: 4, name: 'Class material', size: 16000, createdAt: new Date() })
    return id
  }
  const first = add(f.teacher.id)
  const second = add(f.teacher.id)
  const foreign = add(randomUUID())
  const video = add(f.teacher.id, 'media')
  const open = (materialId: string, page: number, socket = f.teacherSocket) =>
    f.command(socket, 'document.open', { materialId, page })
  const legacySnapshot = () => f.studentSocket.events.filter(event => event.event === 'snapshot').at(-1)?.payload

  const unavailable = f.makeSocket('teacher', f.teacher, 'web')
  unavailable.handshake.auth.contractRevision = 10
  assert.equal(code(await open(first, 3, unavailable)), 'CLIENT_UPDATE_REQUIRED')
  unavailable.handshake.auth.contractRevision = 11
  assert.equal(code(await open(first, 3, unavailable)), 'FORBIDDEN')
  f.otherSocket.handshake.auth.contractRevision = 11
  assert.equal(code(await open(first, 3, f.otherSocket)), 'FORBIDDEN')

  assert.equal((await open(first, 3)).ok, true)
  const shared = f.lesson.share
  assert.equal(shared.page, 3)
  assert.equal(legacySnapshot()?.share?.page, 3)
  assert.equal(legacySnapshot()?.share?.id, shared.id)
  for (const phase of ['preparing', 'mirroring']) {
    f.lesson.instructionPhase = phase
    assert.equal(code(await open(second, 1)), 'LESSON_MODE_REQUIRED')
    assert.equal(f.lesson.share.id, shared.id)
  }
  f.lesson.instructionPhase = 'classroom'
  f.lesson.members[0].online = false
  assert.equal(code(await open(second, 1)), 'NOT_CONNECTED')
  f.lesson.members[0].online = true
  assert.equal(code(await open(foreign, 1)), 'INVALID_MATERIAL')
  assert.equal(code(await open(video, 1)), 'INVALID_MATERIAL')
  assert.equal(code(await open(first, 5)), 'VALIDATION')
  assert.deepEqual(f.lesson.share, shared)

  assert.equal((await open(first, 4)).ok, true)
  assert.equal(f.lesson.share.id, shared.id)
  assert.equal(legacySnapshot()?.share?.page, 4)
  assert.equal((await open(second, 2)).ok, true)
  assert.notEqual(f.lesson.share.id, shared.id)
  assert.equal(legacySnapshot()?.share?.page, 2)

  f.lesson.instructionPhase = null
  assert.equal((await open(first, 1)).ok, true)
  assert.equal(legacySnapshot()?.share?.page, 1)
})

test('lesson modes require a connected owner and preserve the start time and legacy rooms', async () => {
  const f = await fixture()
  assert.equal(code(await f.command(f.teacherSocket, 'lesson.start', {})), 'CLIENT_UPDATE_REQUIRED')
  f.teacherSocket.handshake.auth.contractRevision = 10
  f.studentSocket.handshake.auth.contractRevision = 10
  assert.equal(code(await f.command(f.teacherSocket, 'lesson.start', {})), 'FEATURE_UNAVAILABLE')
  f.lesson.instructionPhase = 'preparing'
  assert.deepEqual((await f.lessons.snapshot(f.id)).instruction, { phase: 'preparing', startedAt: null })
  assert.equal(code(await f.command(f.studentSocket, 'lesson.start', {})), 'FORBIDDEN')
  f.lesson.members[0].online = false
  assert.equal(code(await f.command(f.teacherSocket, 'lesson.start', {})), 'NOT_CONNECTED')
  f.lesson.members[0].online = true
  assert.equal((await f.command(f.teacherSocket, 'share.stop', {}, randomUUID())).ok, true)
  const unconnected = f.makeSocket('teacher', f.teacher, 'web')
  unconnected.handshake.auth.contractRevision = 10
  assert.equal(code(await f.command(unconnected, 'lesson.start', {})), 'FORBIDDEN')
  assert.equal(code(await f.command(f.teacherSocket, 'share.start', { type: 'screen' })), 'LESSON_MODE_REQUIRED')
  assert.equal(code(await f.command(f.teacherSocket, 'assistance.request', { studentId: f.student.id })), 'LESSON_MODE_REQUIRED')
  assert.equal((await f.command(f.teacherSocket, 'lesson.start', {})).ok, true)
  const started = (await f.lessons.snapshot(f.id)).instruction
  assert.equal(started?.phase, 'classroom')
  assert.ok(started?.startedAt)
  assert.equal((await f.command(f.teacherSocket, 'lesson.start', {})).ok, true)
  assert.deepEqual((await f.lessons.snapshot(f.id)).instruction, started)
  assert.equal(code(await f.command(f.studentSocket, 'share.start', { type: 'screen' })), 'FORBIDDEN')
})

test('mode changes clear only confirmed shares or requests and reject late approvals and cleanup', async () => {
  const f = await fixture()
  f.teacherSocket.handshake.auth.contractRevision = 10
  f.studentSocket.handshake.auth.contractRevision = 10
  f.lesson.instructionPhase = 'classroom'
  const change = (mode: 'classroom' | 'mirroring', shareId: string | null, assistanceId: string | null, socket = f.teacherSocket) =>
    f.command(socket, 'lesson.mode.set', { mode, expectedMode: mode === 'classroom' ? 'mirroring' : 'classroom',
      expectedShareId: shareId, expectedAssistanceId: assistanceId })
  assert.equal(code(await change('mirroring', null, null, f.studentSocket)), 'FORBIDDEN')
  assert.equal((await f.command(f.teacherSocket, 'share.start', { type: 'screen' })).ok, true)
  const firstShare = f.lesson.share.id
  assert.equal(code(await change('mirroring', null, null)), 'LESSON_MODE_CHANGED')
  assert.equal(f.lesson.share.id, firstShare)
  assert.equal((await change('mirroring', firstShare, null)).ok, true)
  assert.equal(f.lesson.share, null)
  assert.equal(code(await f.command(f.teacherSocket, 'share.start', { type: 'screen' })), 'LESSON_MODE_REQUIRED')
  const denied = await f.request()
  assert.equal((await f.command(f.studentSocket, 'assistance.respond', { sessionId: denied.id, approved: false })).ok, true)
  const cancelled = await f.request()
  assert.equal((await f.command(f.teacherSocket, 'assistance.stop', { sessionId: cancelled.id })).ok, true)
  const pending = await f.request()
  assert.equal(code(await change('classroom', null, cancelled.id)), 'LESSON_MODE_CHANGED')
  assert.equal((await change('classroom', null, pending.id)).ok, true)
  assert.equal(code(await f.command(f.studentSocket, 'assistance.respond', { sessionId: pending.id, approved: true })), 'LESSON_MODE_REQUIRED')
  assert.equal((await change('mirroring', null, null)).ok, true)
  const mirrored = await f.activate()
  assert.equal('trackSid' in mirrored, false)
  f.lessons.receiver.receive = (async () => ({
    event: 'track_unpublished', room: { name: f.lesson.roomName }, participant: { identity: f.student.id },
    track: { source: TrackSource.SCREEN_SHARE, sid: 'previous-student-track' },
  })) as typeof f.lessons.receiver.receive
  await f.lessons.webhook('', '')
  assert.equal(f.lesson.share.id, mirrored.shareId)
  assert.equal((await change('classroom', mirrored.shareId, mirrored.id)).ok, true)
  assert.equal(f.lesson.share, null)
  assert.equal((await f.command(f.teacherSocket, 'share.start', { type: 'screen' })).ok, true)
  const newShare = f.lesson.share.id
  await f.command(f.teacherSocket, 'share.stop', {}, firstShare)
  assert.equal(f.lesson.share.id, newShare)
})

test('only the requested student can consent, and published screen plus approval are required', async () => {
  const f = await fixture(), session = await f.request()
  assert.equal(session.status, 'pending'); assert.equal(Date.parse(session.expiresAt) - f.clock.now, 60000)
  assert.equal('teacherSocketId' in session, false); assert.equal('studentSocketId' in session, false)
  assert.equal(code(await f.command(f.otherSocket, 'assistance.respond', { sessionId: session.id, approved: true })), 'FORBIDDEN')
  assert.equal(code(await f.command(f.teacherSocket, 'assistance.start', { sessionId: session.id, geometry })), 'FORBIDDEN')
  assert.equal(code(await f.command(f.studentSocket, 'assistance.start', { sessionId: session.id, geometry })), 'CONSENT_REQUIRED')
  const approved = await f.command(f.studentSocket, 'assistance.respond', { sessionId: session.id, approved: true })
  assert.equal(Date.parse((approved as any).snapshot.assistance.expiresAt) - f.clock.now, 120000)
  f.media.published = false
  assert.equal(code(await f.command(f.studentSocket, 'assistance.start', { sessionId: session.id, geometry })), 'SCREEN_NOT_PUBLISHED')
  assert.equal(f.lesson.share, null)
  f.media.published = true
  const started = await f.command(f.studentSocket, 'assistance.start', { sessionId: session.id, geometry })
  assert.equal((started as any).snapshot.assistance.status, 'active')
  assert.equal((started as any).snapshot.assistance.expiresAt, null)
  assert.equal(f.lesson.share.assistanceId, session.id); assert.equal(f.lesson.share.ownerId, f.student.id)
})

test('teacher ownership, Android/revision support and unavailable features cannot be bypassed by payloads', async () => {
  const f = await fixture()
  assert.equal(code(await f.command(f.studentSocket, 'assistance.request', { studentId: f.other.id, role: 'teacher' })), 'FORBIDDEN')
  f.studentSocket.handshake.auth.platform = 'ios'
  assert.equal(code(await f.command(f.teacherSocket, 'assistance.request', { studentId: f.student.id })), 'ASSISTANCE_UNAVAILABLE')
  f.studentSocket.handshake.auth.platform = 'android'; f.studentSocket.handshake.auth.contractRevision = 3
  assert.equal(code(await f.command(f.teacherSocket, 'assistance.request', { studentId: f.student.id })), 'CLIENT_UPDATE_REQUIRED')
  f.studentSocket.handshake.auth.contractRevision = 4
  const definitions = (f.features as any).definitions
  const original = definitions.get('meeting.remote-assistance')
  definitions.set('meeting.remote-assistance', { ...original, stage: 'planned', defaultEnabled: false })
  assert.equal(code(await f.command(f.teacherSocket, 'assistance.request', { studentId: f.student.id })), 'FEATURE_UNAVAILABLE')
  definitions.set('meeting.remote-assistance', original)
  const session = await f.activate()
  definitions.set('meeting.remote-assistance', { ...original, stage: 'planned', defaultEnabled: false })
  assert.equal((await f.command(f.studentSocket, 'assistance.stop', { sessionId: session.id })).ok, true)
  assert.equal(f.lesson.share, null); assert.equal(f.lessons.assistance.current(f.id), undefined)
})

test('pending and approved requests expire, denial is final and stale stop cannot clear a new share', async () => {
  const f = await fixture(), pending = await f.request()
  f.clock.now += 60000
  assert.equal(code(await f.command(f.studentSocket, 'assistance.respond', { sessionId: pending.id, approved: true })), 'STALE_ASSISTANCE')
  const approved = await f.request()
  await f.command(f.studentSocket, 'assistance.respond', { sessionId: approved.id, approved: true })
  f.clock.now += 120000
  assert.equal(code(await f.command(f.studentSocket, 'assistance.start', { sessionId: approved.id, geometry })), 'STALE_ASSISTANCE')
  const denied = await f.request()
  await f.command(f.studentSocket, 'assistance.respond', { sessionId: denied.id, approved: false })
  assert.equal(f.lessons.assistance.current(f.id), undefined)
  assert.equal(code(await f.command(f.studentSocket, 'assistance.start', { sessionId: denied.id, geometry })), 'STALE_ASSISTANCE')
  const active = await f.activate(), shareId = f.lesson.share.id
  assert.equal(code(await f.command(f.studentSocket, 'assistance.stop', { sessionId: denied.id })), 'STALE_ASSISTANCE')
  assert.equal(f.lesson.share.id, shareId); assert.equal(f.lessons.assistance.current(f.id)?.id, active.id)
})

test('pointer is teacher-only, session/share/geometry-bound and delivered to one Android student', async () => {
  const f = await fixture(), session = await f.activate()
  await f.gateway.assistancePointer(f.teacherSocket as any, f.pointer(session, { authorId: f.other.id, targetUserId: f.other.id }))
  assert.equal(pointers(f.studentSocket).length, 1); assert.equal(pointers(f.studentSocket)[0].payload.authorId, f.teacher.id)
  assert.equal('targetUserId' in pointers(f.studentSocket)[0].payload, false)
  assert.equal(pointers(f.teacherSocket).length, 0); assert.equal(pointers(f.otherSocket).length, 0)
  await f.gateway.assistancePointer(f.studentSocket as any, f.pointer(session))
  assert.equal(f.studentSocket.events.at(-1)?.payload.code, 'FORBIDDEN')
  for (const invalid of [{ x: -1 }, { y: Infinity }, { x: NaN }]) await f.gateway.assistancePointer(f.teacherSocket as any, f.pointer(session, invalid))
  assert.equal(f.teacherSocket.events.at(-1)?.payload.code, 'VALIDATION')
  for (const stale of [{ shareId: randomUUID() }, { sessionId: randomUUID() }, { geometryVersion: 99 }]) await f.gateway.assistancePointer(f.teacherSocket as any, f.pointer(session, stale))
  assert.equal(pointers(f.studentSocket).length, 1)
  assert.equal((await f.lessons.snapshot(f.id)).strokes.length, 0)
})

test('geometry updates require the approved student and increasing versions', async () => {
  const f = await fixture(), session = await f.activate(), next = { width: 2400, height: 1080, rotation: 90, version: 2 }
  assert.equal(code(await f.command(f.teacherSocket, 'assistance.geometry', { sessionId: session.id, geometry: next })), 'FORBIDDEN')
  assert.equal((await f.command(f.studentSocket, 'assistance.geometry', { sessionId: session.id, geometry: next })).ok, true)
  assert.equal(code(await f.command(f.studentSocket, 'assistance.geometry', { sessionId: session.id, geometry })), 'STALE_GEOMETRY')
  assert.equal(code(await f.command(f.studentSocket, 'assistance.geometry', { sessionId: session.id, geometry: { ...next, rotation: 45 } })), 'VALIDATION')
  await f.gateway.assistancePointer(f.teacherSocket as any, f.pointer(session))
  assert.equal(pointers(f.studentSocket).length, 0)
  await f.gateway.assistancePointer(f.teacherSocket as any, f.pointer(session, { geometryVersion: 2 }))
  assert.equal(pointers(f.studentSocket).length, 1)
})

test('replacement subscription and disconnect revoke consent without restoring it on reconnect', async () => {
  const f = await fixture(), session = await f.activate()
  const replacement = f.makeSocket('student', f.student, 'android'); f.sockets.set(replacement.id, replacement)
  assert.equal((await f.gateway.subscribe(replacement as any, { lessonId: f.id })).ok, true)
  assert.equal(f.lessons.assistance.current(f.id), undefined); assert.equal(f.lesson.share, null)
  assert.equal(code(await f.command(replacement, 'assistance.start', { sessionId: session.id, geometry })), 'STALE_ASSISTANCE')
  const pending = await f.request()
  assert.equal((await f.command(replacement, 'assistance.respond', { sessionId: pending.id, approved: true })).ok, true)
  f.gateway.handleDisconnect(f.studentSocket as any)
  assert.equal(f.lessons.assistance.current(f.id)?.id, pending.id, 'old socket disconnect cannot revoke the replacement consent')
  f.gateway.handleDisconnect(replacement as any)
  assert.equal(f.lessons.assistance.current(f.id), undefined, 'grant must be revoked before asynchronous database cleanup')
})

test('late pointer authorization cannot overtake a newer click or survive rotation/stop', async () => {
  for (const action of ['new-click', 'rotation', 'stop']) {
    const f = await fixture(), session = await f.activate()
    const authenticate = f.gateway.auth.userFromCookie.bind(f.gateway.auth)
    let unblock!: () => void, entered!: () => void, firstStudent = true
    const blocked = new Promise<void>(resolve => { unblock = resolve }), waiting = new Promise<void>(resolve => { entered = resolve })
    f.gateway.auth.userFromCookie = async cookie => {
      const user = await authenticate(cookie)
      if (user.id === f.student.id && firstStudent) { firstStudent = false; entered(); await blocked }
      return user
    }
    const late = f.gateway.assistancePointer(f.teacherSocket as any, f.pointer(session))
    await waiting
    if (action === 'new-click') await f.gateway.assistancePointer(f.teacherSocket as any, f.pointer(session, { x: .8 }))
    if (action === 'rotation') await f.command(f.studentSocket, 'assistance.geometry', { sessionId: session.id, geometry: { ...geometry, rotation: 180, version: 2 } })
    if (action === 'stop') await f.command(f.studentSocket, 'assistance.stop', { sessionId: session.id })
    unblock(); await late
    assert.deepEqual(pointers(f.studentSocket).map(entry => entry.payload.x), action === 'new-click' ? [.8] : [])
  }
})

test('expired endpoint authentication revokes consent and cannot deliver a pointer', async () => {
  for (const endpoint of ['teacher', 'student']) {
    const f = await fixture(), session = await f.activate()
    f.identities.delete(endpoint)
    await f.gateway.assistancePointer(f.teacherSocket as any, f.pointer(session))
    assert.equal(f.lessons.assistance.current(f.id), undefined)
    assert.equal((await f.lessons.snapshot(f.id)).share, null)
    assert.equal(pointers(f.studentSocket).length, 0)
    if (endpoint === 'student') assert.equal((await f.command(f.teacherSocket, 'assistance.request', { studentId: f.other.id })).ok, true, 'recipient expiry must not invalidate the teacher subscription')
  }
})

test('disconnect during capture creation cannot persist an orphan share or restore approval', async () => {
  const f = await fixture(), session = await f.request()
  await f.command(f.studentSocket, 'assistance.respond', { sessionId: session.id, approved: true })
  let unblock!: () => void, entered!: () => void
  const blocked = new Promise<void>(resolve => { unblock = resolve }), waiting = new Promise<void>(resolve => { entered = resolve })
  const update = f.lessons.db.lesson.update.bind(f.lessons.db.lesson)
  ;(f.lessons.db.lesson as any).update = async (input: any) => {
    const result = await update(input)
    if (input.data.share?.assistanceId === session.id) { entered(); await blocked }
    return result
  }
  const starting = f.command(f.studentSocket, 'assistance.start', { sessionId: session.id, geometry })
  await waiting
  const snapshot = f.lessons.snapshot(f.id)
  f.gateway.handleDisconnect(f.studentSocket as any)
  assert.equal(f.lessons.assistance.current(f.id), undefined)
  unblock()
  assert.equal(code(await starting), 'STALE_ASSISTANCE')
  assert.equal((await snapshot).share, null)
  assert.equal(f.lesson.share, null)
})

test('leave, kick, end and ordinary sharing clean up assistance; restarted state cannot restore approval', async () => {
  for (const action of ['leave', 'kick', 'end', 'share.stop', 'share.start', 'restart']) {
    const f = await fixture(), session = await f.activate()
    if (action === 'leave') await f.lessons.leave(f.id, f.student)
    if (action === 'kick') await f.lessons.kick(f.id, f.teacher, { userId: f.student.id })
    if (action === 'end') await f.lessons.end(f.id, f.teacher)
    if (action === 'share.stop') await f.command(f.studentSocket, 'share.stop', {})
    if (action === 'share.start') await f.command(f.teacherSocket, 'share.start', { type: 'screen' })
    if (action === 'restart') { (f.lessons as any).assistance = new AssistanceSessions(); await f.lessons.reconcile() }
    assert.equal(f.lessons.assistance.current(f.id), undefined, action)
    assert.notEqual(f.lesson.share?.assistanceId, session.id, action)
    if (action === 'share.start') assert.equal(f.lesson.share.ownerId, f.teacher.id, 'a replacement ordinary share must be preserved')
    else assert.equal(f.lesson.share, null, action)
  }
})
