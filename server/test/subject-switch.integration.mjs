import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'

// Run inside an API container built from this tree:
// docker exec -i -w /app <api container> node --input-type=module - < server/test/subject-switch.integration.mjs
const origin = process.env.SUBJECT_TEST_ORIGIN || 'http://localhost:3000'
const current = { 'X-ThinkMeet-Platform': 'web', 'X-ThinkMeet-Contract-Revision': '17' }
const older = { 'X-ThinkMeet-Platform': 'web', 'X-ThinkMeet-Contract-Revision': '16' }

test('a live lesson switches subject into a new live lesson with the same members', async () => {
  const database = new PrismaClient()
  const userIds = []
  const password = randomUUID()
  async function api(path, { cookie, data, headers = current } = {}) {
    const response = await fetch(new URL(`/api/v1${path}`, origin), {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    return { status: response.status, body: await response.json().catch(() => null), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  try {
    const passwordHash = await argon2.hash(password)
    async function account(role) {
      const user = await database.user.create({ data: { username: `subject_switch_${randomUUID()}`, name: `과목 변경 ${role}`, role, passwordHash } })
      userIds.push(user.id)
      const session = await api('/auth/login', { data: { username: user.username, password } })
      assert.equal(session.status, 201)
      return { id: user.id, cookie: session.cookie }
    }
    const owner = await account('teacher')
    const student = await account('student')
    const banned = await account('student')
    for (const id of [student.id, banned.id]) await database.teacherStudent.create({ data: { teacherId: owner.id, studentId: id } })
    const math = await database.teacherSubject.create({ data: { teacherId: owner.id, name: '수학' }, select: { id: true, name: true } })
    const english = await database.teacherSubject.create({ data: { teacherId: owner.id, name: '영어' }, select: { id: true, name: true } })
    const other = await account('teacher')
    const foreign = await database.teacherSubject.create({ data: { teacherId: other.id, name: '과학' }, select: { id: true } })

    const created = await api('/lessons', { ...owner, data: { title: '과목 변경 검증', subjectId: math.id, startsAt: new Date(Date.now() + 600_000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString(), accessMode: 'INVITE_ONLY', studentIds: [student.id, banned.id] } })
    assert.equal(created.status, 201)
    const lesson = created.body
    const switchTo = (id, subjectId, who = owner, headers = current) => api(`/lessons/${id}/subject-switch`, { ...who, data: { subjectId }, headers })

    // Only a live lesson can switch.
    assert.equal((await switchTo(lesson.id, english.id)).status, 409)
    // LiveKit is not part of this check: start the lesson as the teacher's connection would.
    await database.lesson.update({ where: { id: lesson.id }, data: { status: 'LIVE', startedAt: new Date(), instructionPhase: 'classroom', instructionStartedAt: new Date() } })
    await database.lessonMember.update({ where: { lessonId_userId: { lessonId: lesson.id, userId: banned.id } }, data: { banned: true } })
    const admissionId = randomUUID(), livekitSid = `PA_${randomUUID()}`
    await database.lessonMember.update({ where: { lessonId_userId: { lessonId: lesson.id, userId: student.id } }, data: { annotationAllowed: true, online: true, admissionId } })
    await database.attendance.create({ data: { lessonId: lesson.id, userId: student.id, admissionId, livekitSid } })
    const share = { id: randomUUID(), type: 'screen', ownerId: owner.id, page: 1, playing: false, position: 0, updatedAt: new Date().toISOString() }
    await database.lesson.update({ where: { id: lesson.id }, data: { share } })
    await database.stroke.create({ data: { id: randomUUID(), lessonId: lesson.id, authorId: owner.id, shareId: share.id, page: 1, tool: 'pen', color: '#000000', points: [{ x: 0.1, y: 0.2 }] } })
    const roomName = (await database.lesson.findUnique({ where: { id: lesson.id } })).roomName

    assert.equal((await switchTo(lesson.id, english.id, owner, older)).status, 426)
    assert.equal((await switchTo(lesson.id, english.id, student)).status, 403)
    assert.equal((await switchTo(lesson.id, math.id)).body.code, 'VALIDATION')
    assert.equal((await switchTo(lesson.id, foreign.id)).status, 403)
    assert.equal((await switchTo(lesson.id, 'not-a-subject')).status, 400)

    const switched = await switchTo(lesson.id, english.id)
    assert.equal(switched.status, 201)
    const next = switched.body
    assert.notEqual(next.id, lesson.id)
    assert.notEqual(next.code, lesson.code)
    assert.deepEqual(next.subject, english)
    assert.equal(next.status, 'LIVE')
    assert.equal(next.title, lesson.title)
    assert.equal(next.endsAt, lesson.endsAt)
    assert.equal(next.instruction.phase, 'classroom')
    assert.deepEqual(next.students.map(user => user.id).sort(), [student.id, banned.id].sort())

    const ended = (await api(`/lessons/${lesson.id}`, owner)).body
    assert.equal(ended.status, 'ENDED')
    assert.equal(ended.nextLessonId, next.id)
    assert.deepEqual(ended.subject, math)
    const members = await database.lessonMember.findMany({ where: { lessonId: next.id } })
    assert.equal(members.find(member => member.userId === banned.id).banned, true)
    // The running LiveKit room, admission, presence and attendance move, so connected media continues.
    const moved = members.find(member => member.userId === student.id)
    assert.equal(moved.annotationAllowed, true)
    assert.equal(moved.online, true)
    assert.equal(moved.admissionId, admissionId)
    assert.equal((await database.lessonMember.findUnique({ where: { lessonId_userId: { lessonId: lesson.id, userId: student.id } } })).online, false)
    const rooms = await database.lesson.findMany({ where: { id: { in: [lesson.id, next.id] } }, select: { id: true, roomName: true } })
    assert.equal(rooms.find(row => row.id === next.id).roomName, roomName)
    assert.notEqual(rooms.find(row => row.id === lesson.id).roomName, roomName)
    assert.equal((await database.attendance.findFirst({ where: { lessonId: next.id, userId: student.id, leftAt: null } })).livekitSid, livekitSid)
    assert.ok((await database.attendance.findFirst({ where: { lessonId: lesson.id, userId: student.id } })).leftAt)
    // Shares end with the old lesson; only the media connection continues.
    const snapshot = (await api(`/lessons/${next.id}/snapshot`, owner)).body
    assert.equal(snapshot.share, null)
    assert.equal(snapshot.strokes.length, 0)
    assert.equal((await api(`/lessons/${lesson.id}/snapshot`, owner)).body.share, null)
    assert.equal(snapshot.participants.find(entry => entry.user.id === student.id).online, true)

    // Students follow the chain; the old link opens the new lesson; banned students stay out.
    assert.equal((await api(`/lessons/${lesson.id}`, student)).body.nextLessonId, next.id)
    assert.equal((await api(`/join/${lesson.code}`, student)).body.id, next.id)
    const join = await api(`/lessons/${next.id}/join`, { ...student, data: {} })
    assert.equal(join.status, 201, JSON.stringify(join.body))
    assert.equal(join.body.waiting, false)
    assert.equal((await api(`/lessons/${next.id}/join`, { ...banned, data: {} })).status, 403)

    // The ended lesson cannot switch again; the new one can.
    assert.equal((await switchTo(lesson.id, english.id)).status, 409)
    const again = await switchTo(next.id, math.id)
    assert.equal(again.status, 201)
    assert.equal((await api(`/join/${lesson.code}`, student)).body.id, again.body.id)
  } finally {
    const lessons = await database.lesson.findMany({ where: { teacherId: { in: userIds } }, select: { id: true } })
    await database.lesson.updateMany({ where: { id: { in: lessons.map(row => row.id) } }, data: { nextLessonId: null } })
    await database.stroke.deleteMany({ where: { lessonId: { in: lessons.map(row => row.id) } } })
    await database.lesson.deleteMany({ where: { id: { in: lessons.map(row => row.id) } } })
    await database.teacherSubject.deleteMany({ where: { teacherId: { in: userIds } } })
    await database.teacherStudent.deleteMany({ where: { teacherId: { in: userIds } } })
    await database.loginSession.deleteMany({ where: { userId: { in: userIds } } })
    await database.user.deleteMany({ where: { id: { in: userIds } } })
    await database.$disconnect()
  }
})
