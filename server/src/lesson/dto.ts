import { publicUser, type Database } from '../auth'
import type { LessonInstruction, Material } from '../generated/contracts'
import type { Share } from '../types'

export const subjectSelect = { id: true, name: true } as const

/** Public lesson view: people, schedule, attendance and live participants. */
export async function lessonDto(db: Database, lesson: any) {
  const members = lesson.members || await db.lessonMember.findMany({ where: { lessonId: lesson.id } })
  const users = await db.user.findMany({ where: { id: { in: [lesson.teacherId, ...members.map((m: any) => m.userId)] } } })
  const teacher = users.find(user => user.id === lesson.teacherId)!
  const attendance = await db.attendance.findMany({ where: { lessonId: lesson.id }, orderBy: { joinedAt: 'asc' } })
  const instruction: LessonInstruction | undefined = lesson.instructionPhase
    ? { phase: lesson.instructionPhase, startedAt: lesson.instructionStartedAt?.toISOString() ?? null }
    : undefined
  return {
    id: lesson.id, title: lesson.title, description: lesson.description, accessMode: lesson.accessMode || 'INVITE_ONLY', teacher: publicUser(teacher),
    ...(lesson.subject ? { subject: lesson.subject } : {}),
    ...(instruction && { instruction }),
    students: users.filter(user => user.id !== lesson.teacherId).map(publicUser),
    startsAt: lesson.startsAt.toISOString(), endsAt: lesson.endsAt?.toISOString() || null, status: lesson.status, code: lesson.code,
    startedAt: lesson.startedAt?.toISOString() || null, endedAt: lesson.endedAt?.toISOString() || null,
    attendance: attendance.map(row => ({ userId: row.userId, joinedAt: row.joinedAt.toISOString(), leftAt: row.leftAt?.toISOString() || null })),
    participants: members.filter((m: any) => m.online && !m.banned).map((m: any) => ({ userId: m.userId, joinedAt: attendance.find(row => row.userId === m.userId && !row.leftAt)?.joinedAt.toISOString() || lesson.startedAt?.toISOString() || new Date().toISOString() })),
  }
}
export type LessonDto = Awaited<ReturnType<typeof lessonDto>>

export function materialDto(material: any): Material {
  return { id: material.id, name: material.name, type: material.kind, size: material.size, duration: material.duration ?? undefined, pages: material.pages ?? undefined, createdAt: material.createdAt.toISOString() }
}

/** Teachers and lessons without lesson modes keep free annotation; lesson-mode students need the teacher's permission. */
export function annotationAllowed(lesson: any, userId: string) {
  if (userId === lesson.teacherId || !lesson.instructionPhase) return true
  return Boolean(lesson.members?.find((member: any) => member.userId === userId)?.annotationAllowed)
}

/** Meeting snapshot: lesson view plus chat, participants, the active share and its strokes. */
export async function meetingSnapshot(db: Database, lesson: any, share: Share | null, details: LessonDto, assistance: unknown) {
  const users = await db.user.findMany({ where: { id: { in: lesson.members.map((member: any) => member.userId) } } })
  const messages = await db.message.findMany({ where: { lessonId: lesson.id }, orderBy: { createdAt: 'desc' }, take: 100 })
  const strokes = share ? await db.stroke.findMany({ where: { lessonId: lesson.id, shareId: share.id }, orderBy: { createdAt: 'asc' } }) : []
  return {
    lessonId: lesson.id, lesson: details, seq: lesson.seq, serverTime: new Date().toISOString(),
    ...(details.instruction && { instruction: details.instruction }),
    participants: lesson.members.filter((member: any) => !member.banned).map((member: any) => ({ user: publicUser(users.find(user => user.id === member.userId)!), online: member.online, raised: member.raised, annotationAllowed: annotationAllowed(lesson, member.userId) })),
    messages: messages.reverse().map(({ lessonId, ...message }) => message), share, assistance,
    strokes: strokes.map(({ id, authorId, shareId, page, tool, color, points, deleted }) => ({ id, authorId, shareId, page, tool, color, points, deleted })),
  }
}
export type MeetingSnapshotDto = Awaited<ReturnType<typeof meetingSnapshot>>
