import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { RECORDING_CHUNK_SIZE, RECORDING_RETENTION_MS, Recordings } from '../src/recordings'
import { featureClient, mediaFeatureHeaders } from '../src/feature-policy'
import type { User } from '../src/generated/contracts'

// The upload state machine runs against in-memory database and S3 fakes.
function fixture() {
  const teacher: User = { id: randomUUID(), role: 'teacher', name: 'Teacher', username: 'teacher' }
  const other: User = { id: randomUUID(), role: 'teacher', name: 'Other', username: 'other' }
  const lesson = { id: randomUUID(), teacherId: teacher.id, title: '수학', startsAt: new Date(), startedAt: new Date() }
  const rows: any[] = []
  const s3calls: any[] = []
  const matches = (row: any, where: any) => (!where.id || row.id === where.id) && (!where.teacherId || row.teacherId === where.teacherId)
    && (!where.expiresAt?.gt || row.expiresAt > where.expiresAt.gt) && (!where.expiresAt?.lte || row.expiresAt <= where.expiresAt.lte)
  const withLesson = (row: any) => row && { ...row, lesson: { title: lesson.title, startsAt: lesson.startsAt, subject: null } }
  const db: any = { lessonRecording: {
    findFirst: async ({ where }: any) => withLesson(rows.find(row => matches(row, where))),
    findUnique: async ({ where }: any) => withLesson(rows.find(row => row.teacherId === where.teacherId_requestId.teacherId && row.requestId === where.teacherId_requestId.requestId)),
    findMany: async ({ where }: any) => rows.filter(row => matches(row, where)).map(withLesson),
    create: async ({ data }: any) => { const row = { id: randomUUID(), status: 'uploading', uploadedBytes: 0n, parts: [], ...data }; rows.push(row); return withLesson(row) },
    update: async ({ where, data }: any) => withLesson(Object.assign(rows.find(row => row.id === where.id), data)),
    deleteMany: async ({ where }: any) => { const index = rows.findIndex(row => matches(row, where)); if (index >= 0) rows.splice(index, 1); return { count: index >= 0 ? 1 : 0 } },
  } }
  const s3 = { send: async (command: any) => {
    s3calls.push(command.constructor.name)
    if (command.constructor.name === 'CreateMultipartUploadCommand') return { UploadId: 'upload-1' }
    if (command.constructor.name === 'UploadPartCommand') return { ETag: `"etag-${command.input.PartNumber}"` }
    return {}
  } }
  const lessons: any = {
    teacher: (user: User) => { if (user.role !== 'teacher') throw new Error('teacher only') },
    get: async () => lesson,
    locked: async (_id: string, fn: () => Promise<unknown>) => fn(),
  }
  const recordings = new Recordings(db, lessons, { s3, bucket: 'test' } as any)
  return { teacher, other, lesson, rows, s3calls, recordings }
}
const body = (bytes: Buffer) => Object.assign(Readable.from([bytes]), { headers: { 'content-length': String(bytes.length) }, aborted: false }) as any
const mp4 = (length: number) => { const bytes = Buffer.alloc(length); bytes.write('ftyp', 4, 'latin1'); return bytes }
const code = async (promise: Promise<unknown>) => { try { await promise } catch (error: any) { return error.getResponse?.().code ?? error.name } return 'accepted' }

test('a recording uploads chunk by chunk, tolerates a resent chunk and completes once', async () => {
  const { teacher, lesson, rows, s3calls, recordings } = fixture()
  const size = RECORDING_CHUNK_SIZE + 1000
  const input = { requestId: randomUUID(), size, durationMs: 60_000, width: 720, height: 1280, startedAt: new Date().toISOString() }
  const created = await recordings.create(teacher, lesson.id, input)
  assert.equal(created.status, 'uploading')
  assert.equal(created.chunkSize, RECORDING_CHUNK_SIZE)
  assert.equal(Date.parse(created.expiresAt) - Date.parse(created.createdAt), RECORDING_RETENTION_MS)
  // The same request ID resumes the same upload instead of creating another.
  assert.equal((await recordings.create(teacher, lesson.id, input)).id, created.id)
  assert.equal(rows.length, 1)

  assert.equal(await code(recordings.upload(teacher, created.id, '0', body(Buffer.alloc(RECORDING_CHUNK_SIZE)))), 'UNSUPPORTED_FILE')
  assert.equal(await code(recordings.upload(teacher, created.id, '0', body(mp4(1000)))), 'VALIDATION')
  const first = await recordings.upload(teacher, created.id, '0', body(mp4(RECORDING_CHUNK_SIZE)))
  assert.equal(first.uploadedBytes, RECORDING_CHUNK_SIZE)
  assert.equal((await recordings.upload(teacher, created.id, '0', body(mp4(RECORDING_CHUNK_SIZE)))).uploadedBytes, RECORDING_CHUNK_SIZE)
  assert.equal(await code(recordings.upload(teacher, created.id, String(size), body(Buffer.alloc(1)))), 'RECORDING_OFFSET')
  const done = await recordings.upload(teacher, created.id, String(RECORDING_CHUNK_SIZE), body(Buffer.alloc(1000)))
  assert.equal(done.status, 'ready')
  assert.equal(done.uploadedBytes, size)
  assert.equal(s3calls.filter(name => name === 'CompleteMultipartUploadCommand').length, 1)
  assert.deepEqual((await recordings.list(teacher, lesson.id)).map(item => item.id), [created.id])
  // The records tab groups recordings with class-note captures by this lesson summary.
  assert.deepEqual((await recordings.list(teacher, lesson.id))[0].lesson, { id: lesson.id, title: '수학', startsAt: lesson.startsAt.toISOString(), teacherName: 'Teacher' })
})

test('only the lesson owner can upload or see a recording', async () => {
  const { teacher, other, lesson, recordings } = fixture()
  const input = { requestId: randomUUID(), size: 10, durationMs: 1000, width: 720, height: 1280, startedAt: new Date().toISOString() }
  assert.equal(await code(recordings.create(other, lesson.id, input)), 'NOT_FOUND')
  const created = await recordings.create(teacher, lesson.id, input)
  assert.equal(await code(recordings.upload(other, created.id, '0', body(mp4(10)))), 'NOT_FOUND')
  assert.deepEqual(await recordings.list(other, undefined), [])
})

test('expired recordings are removed from storage and the database', async () => {
  const { teacher, lesson, rows, s3calls, recordings } = fixture()
  const created = await recordings.create(teacher, lesson.id, { requestId: randomUUID(), size: 10, durationMs: 1000, width: 720, height: 1280, startedAt: new Date().toISOString() })
  assert.equal(await recordings.removeExpired(new Date(Date.parse(created.expiresAt) - 1)), 0)
  assert.equal(await recordings.removeExpired(new Date(Date.parse(created.expiresAt) + 1)), 1)
  assert.equal(rows.length, 0)
  assert.ok(s3calls.includes('AbortMultipartUploadCommand') && s3calls.includes('DeleteObjectCommand'))
})

test('a media GET may declare its client in the query, but headers take precedence', () => {
  assert.deepEqual(featureClient(mediaFeatureHeaders({}, { platform: 'web', contractRevision: '14' })), { platform: 'web', contractRevision: 14 })
  assert.deepEqual(featureClient(mediaFeatureHeaders({ 'X-ThinkMeet-Platform': 'android', 'X-ThinkMeet-Contract-Revision': '9' }, { platform: 'web', contractRevision: '14' })), { platform: 'android', contractRevision: 9 })
  assert.deepEqual(featureClient(mediaFeatureHeaders({}, {})), { platform: null, contractRevision: 0 })
})
