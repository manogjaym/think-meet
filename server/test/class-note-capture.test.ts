import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ClassNotes } from '../src/class-notes'
import type { User } from '../src/generated/contracts'

// Only the capture permission check runs; storage is replaced so no database or S3 is needed.
function fixture(share: (users: { teacher: User; student: User }) => any) {
  const teacher: User = { id: randomUUID(), role: 'teacher', name: 'Teacher', username: 'teacher' }
  const student: User = { id: randomUUID(), role: 'student', name: 'Student', username: 'student' }
  const other: User = { id: randomUUID(), role: 'student', name: 'Other', username: 'other' }
  const admissions = new Map([teacher, student, other].map(user => [user.id, randomUUID()]))
  const current = { id: randomUUID(), page: 1, type: 'screen', playing: false, position: 0, updatedAt: new Date().toISOString(), ...share({ teacher, student }) }
  const lesson = { id: randomUUID(), teacherId: teacher.id, share: current,
    members: [teacher, student, other].map(user => ({ userId: user.id, online: true, admissionId: admissions.get(user.id) })) }
  const db: any = { attendance: { findFirst: async () => ({ id: 'attendance' }) } }
  const notes = new ClassNotes(db, { access: async () => lesson } as any, {} as any)
  ;(notes as any).save = async (_user: User, _fields: unknown, _file: unknown, _target: unknown, authorize: () => Promise<unknown>) => authorize()
  const capture = (user: User) => notes.capture(user, lesson.id, { shareId: current.id, page: 1, admissionId: admissions.get(user.id), requestId: randomUUID() }, undefined)
  return { teacher, student, other, lesson, capture }
}
const rejected = async (promise: Promise<unknown>) => {
  try { await promise } catch (error: any) { return error.getResponse().code }
  return 'accepted'
}

test('a mirrored screen is saved only by its own student and stays private', async () => {
  const mirrored = fixture(({ student }) => ({ ownerId: student.id, assistanceId: randomUUID() }))
  assert.deepEqual(await mirrored.capture(mirrored.student), { lessonId: mirrored.lesson.id, studentId: mirrored.student.id, kind: 'capture' })
  assert.equal(await rejected(mirrored.capture(mirrored.teacher)), 'NOTE_SHARE_CHANGED')
  assert.equal(await rejected(mirrored.capture(mirrored.other)), 'NOTE_SHARE_CHANGED')

  const classroom = fixture(({ teacher }) => ({ ownerId: teacher.id }))
  assert.deepEqual(await classroom.capture(classroom.teacher), { lessonId: classroom.lesson.id, studentId: null, kind: 'capture' })
  assert.deepEqual(await classroom.capture(classroom.other), { lessonId: classroom.lesson.id, studentId: classroom.other.id, kind: 'capture' })
})

test('teachers list worksheets of their own lessons and only the captures they saved', async () => {
  const teacher: User = { id: randomUUID(), role: 'teacher', name: 'Teacher', username: 'teacher' }
  const queries: any[] = []
  const db: any = {
    classNoteImage: { findMany: async (query: any) => { queries.push(query.where); return [] } },
    user: { findMany: async () => [] },
  }
  const notes = new ClassNotes(db, {} as any, {} as any)
  await notes.worksheets(teacher, '2026-11', undefined)
  assert.deepEqual(queries[0].lesson, { teacherId: teacher.id })
  assert.ok(queries[0].createdAt.gte instanceof Date)
  await notes.captures(teacher)
  assert.deepEqual(queries[1], { kind: 'capture', OR: [{ authorId: teacher.id }] })
})
