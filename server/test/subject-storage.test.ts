import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Lessons } from '../src/lessons'
import { Materials } from '../src/materials'
import type { User } from '../src/generated/contracts'

const teacher: User = { id: randomUUID(), role: 'teacher', name: 'Teacher', username: 'teacher' }
const code = async (promise: Promise<unknown>) => {
  try { await promise } catch (error: any) { return error.getResponse?.().code ?? error.message }
  return 'accepted'
}

test('subject-storage clients must create and keep lessons with a subject; older clients may omit it', async () => {
  const subjectId = randomUUID()
  const db: any = {
    teacherSubject: { findFirst: async ({ where }: any) => where.id === subjectId ? { id: subjectId } : null },
    teacherStudent: { count: async () => 0 },
    lesson: { create: async () => { throw new Error('created') } },
  }
  const lessons = new Lessons(db)
  const input = { title: '수학', startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: null, accessMode: 'OPEN' }
  assert.equal(await code(lessons.create(teacher, input, true)), 'VALIDATION')
  assert.equal(await code(lessons.create(teacher, { ...input, subjectId: null }, true)), 'VALIDATION')
  assert.equal(await code(lessons.create(teacher, { ...input, subjectId: randomUUID() }, true)), 'FORBIDDEN')
  assert.equal(await code(lessons.create(teacher, { ...input, subjectId }, true)), 'created')
  assert.equal(await code(lessons.create(teacher, input, false)), 'created')

  // Editing keeps an omitted saved subject but cannot clear it or leave a legacy lesson unclassified.
  const validate = (lessons as any).validateSubject.bind(lessons)
  assert.equal(await code(validate(teacher.id, undefined, true, subjectId)), 'accepted')
  assert.equal(await code(validate(teacher.id, undefined, true, null)), 'VALIDATION')
  assert.equal(await code(validate(teacher.id, null, true, subjectId)), 'VALIDATION')
  assert.equal(await code(validate(teacher.id, null, false, subjectId)), 'accepted')
})

test('a lesson lists its owner subject materials plus unclassified ones', async () => {
  const subjectId = randomUUID()
  const queries: any[] = []
  const db: any = { material: { findMany: async (query: any) => { queries.push(query.where); return [] } } }
  const owned = { teacherId: teacher.id, subjectId }
  let lesson: any = owned
  const materials = new Materials(db, { teacher: () => {}, access: async () => lesson, materialDto: (row: unknown) => row } as any)

  await materials.list(teacher, randomUUID())
  assert.deepEqual(queries.at(-1), { ownerId: teacher.id, OR: [{ subjectId }, { subjectId: null }] })
  await materials.list(teacher)
  assert.deepEqual(queries.at(-1), { ownerId: teacher.id })
  lesson = { teacherId: teacher.id, subjectId: null }
  await materials.list(teacher, randomUUID())
  assert.deepEqual(queries.at(-1), { ownerId: teacher.id })
  // Subjects belong to one teacher, so another teacher's lesson never classifies this teacher's library.
  lesson = { teacherId: randomUUID(), subjectId }
  await materials.list(teacher, randomUUID())
  assert.deepEqual(queries.at(-1), { ownerId: teacher.id })
})
