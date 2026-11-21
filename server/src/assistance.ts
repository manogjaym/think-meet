import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from './errors'
import type { AssistanceGeometry, AssistanceSession } from './generated/contracts'

export const assistanceGeometrySchema = z.object({
  width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  version: z.number().int().min(1).max(2147483647),
})
export type AssistanceBinding = AssistanceSession & { lessonId: string; teacherSocketId: string; studentSocketId: string; trackSid?: string }
export type AssistanceCommandContext = { socketId: string; studentSocketId?: string }

/** Consent exists only for these two live sockets; it is never restored from storage. */
export class AssistanceSessions {
  private sessions = new Map<string, AssistanceBinding>()
  constructor(private readonly now: () => number = Date.now) {}

  current(lessonId: string): AssistanceBinding | undefined {
    const session = this.sessions.get(lessonId)
    return session && !this.expired(session) ? session : undefined
  }
  publicState(lessonId: string): AssistanceSession | null {
    const session = this.current(lessonId)
    if (!session) return null
    const { lessonId: _, teacherSocketId: __, studentSocketId: ___, trackSid: ____, ...state } = session
    return { ...state, ...(state.geometry ? { geometry: { ...state.geometry } } : {}) }
  }
  private expired(session: AssistanceBinding) { return session.expiresAt !== null && Date.parse(session.expiresAt) <= this.now() }
  require(lessonId: string, sessionId: string) {
    const session = this.current(lessonId)
    if (!session || session.id !== sessionId) throw new ApiError('STALE_ASSISTANCE', '화면 보기 요청이 종료되었어요. 새로 요청해 주세요.', 409)
    return session
  }
  request(lessonId: string, teacherId: string, studentId: string, teacherSocketId: string, studentSocketId: string) {
    const current = this.current(lessonId)
    if (current) {
      if (current.teacherId === teacherId && current.studentId === studentId && current.teacherSocketId === teacherSocketId && current.studentSocketId === studentSocketId) return current
      throw new ApiError('ASSISTANCE_BUSY', '진행 중인 화면 보기 요청을 먼저 종료해 주세요.', 409)
    }
    const session: AssistanceBinding = { lessonId, id: randomUUID(), teacherId, studentId, teacherSocketId, studentSocketId,
      status: 'pending', expiresAt: new Date(this.now() + 60000).toISOString() }
    this.sessions.set(lessonId, session)
    return session
  }
  respond(session: AssistanceBinding, approved: boolean) {
    if (session.status !== 'pending') {
      if (approved && session.status === 'approved') return
      throw new ApiError('CONFLICT', '이미 처리된 화면 보기 요청입니다.', 409)
    }
    if (!approved) { this.remove(session.lessonId); return }
    session.status = 'approved'; session.expiresAt = new Date(this.now() + 120000).toISOString()
  }
  activate(session: AssistanceBinding, shareId: string, geometry: AssistanceGeometry, trackSid: string) {
    session.status = 'active'; session.expiresAt = null; session.shareId = shareId; session.geometry = { ...geometry }
    session.trackSid = trackSid
  }
  geometry(session: AssistanceBinding, geometry: AssistanceGeometry) {
    if (session.status !== 'active' || !session.geometry) throw new ApiError('CONFLICT', '화면 공유를 시작한 후 위치 정보를 갱신해 주세요.', 409)
    if (geometry.version <= session.geometry.version) {
      if (JSON.stringify(geometry) === JSON.stringify(session.geometry)) return
      throw new ApiError('STALE_GEOMETRY', '화면 방향이 변경되었어요. 최신 화면으로 다시 시도해 주세요.', 409)
    }
    session.geometry = { ...geometry }
  }
  remove(lessonId: string) { const session = this.sessions.get(lessonId); this.sessions.delete(lessonId); return session }
  removeForUser(lessonId: string, userId: string) {
    const session = this.sessions.get(lessonId)
    return session && [session.teacherId, session.studentId].includes(userId) ? this.remove(lessonId) : undefined
  }
  removeForSocket(socketId: string) {
    const removed: AssistanceBinding[] = []
    for (const session of this.sessions.values()) if ([session.teacherSocketId, session.studentSocketId].includes(socketId)) {
      this.sessions.delete(session.lessonId); removed.push(session)
    }
    return removed
  }
  sweep(connected: (session: AssistanceBinding) => boolean) {
    const removed: AssistanceBinding[] = []
    for (const session of this.sessions.values()) if (this.expired(session) || !connected(session)) {
      this.sessions.delete(session.lessonId); removed.push(session)
    }
    return removed
  }
}
