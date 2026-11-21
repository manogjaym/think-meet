import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'

const base = process.env.ATTENDANCE_TEST_ORIGIN
const database = process.env.ATTENDANCE_TEST_DATABASE_URL
if (!base || !database) throw new Error('Set ATTENDANCE_TEST_ORIGIN and ATTENDANCE_TEST_DATABASE_URL for an isolated migrated test stack.')

test('student attendance uses Seoul months, enrollment, actual participation and durable teacher adjustments', async t => {
  const db = new PrismaClient({ datasourceUrl: database })
  const password = randomUUID()
  const passwordHash = await argon2.hash(password)
  const accounts = []
  const lessons = []
  t.after(async () => {
    try {
      await db.lesson.deleteMany({ where: { id: { in: lessons } } })
      await db.user.deleteMany({ where: { id: { in: accounts } } })
    } finally {
      await db.$disconnect()
    }
  })
  const createUser = async role => {
    const user = await db.user.create({ data: { username: randomUUID(), name: role, role, passwordHash } })
    accounts.push(user.id)
    return user
  }
  const teacher = await createUser('teacher')
  const otherTeacher = await createUser('teacher')
  const student = await createUser('student')
  const unassigned = await createUser('student')
  await db.teacherStudent.createMany({ data: [teacher, otherTeacher].map(owner => ({ teacherId: owner.id, studentId: student.id })) })

  const day = '2026-11-10T07:'
  const date = value => new Date(value)
  const interval = (from, to) => ({
    userId: student.id, admissionId: randomUUID(),
    joinedAt: date(day + from), leftAt: to ? date(day + to) : null,
  })
  async function lesson({ startsAt = '2026-11-10T07:00:00Z', teacherId = teacher.id, member = true, attendance = [], accessMode = 'INVITE_ONLY', status = 'ENDED' } = {}) {
    const id = randomUUID()
    await db.lesson.create({ data: {
      id, teacherId, title: id, code: id, roomName: id, accessMode, status, startsAt: date(startsAt),
      endedAt: status === 'ENDED' ? date(day + '45:00Z') : null,
      members: { create: member ? [{ userId: student.id }] : [] },
      attendance: { create: attendance },
    } })
    lessons.push(id)
    return id
  }
  const present = await lesson({ attendance: [
    interval('02:00Z', '12:00Z'), interval('08:00Z', '18:00Z'), interval('25:00Z'),
  ] })
  const absent = await lesson({ startsAt: '2026-10-31T15:00:00Z' })
  const october = await lesson({ startsAt: '2026-10-31T14:59:59.999Z' })
  const openPresent = await lesson({ accessMode: 'OPEN', attendance: [interval('04:00Z', '14:00Z')] })
  const openWaiting = await lesson({ accessMode: 'OPEN' })
  const cancelled = await lesson({ status: 'CANCELLED' })
  const scheduled = await lesson({ status: 'SCHEDULED' })
  const unenrolled = await lesson({ member: false })
  const foreign = await lesson({ teacherId: otherTeacher.id })

  const headers = { 'X-ThinkMeet-Platform': 'web', 'X-ThinkMeet-Contract-Revision': '8' }
  async function login(user) {
    const response = await fetch(base + '/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, password }),
    })
    assert.equal(response.status, 201, await response.clone().text())
    return response.headers.get('set-cookie').split(';')[0]
  }
  const cookie = await login(teacher)
  const otherCookie = await login(otherTeacher)
  const studentCookie = await login(student)
  const path = `/api/v1/students/${student.id}/attendance`
  const request = (url, { data, session = cookie, revision = '8' } = {}) => fetch(base + url, {
    method: data === undefined ? 'GET' : 'PUT',
    headers: {
      ...headers, 'X-ThinkMeet-Contract-Revision': revision,
      ...(session ? { Cookie: session } : {}),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  async function ok(response) {
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }

  const report = await ok(await request(`${path}?month=2026-11`))
  assert.deepEqual(report.student, { id: student.id, name: student.name })
  assert.deepEqual(report.summary, { rate: 67, present: 2, late: 0, absent: 1 })
  assert.equal(report.rows.at(-1).lessonId, absent)
  assert.deepEqual(new Set(report.rows.map(row => row.lessonId)), new Set([present, absent, openPresent]))
  const presentRow = report.rows.find(row => row.lessonId === present)
  assert.equal(presentRow.firstJoinedAt, day + '02:00.000Z')
  assert.equal(presentRow.lastLeftAt, day + '45:00.000Z')
  assert.equal(presentRow.durationSeconds, 36 * 60)
  assert.equal(presentRow.status, 'PRESENT')
  assert.equal(report.rows.at(-1).status, 'ABSENT')
  assert.equal(report.rows.at(-1).firstJoinedAt, null)
  assert.deepEqual((await ok(await request(`${path}?month=2026-10`))).rows.map(row => row.lessonId), [october])
  assert.deepEqual((await ok(await request(`${path}?month=2026-12`))).summary, { rate: null, present: 0, late: 0, absent: 0 })

  const data = { status: 'LATE', reason: 'DEVICE', memo: '카메라 확인' }
  const url = `${path}/${present}`
  const updated = await ok(await request(url, { data }))
  assert.deepEqual(updated.summary, { rate: 33, present: 1, late: 1, absent: 1 })
  assert.deepEqual(updated.rows.find(row => row.lessonId === present), { ...presentRow, ...data })
  const retries = await Promise.all([request(url, { data }), request(url, { data })])
  for (const retry of retries) assert.deepEqual(await ok(retry), updated)
  assert.equal(await db.studentAttendanceOverride.count({ where: { lessonId: present, studentId: student.id } }), 1)
  assert.deepEqual(await ok(await request(`${path}?month=2026-11`)), updated)

  assert.equal((await request(`${path}?month=2026-11`, { session: null })).status, 401)
  assert.equal((await request(`${path}?month=2026-11`, { session: studentCookie })).status, 403)
  assert.equal((await request(url, { session: studentCookie, data })).status, 403)
  assert.equal((await request(url, { session: otherCookie, data })).status, 404)
  const otherReport = await ok(await request(`${path}?month=2026-11`, { session: otherCookie }))
  assert.deepEqual(otherReport.rows.map(row => row.lessonId), [foreign])
  assert.equal((await request(`/api/v1/students/${unassigned.id}/attendance?month=2026-11`)).status, 403)
  assert.equal((await request(`${path}?month=2026-11`, { revision: '7' })).status, 426)
  assert.equal((await request(`${path}?month=2026-13`)).status, 400)
  for (const id of [openWaiting, cancelled, scheduled, unenrolled, foreign]) {
    assert.equal((await request(`${path}/${id}`, { data })).status, 404)
  }
  assert.equal((await request(url, { data: { ...data, memo: 'a'.repeat(501) } })).status, 400)
  const cleared = await ok(await request(url, { data: { status: 'PRESENT' } }))
  assert.deepEqual(cleared, report)
})
