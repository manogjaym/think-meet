import { Prisma } from '@prisma/client'
import { TrackSource } from 'livekit-server-sdk'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { assistanceGeometrySchema } from '../assistance'
import { ApiError } from '../errors'
import type { Share } from '../types'
import type { CommandContext } from './commands'
import { admissionMetadata } from './livekit'

/** Remote assistance (student screen view) commands. Consent lives only in this process's memory. */
export async function assistanceCommand(ctx: CommandContext) {
  const { lessons, db, lesson, user, share, command, payload, assistanceContext: context } = ctx
  const id = lesson.id, type = command.type
  if (!context) throw new ApiError('FORBIDDEN', '수업에 연결한 기기에서 요청해 주세요.', 403)
  if (type === 'assistance.request') {
    if (lesson.teacherId !== user.id) throw new ApiError('FORBIDDEN', '수업 선생님만 화면 보기를 요청할 수 있어요.', 403)
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(payload)
    const student = lesson.members.find((member: any) => member.userId === studentId && !member.banned && member.online && member.admissionId)
    if (studentId === user.id || !student || !context.studentSocketId) throw new ApiError('ASSISTANCE_UNAVAILABLE', '앱으로 연결된 학생에게 화면 보기를 요청해 주세요.', 409)
    const current = lessons.assistance.current(id)
    if (share && (!current || share.id !== current.shareId)) throw new ApiError('SHARE_BUSY', '현재 공유를 종료한 후 화면 보기를 요청해 주세요.', 409)
    const session = lessons.assistance.request(id, user.id, studentId, context.socketId, context.studentSocketId, context.studentAnnotation === true)
    if (!lessons.assistanceConnected(session)) { lessons.assistance.remove(id); throw new ApiError('ASSISTANCE_UNAVAILABLE', '학생 연결이 변경되었어요. 다시 요청해 주세요.', 409) }
    return
  }
  const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(payload)
  if (type === 'assistance.stop' && !lessons.assistance.current(id)) return
  const current = lessons.assistance.require(id, sessionId)
  const teacher = user.id === current.teacherId && context.socketId === current.teacherSocketId
  const student = user.id === current.studentId && context.socketId === current.studentSocketId
  if (!teacher && !student) throw new ApiError('FORBIDDEN', '이 화면 보기 요청을 처리할 권한이 없어요.', 403)
  if (type === 'assistance.stop') {
    lessons.assistance.remove(id)
    await lessons.clearAssistanceShare(current)
    return
  }
  if (!lessons.assistanceConnected(current)) { lessons.assistance.remove(id); await lessons.clearAssistanceShare(current); throw new ApiError('STALE_ASSISTANCE', '연결이 변경되어 화면 보기 요청이 종료되었어요.', 409) }
  if (!student) throw new ApiError('FORBIDDEN', '요청받은 학생만 화면 공유를 승인할 수 있어요.', 403)
  if (type === 'assistance.respond') {
    const body = z.object({ approved: z.boolean() }).parse(payload)
    lessons.assistance.respond(current, body.approved)
  } else if (type === 'assistance.start') {
    const { geometry } = z.object({ geometry: assistanceGeometrySchema }).parse(payload)
    if (current.status === 'active' && share?.id === current.shareId) return
    if (current.status !== 'approved') throw new ApiError('CONSENT_REQUIRED', '학생이 화면 보기 요청을 승인한 후 공유해 주세요.', 409)
    if (share) throw new ApiError('SHARE_BUSY', '다른 화면이 공유되고 있어요. 새로 요청해 주세요.', 409)
    const participant = await lessons.livekit.getParticipant(lesson.roomName, user.id).catch(() => null)
    const member = lesson.members.find((entry: any) => entry.userId === user.id)
    const track = participant?.tracks.find(track => track.source === TrackSource.SCREEN_SHARE && !track.muted)
    if (!track || admissionMetadata(participant?.metadata).admissionId !== member?.admissionId) throw new ApiError('SCREEN_NOT_PUBLISHED', '기기의 화면 공유를 시작한 후 다시 시도해 주세요.', 409)
    if (lessons.assistance.current(id) !== current || !lessons.assistanceConnected(current)) throw new ApiError('STALE_ASSISTANCE', '화면 보기 요청이 종료되었어요. 새로 요청해 주세요.', 409)
    const next: Share = { id: randomUUID(), type: 'screen', ownerId: user.id, page: 1, playing: false, position: 0, updatedAt: new Date().toISOString(), assistanceId: current.id }
    // Claim only an empty share slot, and roll back only this share if consent changed meanwhile.
    const claimed = await db.lesson.updateMany({ where: { id, share: { equals: Prisma.DbNull } }, data: { share: next as any } })
    if (!claimed.count) throw new ApiError('SHARE_BUSY', '다른 화면이 공유되고 있어요. 새로 요청해 주세요.', 409)
    if (lessons.assistance.current(id) !== current || !lessons.assistanceConnected(current)) {
      await db.lesson.updateMany({ where: { id, share: { path: ['id'], equals: next.id } }, data: { share: Prisma.DbNull } })
      throw new ApiError('STALE_ASSISTANCE', '연결이 변경되어 화면 공유를 중지했어요.', 409)
    }
    lessons.assistance.activate(current, next.id, geometry, track.sid)
  } else if (type === 'assistance.geometry') {
    const { geometry } = z.object({ geometry: assistanceGeometrySchema }).parse(payload)
    const previous = current.geometry
    lessons.assistance.geometry(current, geometry)
    // Strokes belong to one screen layout. A new size or rotation moves the share to a fresh page,
    // so earlier strokes stop showing on both the teacher's view and the student's overlay.
    if (share && share.id === current.shareId && share.assistanceId === current.id && previous &&
        (previous.width !== geometry.width || previous.height !== geometry.height || previous.rotation !== geometry.rotation)) {
      const next: Share = { ...share, page: share.page + 1, updatedAt: new Date().toISOString() }
      await db.lesson.updateMany({ where: { id, share: { path: ['id'], equals: share.id } }, data: { share: next as any } })
    }
  } else throw new ApiError('UNKNOWN_COMMAND', '지원하지 않는 화면 보기 조작입니다.')
}
