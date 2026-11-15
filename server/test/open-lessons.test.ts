import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Lessons, lessonInput } from '../src/lessons'
import { ApiError } from '../src/errors'
import type { PublicUser } from '../src/types'

const owner: PublicUser = { id: randomUUID(), username: 'owner', name: 'Owner', role: 'teacher' }
const visitor: PublicUser = { id: randomUUID(), username: 'visitor', name: 'Visitor', role: 'student' }
const visitingTeacher: PublicUser = { id: randomUUID(), username: 'other-teacher', name: 'Other teacher', role: 'teacher' }
const input = () => ({ title: 'Open classroom', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: null, accessMode: 'OPEN' })
const lesson = () => ({ id: randomUUID(), teacherId: owner.id, accessMode: 'OPEN', status: 'SCHEDULED', roomName: 'open-room', members: [{ userId: owner.id, banned: false }] as any[] })
const errorCode = (expected: string) => (error: any) => error instanceof ApiError && (error.getResponse() as any).code === expected
function service(current = lesson(), extra: any = {}) { return new Lessons({ lesson: { findUnique: async () => current }, ...extra } as any) }

test('open booking needs no selected students; default remains invitation-only', () => {
  assert.equal(lessonInput.safeParse(input()).success, true)
  assert.equal(lessonInput.safeParse({ ...input(), studentIds: [] }).success, true)
  assert.equal(lessonInput.safeParse({ ...input(), accessMode: undefined }).success, false)
  assert.equal(lessonInput.safeParse({ ...input(), accessMode: 'PUBLIC' }).success, false)
  assert.equal(lessonInput.parse({ ...input(), accessMode: undefined, studentIds: [visitor.id] }).accessMode, 'INVITE_ONLY')
})

test('open creation persists visibility and only enrolls owner without consulting roster', async () => {
  let created: any; let notifications = 0
  const svc = new Lessons({ lesson: { create: async ({ data }: any) => { created = data; return { ...lesson(), ...data } } } } as any)
  svc.dto = async (row: any) => row
  svc.notifyAllUsers = () => { notifications++ }
  await svc.create(owner, input())
  assert.equal(created.accessMode, 'OPEN')
  assert.deepEqual(created.members.create, [{ userId: owner.id }])
  assert.equal(notifications, 1)
  await assert.rejects(svc.create(visitor, input()), errorCode('FORBIDDEN'))
})

test('open rooms allow uninvited authenticated students and visiting teachers', async () => {
  const current = lesson(); const svc = service(current)
  assert.equal((await svc.access(current.id, visitor)).id, current.id)
  assert.equal((await svc.access(current.id, visitingTeacher)).id, current.id)
  await assert.rejects(service({ ...current, accessMode: 'INVITE_ONLY' }).access(current.id, visitor), errorCode('ACCOUNT'))
})

test('open scheduled join enrolls visitor once and waits without contacting media server', async () => {
  const current = lesson(); let enrollments = 0
  const svc = service(current, { lessonMember: { upsert: async ({ create }: any) => { enrollments++; current.members.push({ ...create, banned: false }) } } })
  svc.dto = async (row: any) => row
  svc.broadcast = async () => ({}) as any
  svc.livekit.listRooms = async () => { throw new Error('Waiting guests must not access LiveKit') }
  const result = await svc.join(current.id, visitingTeacher)
  assert.equal(result.waiting, true)
  assert.equal('token' in result, false)
  assert.equal(result.lesson.members.some((member: any) => member.userId === visitingTeacher.id), true)
  await svc.join(current.id, visitingTeacher)
  assert.equal(enrollments, 1)
})

