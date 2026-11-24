import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'

// Run inside the local API container: docker compose exec -T api node --input-type=module - < ../../server/test/subject-storage.integration.mjs
const origin = process.env.SUBJECT_TEST_ORIGIN || 'http://localhost:3000'
const current = { 'X-ThinkMeet-Platform': 'web', 'X-ThinkMeet-Contract-Revision': '15' }
const legacy = { 'X-ThinkMeet-Platform': 'web', 'X-ThinkMeet-Contract-Revision': '14' }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')

test('lessons require a subject and materials and note images are stored under it', async () => {
  const database = new PrismaClient()
  const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY || '', secretAccessKey: process.env.S3_SECRET_KEY || '' } })
  const userIds = []
  const password = randomUUID()

  async function api(path, { cookie, data, form, method = data === undefined && form === undefined ? 'GET' : 'POST', headers = current } = {}) {
    const response = await fetch(new URL(`/api/v1${path}`, origin), {
      method,
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: form ?? (data === undefined ? undefined : JSON.stringify(data)),
    })
    return { status: response.status, body: await response.json().catch(() => null), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  const file = (bytes, name, type, fields = {}) => {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.append(key, value)
    form.append('file', new Blob([bytes], { type }), name)
    return form
  }

  try {
    const passwordHash = await argon2.hash(password)
    async function account(role) {
      const user = await database.user.create({ data: { username: `subject_storage_${randomUUID()}`, name: '과목 보관 검증', role, passwordHash } })
      userIds.push(user.id)
      const session = await api('/auth/login', { data: { username: user.username, password } })
      assert.equal(session.status, 201)
      return { id: user.id, cookie: session.cookie }
    }
    const owner = await account('teacher')
    const student = await account('student')
    await database.teacherStudent.create({ data: { teacherId: owner.id, studentId: student.id } })
    const math = await database.teacherSubject.create({ data: { teacherId: owner.id, name: '수학' }, select: { id: true, name: true } })
    const english = await database.teacherSubject.create({ data: { teacherId: owner.id, name: '영어' }, select: { id: true, name: true } })

    // 1. Revision 15 clients must pick a subject; older clients keep creating unclassified lessons.
    const lesson = { title: '과목 보관 검증', startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: null, accessMode: 'INVITE_ONLY', studentIds: [student.id] }
    const create = (extra = {}, headers = current) => api('/lessons', { ...owner, data: { ...lesson, ...extra }, headers })
    const missing = await create()
    assert.equal(missing.status, 400)
    assert.equal(missing.body.code, 'VALIDATION')
    assert.equal((await create({ subjectId: null })).status, 400)
    const unclassified = await create({}, legacy)
    assert.equal(unclassified.status, 201)
    assert.equal(unclassified.body.subject, undefined)
    const mathLesson = (await create({ subjectId: math.id, startsAt: new Date(Date.now() + 1800_000).toISOString() })).body
    assert.deepEqual(mathLesson.subject, math)
    const englishLesson = (await create({ subjectId: english.id })).body
    const starts = new Map([[mathLesson.id, mathLesson.startsAt]])
    // The math lesson starts first so it stays the student's worksheet target after edits.
    const edit = (id, extra, headers = current) => api(`/lessons/${id}`, { ...owner, method: 'PATCH', data: { ...lesson, startsAt: starts.get(id) ?? lesson.startsAt, ...extra }, headers })
    assert.equal((await edit(mathLesson.id, { subjectId: null })).status, 400)
    assert.equal((await edit(unclassified.body.id, {})).status, 400)
    assert.equal((await edit(mathLesson.id, { title: '과목 유지' })).status, 200)
    assert.equal((await edit(unclassified.body.id, { title: '구버전 수정' }, legacy)).status, 200)

    // 2. Materials uploaded in a lesson go under its subject; the lesson lists that subject plus unclassified files.
    const upload = (lessonId, headers = current) => api(`/materials${lessonId ? `?lessonId=${lessonId}` : ''}`, { ...owner, form: file(pdf, '교재.pdf', 'application/pdf'), headers })
    const mathFile = await upload(mathLesson.id)
    assert.equal(mathFile.status, 201)
    assert.deepEqual(mathFile.body.subject, math)
    const englishFile = (await upload(englishLesson.id)).body
    assert.deepEqual(englishFile.subject, english)
    const looseFile = (await upload()).body
    assert.equal(looseFile.subject, undefined)
    assert.equal((await upload(mathLesson.id, legacy)).status, 426)
    const stored = await database.material.findUnique({ where: { id: mathFile.body.id } })
    assert.equal(stored.subjectId, math.id)
    assert.match(stored.objectKey, new RegExp(`^subjects/${math.id}/materials/`))
    const ids = response => response.body.map(material => material.id).sort()
    assert.deepEqual(ids(await api(`/materials?lessonId=${mathLesson.id}`, owner)), [mathFile.body.id, looseFile.id].sort())
    assert.deepEqual(ids(await api(`/materials?lessonId=${unclassified.body.id}`, owner)), [mathFile.body.id, englishFile.id, looseFile.id].sort())
    assert.deepEqual(ids(await api('/materials', owner)), [mathFile.body.id, englishFile.id, looseFile.id].sort())
    assert.equal((await api(`/materials?lessonId=${mathLesson.id}`, student)).status, 403)

    // 3. A worksheet submitted to the math lesson is stored under math and moves when the scheduled lesson's subject changes.
    const target = await api('/class-notes/target', student)
    assert.equal(target.body.lesson.id, mathLesson.id)
    assert.deepEqual(target.body.lesson.subject, math)
    const worksheet = await api(`/class-notes/lessons/${mathLesson.id}/worksheets`, { ...student, form: file(png, 'sheet.png', 'image/png', { requestId: randomUUID() }) })
    assert.equal(worksheet.status, 201)
    const sheetRow = await database.classNoteImage.findUnique({ where: { id: worksheet.body.id } })
    assert.equal(sheetRow.subjectId, math.id)
    assert.match(sheetRow.objectKey, new RegExp(`^subjects/${math.id}/class-notes/`))
    const correction = await api(`/class-notes/worksheets/${worksheet.body.id}/correction`, { ...owner, form: file(png, 'fix.png', 'image/png', { requestId: randomUUID() }) })
    assert.equal(correction.status, 201)
    assert.equal((await database.classNoteImage.findUnique({ where: { id: correction.body.id } })).subjectId, math.id)
    assert.equal((await edit(mathLesson.id, { subjectId: english.id })).status, 200)
    assert.deepEqual((await database.classNoteImage.findMany({ where: { lessonId: mathLesson.id } })).map(row => row.subjectId), [english.id, english.id])
    const listed = await api(`/class-notes/worksheets?lessonId=${mathLesson.id}`, owner)
    assert.deepEqual(listed.body[0].lesson.subject, english)

    // 4. A screen saved during the live lesson is stored under the lesson's subject.
    const admissionId = randomUUID(), shareId = randomUUID()
    await database.lesson.update({ where: { id: englishLesson.id }, data: { status: 'LIVE', startedAt: new Date(), share: { id: shareId, type: 'screen', ownerId: owner.id, page: 1, playing: false, position: 0, updatedAt: new Date().toISOString() } } })
    await database.lessonMember.update({ where: { lessonId_userId: { lessonId: englishLesson.id, userId: student.id } }, data: { online: true, admissionId } })
    await database.attendance.create({ data: { lessonId: englishLesson.id, userId: student.id, admissionId } })
    const capture = await api(`/class-notes/lessons/${englishLesson.id}/captures`, { ...student, form: file(png, 'screen.png', 'image/png', { requestId: randomUUID(), shareId, admissionId, page: '1' }) })
    assert.equal(capture.status, 201)
    const captureRow = await database.classNoteImage.findUnique({ where: { id: capture.body.id } })
    assert.equal(captureRow.subjectId, english.id)
    assert.match(captureRow.objectKey, new RegExp(`^subjects/${english.id}/class-notes/`))
    const captures = await api('/class-notes/captures', student)
    assert.deepEqual(captures.body.find(item => item.image.id === capture.body.id).lesson.subject, english)
  } finally {
    try {
      const images = await database.classNoteImage.findMany({ where: { lesson: { teacherId: { in: userIds } } }, select: { objectKey: true } })
      const materials = await database.material.findMany({ where: { ownerId: { in: userIds } }, select: { objectKey: true } })
      for (const { objectKey } of [...images, ...materials]) await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET || 'think-meet', Key: objectKey })).catch(() => {})
      await database.lesson.deleteMany({ where: { teacherId: { in: userIds } } })
      await database.material.deleteMany({ where: { ownerId: { in: userIds } } })
      await database.user.deleteMany({ where: { id: { in: userIds } } })
    } finally {
      await database.$disconnect()
    }
  }
})
