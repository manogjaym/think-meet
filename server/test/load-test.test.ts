import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import * as argon2 from 'argon2'
import { lessonInput, Lessons } from '../src/lessons'
import { loadStudentCount, prepareLoadClass, LOAD_CLASS_MARKER } from '../src/load-test'

test('explicit null end time is accepted without relaxing finite duration validation', () => {
  const input = { title: 'Manual-ended classroom', startsAt: new Date(Date.now() + 60000).toISOString(), endsAt: null, studentIds: [randomUUID()] }
  assert.equal(lessonInput.safeParse(input).success, true)
  assert.equal(lessonInput.safeParse({ ...input, endsAt: undefined }).success, false)
  assert.equal(lessonInput.safeParse({ ...input, endsAt: new Date(0).toISOString() }).success, false)
})

test('lesson DTO preserves null end time and normal finite dates', async () => {
  const teacher = { id: randomUUID(), username: 'teacher1', name: 'Teacher', role: 'teacher' }
  const db = { user: { findMany: async () => [teacher] }, attendance: { findMany: async () => [] } }
  const svc = new Lessons(db as any)
  const lesson = { id: randomUUID(), title: 'Test', description: '', teacherId: teacher.id, members: [{ userId: teacher.id, online: false }], startsAt: new Date(), endsAt: null, status: 'SCHEDULED', code: 'test', startedAt: null, endedAt: null }
  assert.equal((await svc.dto(lesson)).endsAt, null)
  const end = new Date(Date.now() + 60000)
  assert.equal((await svc.dto({ ...lesson, endsAt: end })).endsAt, end.toISOString())
})

test('virtual student count is bounded to one through one hundred', () => {
  assert.equal(loadStudentCount(10), 10)
  assert.equal(loadStudentCount(100), 100)
  for (const invalid of [0, -1, 101, 1.5, NaN, Infinity]) assert.throws(() => loadStudentCount(invalid))
})

test('load provisioning rejects passwords outside seven to two hundred characters before accessing accounts', async () => {
  for (const password of ['', 'test12', 'x'.repeat(201)]) {
    await assert.rejects(prepareLoadClass({} as any, 2, password), /LOAD_TEST_PASSWORD must contain 7 to 200 characters/)
  }
})

test('load provisioning reuses its open class without touching normal users or unbanning kicked students', async () => {
  const teacher = { id: randomUUID(), username: 'teacher1', name: 'Teacher', role: 'teacher', passwordHash: 'preserve-teacher-password' }
  const normal = { id: randomUUID(), username: 'student1', name: 'Normal Student', role: 'student', passwordHash: 'preserve-student-password' }
  const users = new Map<string, any>([[teacher.username, teacher], [normal.username, normal]])
  const members = new Map<string, any>()
  let savedLesson: any = null
  const db: any = {
    user: {
      findUnique: async ({ where }: any) => users.get(where.username),
      upsert: async ({ where, create, update }: any) => {
        assert.match(where.username, /^load_student_\d{3}$/)
        const value = users.get(where.username) || { id: randomUUID(), ...create }
        if (users.has(where.username)) Object.assign(value, update)
        users.set(where.username, value); return value
      },
    },
    teacherStudent: { upsert: async () => ({}) },
    lesson: {
      findFirst: async ({ where }: any) => { assert.equal(where.description.in.includes(LOAD_CLASS_MARKER), true); assert.equal(where.description.in.includes('GURUMI_LOAD_TEST'), true); return savedLesson },
      create: async ({ data }: any) => { savedLesson = { id: randomUUID(), ...data }; return savedLesson },
      update: async ({ data }: any) => { Object.assign(savedLesson, data); return savedLesson },
    },
    lessonMember: {
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.lessonId_userId.lessonId}:${where.lessonId_userId.userId}`
        const value = members.get(key) || { banned: false, ...create }
        Object.assign(value, update); members.set(key, value); return value
      },
    },
  }
  const first = await prepareLoadClass(db, 2, 'test123')
  assert.equal(savedLesson.endsAt, null)
  assert.equal(savedLesson.status, 'SCHEDULED')
  assert.deepEqual(first.studentUsernames, ['load_student_001', 'load_student_002'])
  for (const username of first.studentUsernames) {
    assert.match(users.get(username).passwordHash, /^\$argon2id\$/)
    assert.equal(await argon2.verify(users.get(username).passwordHash, 'test123'), true)
  }
  users.get('load_student_001').passwordHash = await argon2.hash('previous-load-password', { type: argon2.argon2id })
  const kickedId = users.get('load_student_001').id
  const kicked = members.get(`${first.lessonId}:${kickedId}`); kicked.banned = true
  savedLesson.status = 'LIVE'
  savedLesson.description = 'GURUMI_LOAD_TEST'
  const repeated = await prepareLoadClass(db, 2, 'test123')
  assert.equal(repeated.lessonId, first.lessonId)
  assert.equal(savedLesson.description, LOAD_CLASS_MARKER)
  assert.equal(kicked.banned, true)
  for (const username of repeated.studentUsernames) {
    assert.equal(await argon2.verify(users.get(username).passwordHash, 'test123'), true)
    assert.equal(await argon2.verify(users.get(username).passwordHash, 'previous-load-password'), false)
  }
  assert.equal(users.get('teacher1').passwordHash, 'preserve-teacher-password')
  assert.equal(users.get('student1').passwordHash, 'preserve-student-password')
})
