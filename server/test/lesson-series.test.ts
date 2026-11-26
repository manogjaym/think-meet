import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Lessons } from '../src/lessons'
import { lessonOccurrences, MAX_SERIES_LESSONS } from '../src/lesson-series'
import type { User } from '../src/generated/contracts'

// 2030-01-07 is a Monday. 16:00–16:40 Asia/Seoul = 07:00–07:40 UTC.
const startsAt = '2030-01-07T07:00:00.000Z'
const endsAt = '2030-01-07T07:40:00.000Z'
const seoul = (date: Date) => new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 16)
const code = (fn: () => unknown) => {
  try { fn() } catch (error: any) { return error.getResponse?.().code ?? error.message }
  return 'accepted'
}

test('weekly and biweekly repeats keep the Seoul wall-clock time on chosen weekdays', () => {
  const weekly = lessonOccurrences(startsAt, endsAt, { frequency: 'WEEKLY', weekdays: [2, 5], until: '2030-01-18' })
  assert.deepEqual(weekly.map(slot => seoul(slot.startsAt)), ['2030-01-08T16:00', '2030-01-11T16:00', '2030-01-15T16:00', '2030-01-18T16:00'])
  assert.deepEqual(weekly.map(slot => seoul(slot.endsAt!)), ['2030-01-08T16:40', '2030-01-11T16:40', '2030-01-15T16:40', '2030-01-18T16:40'])

  // The first lesson's week counts, so biweekly skips 2030-01-14 … 01-20.
  const biweekly = lessonOccurrences(startsAt, null, { frequency: 'BIWEEKLY', weekdays: [1, 3], until: '2030-01-28' })
  assert.deepEqual(biweekly.map(slot => seoul(slot.startsAt)), ['2030-01-07T16:00', '2030-01-09T16:00', '2030-01-21T16:00', '2030-01-23T16:00'])
  assert.ok(biweekly.every(slot => slot.endsAt === null))

  // A Sunday first date still starts its own Monday-based week.
  const sunday = lessonOccurrences('2030-01-13T01:00:00.000Z', null, { frequency: 'BIWEEKLY', weekdays: [1, 7], until: '2030-01-28' })
  assert.deepEqual(sunday.map(slot => seoul(slot.startsAt)), ['2030-01-13T10:00', '2030-01-21T10:00', '2030-01-27T10:00'])
})

test('repeat rules reject empty, reversed and oversized ranges', () => {
  assert.equal(code(() => lessonOccurrences(startsAt, endsAt, { frequency: 'WEEKLY', weekdays: [1], until: '2030-01-06' })), 'VALIDATION')
  assert.equal(code(() => lessonOccurrences(startsAt, endsAt, { frequency: 'WEEKLY', weekdays: [6], until: '2030-01-10' })), 'VALIDATION')
  assert.equal(lessonOccurrences(startsAt, endsAt, { frequency: 'WEEKLY', weekdays: [1, 2, 3, 4, 5, 6, 7], until: '2030-04-16' }).length, MAX_SERIES_LESSONS)
  assert.equal(code(() => lessonOccurrences(startsAt, endsAt, { frequency: 'WEEKLY', weekdays: [1, 2, 3, 4, 5, 6, 7], until: '2030-04-17' })), 'VALIDATION')
})

test('a series is created in one transaction only for the teacher', async () => {
  const teacher: User = { id: randomUUID(), role: 'teacher', name: 'Teacher', username: 'teacher' }
  const studentId = randomUUID()
  const created: any[] = []
  let transactions = 0
  const lesson = { create: async ({ data }: any) => { created.push(data); return { ...data, id: randomUUID(), status: 'SCHEDULED', members: [] } } }
  const db: any = {
    teacherStudent: { count: async () => 1 },
    teacherSubject: { findFirst: async () => null },
    lessonMember: { findMany: async () => [] }, user: { findMany: async () => [teacher] }, attendance: { findMany: async () => [] },
    $transaction: async (fn: any) => { transactions++; return fn({ lesson }) },
  }
  const lessons = new Lessons(db, {} as any, { notifyUsers() {}, notifyAllUsers() {} } as any)
  const body = { lesson: { title: '수학', startsAt, endsAt, studentIds: [studentId] }, repeat: { frequency: 'WEEKLY', weekdays: [1, 4], until: '2030-01-17' } }
  const result = await lessons.createSeries(teacher, body)
  assert.equal(transactions, 1)
  assert.deepEqual(result.lessons.map(row => row.startsAt), ['2030-01-07T07:00:00.000Z', '2030-01-10T07:00:00.000Z', '2030-01-14T07:00:00.000Z', '2030-01-17T07:00:00.000Z'])
  assert.equal(new Set(created.map(row => row.code)).size, 4)
  assert.ok(created.every(row => row.members.create.length === 2))

  const student: User = { ...teacher, id: studentId, role: 'student' }
  await assert.rejects(lessons.createSeries(student, body), (error: any) => error.getResponse().code === 'FORBIDDEN')
})
