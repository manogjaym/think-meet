import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'

// Run inside the local API container: docker compose exec -T api node --input-type=module - < ../../server/test/class-note-target.integration.mjs
// Lesson status is a Postgres enum declared SCHEDULED before LIVE, so this needs a real database.
const origin = process.env.NOTE_TARGET_TEST_ORIGIN || 'http://localhost:3000'
const headers = { 'X-ThinkMeet-Platform': 'web', 'X-ThinkMeet-Contract-Revision': '15' }

test('the worksheet target is the live lesson before any scheduled one', async () => {
  const database = new PrismaClient()
  const userIds = []
  try {
    const password = randomUUID()
    const passwordHash = await argon2.hash(password)
    const user = async role => {
      const row = await database.user.create({ data: { username: `note_target_${randomUUID()}`, name: '제출 대상 검증', role, passwordHash } })
      userIds.push(row.id)
      return row
    }
    const teacher = await user('teacher'), student = await user('student')
    const lesson = (title, minutes, status) => database.lesson.create({ data: {
      teacherId: teacher.id, title, status, startsAt: new Date(Date.now() + minutes * 60_000),
      code: randomUUID().slice(0, 12), roomName: `lesson-${randomUUID()}`,
      members: { create: [{ userId: teacher.id }, { userId: student.id }] },
    } })
    const earlier = await lesson('곧 시작할 수업', 15, 'SCHEDULED')
    await lesson('나중 수업', 120, 'SCHEDULED')
    const login = await fetch(`${origin}/api/v1/auth/login`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: student.username, password }) })
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const target = async () => (await (await fetch(`${origin}/api/v1/class-notes/target`, { headers: { ...headers, Cookie: cookie } })).json()).lesson?.id

    assert.equal(await target(), earlier.id)
    // Starts later than `earlier` but is already live.
    const live = await lesson('진행 중 수업', 60, 'LIVE')
    assert.equal(await target(), live.id)
    await database.lesson.update({ where: { id: live.id }, data: { status: 'ENDED' } })
    assert.equal(await target(), earlier.id)
  } finally {
    try {
      await database.lesson.deleteMany({ where: { teacherId: { in: userIds } } })
      await database.user.deleteMany({ where: { id: { in: userIds } } })
    } finally { await database.$disconnect() }
  }
})
