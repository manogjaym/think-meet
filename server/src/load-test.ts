import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'
import { randomBytes, randomUUID } from 'node:crypto'
import { accountPassword } from './passwords'

export const LOAD_CLASS_MARKER = '가상 학생들이 영상을 보내는 테스트 수업입니다. 교사가 종료할 때까지 유지됩니다.'
// Older stored descriptions remain readable so existing test classrooms are reused.
const LEGACY_LOAD_CLASS_MARKER = 'GURUMI_LOAD_TEST'
export const LOAD_CLASS_TITLE = '가상 학생 영상 테스트 · 종료 시간 없음'

export function loadStudentCount(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Virtual student count must be an integer from 1 to 100.')
  return count
}

/** Dedicated test accounts only; regular teachers/students and kicked membership stay unchanged. */
export async function prepareLoadClass(db: PrismaClient, count: number, password: string) {
  loadStudentCount(count)
  accountPassword(password, 'LOAD_TEST_PASSWORD')
  const teacher = await db.user.findUnique({ where: { username: 'teacher1' } })
  if (!teacher || teacher.role !== 'teacher') throw new Error('Run seed first: teacher1 must exist as a teacher.')
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
  const studentUsernames = Array.from({ length: count }, (_, index) => `load_student_${String(index + 1).padStart(3, '0')}`)
  const students = []
  for (const [index, username] of studentUsernames.entries()) {
    const name = `가상 학생 ${String(index + 1).padStart(3, '0')}`
    const previous = await db.user.findUnique({ where: { username } })
    if (previous && (previous.role !== 'student' || previous.name !== name)) throw new Error(`Reserved virtual student account is already used: ${username}`)
    const student = await db.user.upsert({ where: { username }, update: { passwordHash }, create: { username, name, role: 'student', passwordHash } })
    students.push(student)
    await db.teacherStudent.upsert({ where: { teacherId_studentId: { teacherId: teacher.id, studentId: student.id } }, create: { teacherId: teacher.id, studentId: student.id }, update: {} })
  }
  const existing = await db.lesson.findFirst({ where: { teacherId: teacher.id, description: { in: [LOAD_CLASS_MARKER, LEGACY_LOAD_CLASS_MARKER] }, status: { in: ['SCHEDULED', 'LIVE'] } }, orderBy: { createdAt: 'desc' } })
  const lesson = existing
    ? await db.lesson.update({ where: { id: existing.id }, data: { endsAt: null, description: LOAD_CLASS_MARKER } })
    : await db.lesson.create({ data: { teacherId: teacher.id, title: LOAD_CLASS_TITLE, description: LOAD_CLASS_MARKER, status: 'SCHEDULED', startsAt: new Date(), endsAt: null, code: randomBytes(6).toString('hex'), roomName: `lesson-${randomUUID()}` } })
  await db.lessonMember.upsert({ where: { lessonId_userId: { lessonId: lesson.id, userId: teacher.id } }, create: { lessonId: lesson.id, userId: teacher.id }, update: {} })
  for (const student of students) {
    await db.lessonMember.upsert({ where: { lessonId_userId: { lessonId: lesson.id, userId: student.id } }, create: { lessonId: lesson.id, userId: student.id }, update: {} })
  }
  return { lessonId: lesson.id, code: lesson.code, title: lesson.title, teacherUsername: teacher.username, studentUsernames }
}