test('open live join admits visiting teachers with ordinary participant metadata', async () => {
  process.env.LIVEKIT_API_KEY = 'test-key'; process.env.LIVEKIT_API_SECRET = 'test-secret-with-minimum-32-characters'
  const current = { ...lesson(), status: 'LIVE' }; let admission: any
  const svc = service(current, { lessonMember: {
    upsert: async ({ create }: any) => { current.members.push({ ...create, banned: false }) },
    update: async ({ data }: any) => { admission = data.admissionId },
  } })
  svc.dto = async (row: any) => row
  svc.broadcast = async () => ({}) as any
  svc.livekit.listRooms = async () => [{ name: current.roomName }] as any
  const result = await svc.join(current.id, visitingTeacher)
  assert.equal(result.waiting, false)
  assert.ok(result.token)
  const claims = JSON.parse(Buffer.from(result.token!.split('.')[1]!, 'base64url').toString())
  assert.deepEqual(JSON.parse(claims.metadata), { admissionId: admission, userId: visitingTeacher.id, role: 'student' })
})

test('kicked open-room members cannot obtain admission again', async () => {
  const current = lesson(); current.members.push({ userId: visitor.id, banned: true })
  const svc = service(current)
  await assert.rejects(svc.access(current.id, visitor), errorCode('KICKED'))
  await assert.rejects(svc.join(current.id, visitor), errorCode('KICKED'))
})

test('unjoined open-room viewers cannot issue live commands', async () => {
  const current = { ...lesson(), status: 'LIVE' }; const svc = service(current)
  await assert.rejects(svc.command(visitor, { lessonId: current.id, type: 'chat.send', payload: { text: 'Hello', clientId: '1' } }), errorCode('ACCOUNT'))
})

test('visiting teachers cannot manage open rooms or control owner shares', async () => {
  const current = { ...lesson(), status: 'LIVE', share: { id: randomUUID(), ownerId: owner.id, type: 'screen' } }
  current.members.push({ userId: visitingTeacher.id, banned: false })
  const svc = service(current)
  for (const action of [() => svc.end(current.id, visitingTeacher), () => svc.kick(current.id, visitingTeacher, { userId: owner.id }), () => svc.edit(current.id, visitingTeacher, input()), () => svc.invite(current.id, visitingTeacher, { studentIds: [visitor.id] })]) await assert.rejects(action, errorCode('FORBIDDEN'))
  for (const type of ['media.update', 'document.page', 'share.stop']) await assert.rejects(svc.command(visitingTeacher, { lessonId: current.id, type, payload: {} }), errorCode('FORBIDDEN'))
})

test('discovery query includes scheduled and live open lessons alongside account history', async () => {
  let query: any
  const svc = new Lessons({ lesson: { findMany: async (args: any) => { query = args.where; return [] } } } as any)
  await svc.list(visitor)
  assert.deepEqual(query.OR, [{ teacherId: visitor.id }, { members: { some: { userId: visitor.id } } }, { accessMode: 'OPEN', status: { in: ['SCHEDULED', 'LIVE'] } }])
})

test('editing an open lesson preserves existing members, switching to selected-only removes outsiders', async () => {
  const current = lesson(); let deletions = 0; let notifications = 0; let rosterChecks = 0
  current.members.push({ userId: visitor.id, banned: true })
  const db: any = {
    lesson: { findUnique: async () => ({ ...current }), update: async ({ data }: any) => { Object.assign(current, data) } },
    teacherStudent: { count: async () => { rosterChecks++; return 1 } },
    lessonMember: { deleteMany: async () => { deletions++ }, upsert: async () => {} },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  }
  const svc = new Lessons(db); svc.dto = async (row: any) => row; svc.broadcast = async () => ({}) as any; svc.notifyAllUsers = () => { notifications++ }
  await svc.edit(current.id, owner, input())
  assert.equal(deletions, 0)
  assert.equal(rosterChecks, 0)
  assert.equal(current.members.find(member => member.userId === visitor.id)?.banned, true)
  await svc.edit(current.id, owner, { ...input(), accessMode: 'INVITE_ONLY', studentIds: [visitor.id] })
  assert.equal(deletions, 1)
  assert.equal(rosterChecks, 1)
  assert.equal(notifications, 2)
})
