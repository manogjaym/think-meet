import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'

const origin = process.env.SUBJECT_TEST_ORIGIN || 'http://localhost:3000'
const revision = { 'X-ThinkMeet-Platform': 'web', 'X-ThinkMeet-Contract-Revision': '7' }

test('teacher subjects are private and lesson changes preserve compatibility', async () => {
  const database = new PrismaClient()
  const userIds = []
  const password = randomUUID()

  async function api(path, { cookie, data, method = data === undefined ? 'GET' : 'POST', legacy = false } = {}) {
    const response = await fetch(new URL(`/api/v1${path}`, origin), {
      method,
      headers: {
        ...(legacy ? {} : revision),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }

  try {
    const passwordHash = await argon2.hash(password)
    async function account(role) {
      const user = await database.user.create({
        data: { username: `subjects_test_${randomUUID()}`, name: '과목 검증', role, passwordHash },
      })
      userIds.push(user.id)
      const session = await api('/auth/login', { data: { username: user.username, password } })
      assert.equal(session.status, 201)
      assert.ok(session.cookie)
      return { id: user.id, cookie: session.cookie }
    }
    const owner = await account('teacher')
    const other = await account('teacher')
    const student = await account('student')
    const [math, english, privateSubject] = await Promise.all([
      database.teacherSubject.create({ data: { teacherId: owner.id, name: '수학' }, select: { id: true, name: true } }),
      database.teacherSubject.create({ data: { teacherId: owner.id, name: '영어' }, select: { id: true, name: true } }),
      database.teacherSubject.create({ data: { teacherId: other.id, name: '바로셈' }, select: { id: true, name: true } }),
    ])

    const ownList = await api('/subjects', owner)
    assert.equal(ownList.status, 200)
    assert.deepEqual(new Map(ownList.body.map(subject => [subject.id, subject])), new Map([[math.id, math], [english.id, english]]))
    assert.deepEqual((await api('/subjects', other)).body, [privateSubject])
    assert.equal((await api('/subjects', student)).status, 403)
    assert.equal((await api('/subjects')).status, 401)
    assert.equal((await api('/subjects', { ...owner, legacy: true })).status, 426)

    const lesson = { title: '과목 예약 검증', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: null, accessMode: 'OPEN' }
    const create = (extra = {}, options = {}) => api('/lessons', { ...owner, data: { ...lesson, ...extra }, ...options })
    assert.equal((await create({ subjectId: privateSubject.id })).status, 403)
    assert.equal((await create({ subjectId: math.id }, { legacy: true })).status, 426)
    const legacyLesson = await create({}, { legacy: true })
    assert.equal(legacyLesson.status, 201)
    assert.equal(legacyLesson.body.subject, undefined)
    const created = await create({ subjectId: math.id })
    assert.equal(created.status, 201)
    assert.deepEqual(created.body.subject, math)
    const path = `/lessons/${created.body.id}`
    assert.deepEqual((await api(path, student)).body.subject, math)
    assert.deepEqual((await api('/lessons', student)).body.find(item => item.id === created.body.id).subject, math)

    const edit = (extra = {}, options = {}) => api(path, { ...owner, method: 'PATCH', data: { ...lesson, ...extra }, ...options })
    assert.equal((await edit({ subjectId: privateSubject.id })).status, 403)
    const legacyEdit = await edit({ title: '구버전에서 수정' }, { legacy: true })
    assert.equal(legacyEdit.status, 200)
    assert.deepEqual(legacyEdit.body.subject, math)
    assert.deepEqual((await edit({ subjectId: english.id })).body.subject, english)
    const cleared = await edit({ subjectId: null })
    assert.equal(cleared.status, 200)
    assert.equal((await api(path, owner)).body.subject, undefined)
    assert.equal((await database.lesson.findUnique({ where: { id: created.body.id } })).subjectId, null)

    const recorded = await create({ subjectId: math.id })
    assert.equal(recorded.status, 201)
    const instructionStartedAt = new Date(Date.now() - 10 * 60_000)
    await database.lesson.update({ where: { id: recorded.body.id }, data: {
      status: 'LIVE', startedAt: new Date(Date.now() - 20 * 60_000),
      instructionPhase: 'classroom', instructionStartedAt,
    } })
    const ended = await api(`/lessons/${recorded.body.id}/end`, { ...owner, method: 'POST' })
    assert.equal(ended.status, 201)
    assert.equal(ended.body.status, 'ENDED')
    assert.deepEqual(ended.body.subject, math)
    assert.equal(ended.body.instruction.startedAt, instructionStartedAt.toISOString())
    const history = (await api('/lessons', owner)).body.find(item => item.id === recorded.body.id)
    assert.equal(history.endedAt, ended.body.endedAt)
    assert.deepEqual(history.subject, math)
    assert.deepEqual(history.instruction, ended.body.instruction)
  } finally {
    try {
      await database.lesson.deleteMany({ where: { teacherId: { in: userIds } } })
      await database.user.deleteMany({ where: { id: { in: userIds } } })
    } finally {
      await database.$disconnect()
    }
  }
})
