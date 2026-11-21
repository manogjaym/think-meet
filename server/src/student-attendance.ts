import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { Database } from './auth'
import { ApiError } from './errors'
import type { StudentAttendanceMonth, StudentAttendanceRow } from './generated/contracts'
import type { PublicUser } from './types'

const uuid = z.string().uuid()
const monthInput = z.string().regex(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/, '조회할 월을 확인해 주세요.')
const adjustmentInput = z.object({
  status: z.enum(['PRESENT', 'LATE', 'ABSENT']),
  reason: z.enum(['DEVICE', 'NETWORK', 'OTHER']).nullish(),
  memo: z.string().max(500).trim().nullish(),
})
const seoul = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
type Student = StudentAttendanceMonth['student']

function monthBounds(month: string) {
  const [year, number] = month.split('-').map(Number)
  return { gte: new Date(Date.UTC(year, number - 1, 1, -9)), lt: new Date(Date.UTC(year, number, 1, -9)) }
}

function eligibleLessons(teacherId: string, studentId: string): Prisma.LessonWhereInput {
  return {
    teacherId,
    status: 'ENDED',
    OR: [
      { accessMode: 'INVITE_ONLY', members: { some: { userId: studentId } } },
      { accessMode: 'OPEN', attendance: { some: { userId: studentId } } },
    ],
  }
}

function participation(intervals: { joinedAt: Date; leftAt: Date | null }[], endedAt: Date | null) {
  if (intervals.length === 0) return { firstJoinedAt: null, lastLeftAt: null, durationSeconds: 0 }
  let total = 0
  let rangeStart = intervals[0].joinedAt.getTime()
  let rangeEnd = rangeStart
  let lastLeft: number | null = null
  for (const { joinedAt, leftAt } of intervals) {
    const start = joinedAt.getTime()
    const finish = (leftAt ?? endedAt)?.getTime()
    if (finish === undefined || finish < start) continue
    lastLeft = Math.max(lastLeft ?? finish, finish)
    if (start > rangeEnd) {
      total += rangeEnd - rangeStart
      rangeStart = start
    }
    rangeEnd = Math.max(rangeEnd, finish)
  }
  return {
    firstJoinedAt: intervals[0].joinedAt.toISOString(),
    lastLeftAt: lastLeft === null ? null : new Date(lastLeft).toISOString(),
    durationSeconds: Math.floor((total + rangeEnd - rangeStart) / 1000),
  }
}

@Injectable()
export class StudentAttendance {
  constructor(private readonly db: Database) {}

  private async student(db: Prisma.TransactionClient, teacher: PublicUser, id: unknown): Promise<Student> {
    if (teacher.role !== 'teacher') throw new ApiError('FORBIDDEN', '선생님만 이용할 수 있습니다.', 403)
    const studentId = uuid.parse(id)
    const link = await db.teacherStudent.findFirst({
      where: { teacherId: teacher.id, studentId, student: { role: 'student' } },
      select: { student: { select: { id: true, name: true } } },
    })
    if (!link) throw new ApiError('FORBIDDEN', '담당 학생의 출결만 관리할 수 있어요.', 403)
    return link.student
  }

  private async month(db: Prisma.TransactionClient, teacherId: string, student: Student, month: string): Promise<StudentAttendanceMonth> {
    const lessons = await db.lesson.findMany({
      where: { ...eligibleLessons(teacherId, student.id), startsAt: monthBounds(month) },
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true, title: true, startsAt: true, endedAt: true,
        attendance: {
          where: { userId: student.id }, orderBy: { joinedAt: 'asc' },
          select: { joinedAt: true, leftAt: true },
        },
        attendanceOverrides: {
          where: { studentId: student.id }, select: { status: true, reason: true, memo: true },
        },
      },
    })
    const counts = { PRESENT: 0, LATE: 0, ABSENT: 0 }
    const rows = lessons.map((lesson): StudentAttendanceRow => {
      const override = lesson.attendanceOverrides[0]
      const status = override?.status ?? (lesson.attendance.length ? 'PRESENT' : 'ABSENT')
      counts[status] += 1
      return {
        lessonId: lesson.id, lessonTitle: lesson.title, startsAt: lesson.startsAt.toISOString(),
        ...participation(lesson.attendance, lesson.endedAt),
        status, reason: override?.reason ?? null, memo: override?.memo ?? null,
      }
    })
    return {
      student, month, rows,
      summary: {
        present: counts.PRESENT, late: counts.LATE, absent: counts.ABSENT,
        rate: rows.length ? Math.round(100 * counts.PRESENT / rows.length) : null,
      },
    }
  }

  async list(teacher: PublicUser, id: unknown, month: unknown): Promise<StudentAttendanceMonth> {
    const student = await this.student(this.db, teacher, id)
    return this.month(this.db, teacher.id, student, monthInput.parse(month))
  }

  async save(teacher: PublicUser, id: unknown, lessonId: unknown, body: unknown): Promise<StudentAttendanceMonth> {
    return this.db.$transaction(async db => {
      const student = await this.student(db, teacher, id)
      const lesson = await db.lesson.findFirst({
        where: { ...eligibleLessons(teacher.id, student.id), id: uuid.parse(lessonId) },
        select: { id: true, startsAt: true },
      })
      if (!lesson) throw new ApiError('NOT_FOUND', '수정할 출결 기록을 찾을 수 없어요.', 404)
      const input = adjustmentInput.parse(body)
      const key = { lessonId: lesson.id, studentId: student.id }
      const data = { status: input.status, reason: input.reason ?? null, memo: input.memo || null }
      await db.studentAttendanceOverride.upsert({
        where: { lessonId_studentId: key }, create: { ...key, ...data }, update: data,
      })
      const parts = seoul.formatToParts(lesson.startsAt)
      const month = `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`
      return this.month(db, teacher.id, student, month)
    })
  }
}
