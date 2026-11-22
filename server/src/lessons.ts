import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TrackSource } from 'livekit-server-sdk'
import { randomUUID, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { Database, publicUser } from './auth'
import { ApiError } from './errors'
import type { PublicUser, Command } from './types'
import { AssistanceSessions, type AssistanceBinding, type AssistanceCommandContext } from './assistance'
import { LessonRealtime } from './realtime-port'
import { assertLessonAccess } from './lesson/access'
import { commandContext, commandHandler } from './lesson/commands'
import { lessonDto, materialDto, meetingSnapshot, subjectSelect } from './lesson/dto'
import { admissionMetadata, LiveKitAdapter } from './lesson/livekit'
import { LessonReconciler } from './lesson/reconciler'
import { readShare } from './lesson/share'
const ids = z.array(z.string().uuid()).min(1).max(100)
export const lessonInput = z.object({
  title: z.string().trim().min(1, '학습 제목을 입력해 주세요.').max(200),
  subjectId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(5000).default(''),
  startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }).nullable(),
  accessMode: z.enum(['INVITE_ONLY', 'OPEN']).default('INVITE_ONLY'), studentIds: z.array(z.string().uuid()).max(100).default([]),
}).superRefine((data, ctx) => {
  if (data.accessMode === 'INVITE_ONLY' && !data.studentIds.length) ctx.addIssue({ code: 'custom', path: ['studentIds'], message: '참여할 학생을 한 명 이상 선택해 주세요.' })
  if (data.endsAt !== null && Date.parse(data.endsAt) <= Date.parse(data.startsAt)) ctx.addIssue({ code: 'custom', message: '종료 시간은 시작 시간보다 늦어야 합니다.' })
  if (Date.parse(data.startsAt) < Date.now() - 60000) ctx.addIssue({ code: 'custom', message: '현재 시간 이후로 예약해 주세요.' })
})

/**
 * Lesson lifecycle facade used by controllers, the gateway and other services.
 * Commands, annotations, remote assistance, reconciliation, DTOs and LiveKit live in ./lesson/.
 * Every state change for one lesson runs inside `locked(lessonId)` (single API instance).
 */
@Injectable()
export class Lessons implements OnModuleInit, OnModuleDestroy {
  /** Remote-assistance consent; intentionally memory-only, so a restart never restores consent. */
  readonly assistance = new AssistanceSessions()
  private readonly reconciler = new LessonReconciler(this)
  private locks = new Map<string, Promise<any>>()
  private timer?: NodeJS.Timeout
  constructor(readonly db: Database, readonly livekit: LiveKitAdapter = new LiveKitAdapter(), readonly realtime: LessonRealtime = new LessonRealtime()) {}
  get receiver() { return this.livekit.receiver }
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.reconcile().catch(error => console.error('reconciliation failed', error.message))
      void this.db.prejoinWait.deleteMany({ where: { expiresAt: { lte: new Date() } } })
        .catch(error => console.error('prejoin wait cleanup failed', error.message))
    }, 10_000)
    this.timer.unref()
  }
  onModuleDestroy() { clearInterval(this.timer) }
  publishSnapshot(id: string, snapshot: Parameters<LessonRealtime['publishSnapshot']>[1]) { return this.realtime.publishSnapshot(id, snapshot) }
  notifyUsers(userIds: string[]) { this.realtime.notifyUsers(userIds) }
  notifyAllUsers() { this.realtime.notifyAllUsers() }
  disconnectUser(id: string, userId: string, code: 'KICKED') { this.realtime.disconnectUser(id, userId, code) }
  assistanceConnected(session: AssistanceBinding) { return this.realtime.assistanceConnected(session) }
  currentAssistance(lessonId: string) { return this.assistance.current(lessonId) }
  requireAssistance(lessonId: string, sessionId: string) { return this.assistance.require(lessonId, sessionId) }
  async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) || Promise.resolve()
    const next = previous.catch(() => {}).then(fn)
    this.locks.set(id, next)
    try { return await next } finally { if (this.locks.get(id) === next) this.locks.delete(id) }
  }
  async clearAssistanceShare(session: AssistanceBinding) {
    if (!session.shareId) return
    const lesson = await this.get(session.lessonId)
    const share = readShare(lesson.share)
    if (share?.id === session.shareId && share.assistanceId === session.id) await this.db.lesson.update({ where: { id: lesson.id }, data: { share: Prisma.DbNull } })
  }
  disconnectAssistance(socketId: string) {
    // Revoke synchronously, before waiting for any in-flight lesson command.
    const removed = this.assistance.removeForSocket(socketId)
    return Promise.all(removed.map(session => this.locked(session.lessonId, async () => {
      await this.clearAssistanceShare(session)
      await this.broadcast(session.lessonId)
    })))
  }
  private async stopAssistanceForUser(id: string, userId: string) {
    const removed = this.assistance.removeForUser(id, userId)
    if (removed) await this.clearAssistanceShare(removed)
    return !!removed
  }
  private async validateAssistance(lesson: any) {
    const session = this.assistance.current(lesson.id)
    const share = readShare(lesson.share)
    const matches = session && lesson.status === 'LIVE' && session.teacherId === lesson.teacherId && this.assistanceConnected(session)
      && [session.teacherId, session.studentId].every(userId => lesson.members.some((member: any) => member.userId === userId && member.online && !member.banned))
      && (session.status === 'active' ? !!share && share.id === session.shareId && share.assistanceId === session.id && share.ownerId === session.studentId && share.type === 'screen' : !share)
    if (!matches) this.assistance.remove(lesson.id)
    if (share?.assistanceId && (!matches || session?.status !== 'active')) {
      // A restarted process has no consent, even if an old capture is still publishing.
      await this.db.lesson.update({ where: { id: lesson.id }, data: { share: Prisma.DbNull } })
      lesson.share = null
    }
  }
  teacher(user: PublicUser) { if (user.role !== 'teacher') throw new ApiError('FORBIDDEN', '선생님만 이용할 수 있습니다.', 403) }
  async roster(user: PublicUser) {
    this.teacher(user)
    const rows = await this.db.teacherStudent.findMany({ where: { teacherId: user.id }, include: { student: true }, orderBy: { student: { name: 'asc' } } })
    return rows.map(row => publicUser(row.student))
  }
  async subjects(user: PublicUser) {
    this.teacher(user)
    return this.db.teacherSubject.findMany({ where: { teacherId: user.id }, select: subjectSelect, orderBy: { name: 'asc' } })
  }
  private async validateSubject(teacherId: string, subjectId: string | null | undefined) {
    if (!subjectId) return
    const subject = await this.db.teacherSubject.findFirst({ where: { id: subjectId, teacherId }, select: { id: true } })
    if (!subject) throw new ApiError('FORBIDDEN', '내 과목 목록에서 선택해 주세요.', 403)
  }
  async validateRoster(teacherId: string, studentIds: string[]) {
    if (new Set(studentIds).size !== studentIds.length) throw new ApiError('VALIDATION', '중복된 학생이 있습니다.')
    const count = await this.db.teacherStudent.count({ where: { teacherId, studentId: { in: studentIds } } })
    if (count !== studentIds.length) throw new ApiError('FORBIDDEN', '담당 학생만 초대할 수 있습니다.', 403)
  }
  async get(id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('INVALID', '수업을 찾을 수 없습니다.', 404)
    const lesson = await this.db.lesson.findUnique({ where: { id }, include: { members: true, subject: { select: subjectSelect } } })
    if (!lesson) throw new ApiError('INVALID', '수업을 찾을 수 없습니다.', 404)
    return lesson
  }
  async access(id: string, user: PublicUser, requireLive = false, teacherOnly = false) {
    return assertLessonAccess(await this.get(id), user, requireLive, teacherOnly)
  }
  dto(lesson: any) { return lessonDto(this.db, lesson) }
  async list(user: PublicUser) {
    const lessons = await this.db.lesson.findMany({ where: { OR: [{ teacherId: user.id }, { members: { some: { userId: user.id } } }, { accessMode: 'OPEN', status: { in: ['SCHEDULED', 'LIVE'] } }] }, include: { members: true, subject: { select: subjectSelect } }, orderBy: { startsAt: 'asc' } })
    return Promise.all(lessons.map(lesson => this.dto(lesson)))
  }
  async create(user: PublicUser, input: unknown) {
    this.teacher(user)
    const data = lessonInput.parse(input)
    await this.validateSubject(user.id, data.subjectId)
    if (data.studentIds.length) await this.validateRoster(user.id, data.studentIds)
    const lesson = await this.db.lesson.create({ include: { subject: { select: subjectSelect } }, data: {
      teacherId: user.id, title: data.title, description: data.description, accessMode: data.accessMode, startsAt: new Date(data.startsAt), endsAt: data.endsAt === null ? null : new Date(data.endsAt),
      subjectId: data.subjectId,
      code: randomBytes(6).toString('hex'), roomName: `lesson-${randomUUID()}`,
      members: { create: [user.id, ...data.studentIds].map(userId => ({ userId })) },
    } })
    this.notifyUsers([user.id, ...data.studentIds])
    if (data.accessMode === 'OPEN') this.notifyAllUsers()
    return this.dto(lesson)
  }
  async edit(id: string, user: PublicUser, input: unknown) {
    return this.locked(id, async () => {
      const lesson = await this.access(id, user, false, true)
      if (lesson.status !== 'SCHEDULED') throw new ApiError('CONFLICT', '예정된 수업만 수정할 수 있습니다.', 409)
      const data = lessonInput.parse(input)
      await this.validateSubject(user.id, data.subjectId)
      if (data.studentIds.length) await this.validateRoster(user.id, data.studentIds)
      await this.db.$transaction(async tx => {
        // The status condition keeps a concurrent start/cancel from being overwritten.
        const updated = await tx.lesson.updateMany({ where: { id, status: 'SCHEDULED' }, data: { title: data.title, description: data.description, accessMode: data.accessMode, startsAt: new Date(data.startsAt), endsAt: data.endsAt === null ? null : new Date(data.endsAt), subjectId: data.subjectId } })
        if (!updated.count) throw new ApiError('CONFLICT', '예정된 수업만 수정할 수 있습니다.', 409)
        if (data.accessMode === 'INVITE_ONLY') await tx.lessonMember.deleteMany({ where: { lessonId: id, userId: { notIn: [user.id, ...data.studentIds] } } })
        for (const userId of data.studentIds) await tx.lessonMember.upsert({ where: { lessonId_userId: { lessonId: id, userId } }, create: { lessonId: id, userId }, update: {} })
      })
      await this.broadcast(id)
      if (lesson.accessMode === 'OPEN' || data.accessMode === 'OPEN') this.notifyAllUsers()
      return this.dto(await this.get(id))
    })
  }
  async cancel(id: string, user: PublicUser) {
    return this.locked(id, async () => {
      const lesson = await this.access(id, user, false, true)
      if (lesson.status !== 'SCHEDULED') throw new ApiError('CONFLICT', '예정된 수업만 취소할 수 있습니다.', 409)
      const cancelled = await this.db.lesson.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'CANCELLED', endedAt: new Date(), share: Prisma.DbNull } })
      if (!cancelled.count) throw new ApiError('CONFLICT', '예정된 수업만 취소할 수 있습니다.', 409)
      this.assistance.remove(id)
      await this.livekit.deleteRoom(lesson.roomName).catch(() => {})
      await this.broadcast(id)
      if (lesson.accessMode === 'OPEN') this.notifyAllUsers()
      return this.dto(await this.get(id))
    })
  }
  async resolve(code: string, user: PublicUser) {
    const match = await this.db.lesson.findUnique({ where: { code }, select: { id: true } })
    if (!match) throw new ApiError('INVALID', '링크 또는 참여 코드가 올바르지 않습니다.', 404)
    const lesson = await this.access(match.id, user)
    if (lesson.status === 'CANCELLED' || lesson.status === 'ENDED') throw new ApiError(lesson.status, lesson.status === 'ENDED' ? '이미 종료된 수업입니다.' : '취소된 수업입니다.', 409)
    return this.dto(lesson)
  }
  async prejoin(id: string, user: PublicUser) {
    const lesson = await this.access(id, user)
    if (lesson.teacherId !== user.id) return { status: lesson.status }
    const members = lesson.status === 'SCHEDULED' ? await this.db.lessonMember.findMany({
      where: { lessonId: id, banned: false, prejoinWaits: { some: { expiresAt: { gt: new Date() } } } },
      select: { userId: true },
    }) : []
    const waitingStudents = members.length ? await this.db.user.findMany({
      where: { role: 'student', id: { in: members.map(member => member.userId) } },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }) : []
    return { status: lesson.status, waitingStudents }
  }
  async renewPrejoinWait(id: string, clientId: string, user: PublicUser) {
    if (!z.uuid().safeParse(clientId).success) throw new ApiError('VALIDATION', '대기 정보를 확인해 주세요.')
    await this.locked(id, async () => {
      const lesson = await this.access(id, user)
      if (user.role !== 'student' || lesson.teacherId === user.id || !lesson.members.some(member => member.userId === user.id))
        throw new ApiError('FORBIDDEN', '이 수업에서 대기할 권한이 없습니다.', 403)
      if (lesson.status !== 'SCHEDULED') throw new ApiError(lesson.status, '대기 상태가 종료되었어요.', 409)
      const key = { lessonId: id, userId: user.id, clientId }
      const expiresAt = new Date(Date.now() + 20_000)
      await this.db.prejoinWait.upsert({ where: { lessonId_userId_clientId: key }, create: { ...key, expiresAt }, update: { expiresAt } })
    })
  }
  async clearPrejoinWait(id: string, clientId: string, user: PublicUser) {
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(clientId).success)
      throw new ApiError('VALIDATION', '대기 정보를 확인해 주세요.')
    await this.locked(id, async () => {
      await this.db.prejoinWait.deleteMany({ where: { lessonId: id, userId: user.id, clientId } })
    })
  }
  async join(id: string, user: PublicUser, supportsLessonModes = false) {
    return this.locked(id, async () => {
      let lesson = await this.access(id, user)
      if (lesson.status === 'ENDED' || lesson.status === 'CANCELLED') throw new ApiError(lesson.status, '이미 종료되거나 취소된 수업입니다.', 409)
      if (await this.stopAssistanceForUser(id, user.id)) await this.broadcast(id)
      if (!lesson.members.some(member => member.userId === user.id)) {
        await this.db.lessonMember.upsert({ where: { lessonId_userId: { lessonId: id, userId: user.id } }, create: { lessonId: id, userId: user.id }, update: {} })
        lesson = await this.get(id)
        await this.broadcast(id)
      }
      if (user.id !== lesson.teacherId && lesson.status !== 'LIVE') return { waiting: true, lesson: await this.dto(lesson) }
      // Room creation is server-only; LiveKit room.auto_create is disabled.
      const rooms = await this.livekit.listRooms([lesson.roomName])
      if (!rooms.length) await this.livekit.createRoom({ name: lesson.roomName, emptyTimeout: 600, departureTimeout: 60, maxParticipants: 101 })
      const admissionId = randomUUID()
      const admit = this.db.lessonMember.update({ where: { lessonId_userId: { lessonId: id, userId: user.id } }, data: { admissionId } })
      if (supportsLessonModes && user.id === lesson.teacherId && lesson.status === 'SCHEDULED' && lesson.instructionPhase == null) {
        await this.db.$transaction([admit, this.db.lesson.updateMany({ where: { id, status: 'SCHEDULED', instructionPhase: null }, data: { instructionPhase: 'preparing' } })])
      } else await admit
      const token = await this.livekit.admissionToken(lesson.roomName, user, admissionId, user.id === lesson.teacherId ? 'teacher' : 'student')
      return { waiting: false, lesson: await this.dto(lesson), admissionId, token, livekitUrl: this.livekit.publicUrl() }
    })
  }
  async connected(id: string, user: PublicUser) {
    return this.locked(id, async () => {
      const lesson = await this.access(id, user)
      if (lesson.status === 'ENDED' || lesson.status === 'CANCELLED') throw new ApiError(lesson.status, '참여할 수 없는 수업입니다.', 409)
      const participant = await this.livekit.getParticipant(lesson.roomName, user.id).catch(() => null)
      if (!participant) throw new ApiError('NOT_CONNECTED', '영상 서버에 연결한 후 다시 시도해 주세요.', 409)
      await this.applyParticipant(lesson, participant)
      await this.broadcast(id)
      return this.dto(await this.get(id))
    })
  }
  async applyParticipant(lesson: any, participant: any) {
    const member = await this.db.lessonMember.findUnique({ where: { lessonId_userId: { lessonId: lesson.id, userId: participant.identity } } })
    if (!member || member.banned || member.admissionId !== admissionMetadata(participant.metadata).admissionId || ['ENDED','CANCELLED'].includes(lesson.status)) {
      await this.livekit.removeParticipant(lesson.roomName, participant.identity).catch(() => {})
      return
    }
    const previous = await this.db.attendance.findFirst({ where: { lessonId: lesson.id, userId: member.userId, leftAt: null } })
    const replaced = !!previous && previous.livekitSid !== participant.sid
    if (replaced) await this.stopAssistanceForUser(lesson.id, member.userId)
    const starts = member.userId === lesson.teacherId && lesson.status === 'SCHEDULED'
    const now = new Date()
    // Attendance, presence and the teacher's SCHEDULED -> LIVE start commit together.
    const results = await this.db.$transaction([
      ...(replaced ? [this.db.attendance.update({ where: { id: previous.id }, data: { leftAt: now } })] : []),
      ...(!previous || replaced ? [this.db.attendance.upsert({ where: { livekitSid: participant.sid }, create: { lessonId: lesson.id, userId: member.userId, admissionId: member.admissionId!, livekitSid: participant.sid }, update: {} })] : []),
      this.db.lessonMember.update({ where: { lessonId_userId: { lessonId: lesson.id, userId: member.userId } }, data: { online: true, disconnectedAt: null } }),
      ...(starts ? [this.db.lesson.updateMany({ where: { id: lesson.id, status: 'SCHEDULED' }, data: { status: 'LIVE', startedAt: now } })] : []),
    ])
    if (starts && (results.at(-1) as Prisma.BatchPayload).count && lesson.accessMode === 'OPEN') this.notifyAllUsers()
  }
  async leave(id: string, user: PublicUser) {
    return this.locked(id, async () => {
      const lesson = await this.access(id, user)
      await this.stopAssistanceForUser(id, user.id)
      if (!lesson.members.some(member => member.userId === user.id)) return { ok: true }
      // Admission, attendance, presence and an owned share change together; LiveKit is called after commit.
      await this.db.$transaction([
        this.db.lessonMember.update({ where: { lessonId_userId: { lessonId: id, userId: user.id } }, data: { admissionId: null } }),
        ...this.offlineWrites(id, user.id),
        this.clearShareOwnedBy(id, user.id),
      ])
      await this.livekit.removeParticipant(lesson.roomName, user.id).catch(() => {})
      await this.broadcast(id)
      return { ok: true }
    })
  }
  async offline(id: string, userId: string, sid?: string) {
    // A delayed disconnect from an old tab must not mark its replacement offline.
    if (sid) {
      const latest = await this.db.attendance.findFirst({ where: { lessonId: id, userId, leftAt: null } })
      if (latest?.livekitSid !== sid) return
    }
    await this.stopAssistanceForUser(id, userId)
    await this.db.$transaction(this.offlineWrites(id, userId))
  }
  private offlineWrites(id: string, userId: string, at = new Date()) {
    return [
      this.db.attendance.updateMany({ where: { lessonId: id, userId, leftAt: null }, data: { leftAt: at } }),
      this.db.lessonMember.updateMany({ where: { lessonId: id, userId, online: true }, data: { online: false, disconnectedAt: at, raised: false } }),
    ]
  }
  /** Clears the share only if this user still owns it, so a newer share is never removed. */
  private clearShareOwnedBy(id: string, userId: string) {
    return this.db.lesson.updateMany({ where: { id, share: { path: ['ownerId'], equals: userId } }, data: { share: Prisma.DbNull } })
  }
  async end(id: string, user: PublicUser) {
    return this.locked(id, async () => {
      const lesson = await this.access(id, user, false, true)
      if (lesson.status === 'ENDED') return this.dto(lesson)
      if (lesson.status !== 'LIVE') throw new ApiError('CONFLICT', '진행 중인 수업만 종료할 수 있습니다.', 409)
      const now = new Date()
      const ended = await this.db.$transaction(async tx => {
        // Members and attendance close only when this request performs the LIVE -> ENDED transition.
        const { count } = await tx.lesson.updateMany({ where: { id, status: 'LIVE' }, data: { status: 'ENDED', endedAt: now, share: Prisma.DbNull } })
        if (!count) return false
        await tx.lessonMember.updateMany({ where: { lessonId: id }, data: { online: false, raised: false, admissionId: null } })
        await tx.attendance.updateMany({ where: { lessonId: id, leftAt: null }, data: { leftAt: now } })
        return true
      })
      if (!ended) {
        const current = await this.get(id)
        if (current.status === 'ENDED') return this.dto(current)
        throw new ApiError('CONFLICT', '진행 중인 수업만 종료할 수 있습니다.', 409)
      }
      this.assistance.remove(id)
      await this.broadcast(id)
      await this.livekit.deleteRoom(lesson.roomName).catch(() => {})
      if (lesson.accessMode === 'OPEN') this.notifyAllUsers()
      return this.dto(await this.get(id))
    })
  }
  async kick(id: string, user: PublicUser, input: any) {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(input)
    return this.locked(id, async () => {
      const lesson = await this.access(id, user, true, true)
      if (userId === lesson.teacherId || !lesson.members.some(member => member.userId === userId)) throw new ApiError('VALIDATION', '퇴장시킬 학생을 선택해 주세요.')
      await this.stopAssistanceForUser(id, userId)
      await this.db.$transaction([
        this.db.lessonMember.update({ where: { lessonId_userId: { lessonId: id, userId } }, data: { banned: true, admissionId: null, raised: false } }),
        ...this.offlineWrites(id, userId),
        this.clearShareOwnedBy(id, userId),
      ])
      this.disconnectUser(id, userId, 'KICKED')
      await this.livekit.removeParticipant(lesson.roomName, userId).catch(() => {})
      await this.broadcast(id)
      return { ok: true }
    })
  }
  async invite(id: string, user: PublicUser, input: any) {
    const { studentIds } = z.object({ studentIds: ids }).parse(input)
    return this.locked(id, async () => {
      const lesson = await this.access(id, user, false, true)
      if (!['SCHEDULED','LIVE'].includes(lesson.status)) throw new ApiError('CONFLICT', '종료된 수업에는 초대할 수 없습니다.', 409)
      await this.validateRoster(user.id, studentIds)
      await this.db.$transaction(studentIds.map(userId => this.db.lessonMember.upsert({ where: { lessonId_userId: { lessonId: id, userId } }, create: { lessonId: id, userId }, update: {} })))
      await this.broadcast(id)
      return this.dto(await this.get(id))
    })
  }
  async snapshot(id: string, user?: PublicUser) { return this.locked(id, () => this.snapshotUnlocked(id, user)) }
  /** Caller must hold the lesson lock. */
  async snapshotUnlocked(id: string, user?: PublicUser) {
    const lesson = user ? await this.access(id, user) : await this.get(id)
    await this.validateAssistance(lesson)
    return meetingSnapshot(this.db, lesson, readShare(lesson.share), await this.dto(lesson), this.assistance.publicState(id))
  }
  async broadcast(id: string) {
    await this.db.lesson.update({ where: { id }, data: { seq: { increment: 1 } } })
    const snapshot = await this.snapshotUnlocked(id)
    await this.publishSnapshot(id, snapshot)
    this.notifyUsers(snapshot.participants.map((member: any) => member.user.id))
    return snapshot
  }
  materialDto(material: any) { return materialDto(material) }
  /** Runs one contract command under the lesson lock; see ./lesson/commands.ts for the handlers. */
  async command(user: PublicUser, command: Command, context?: AssistanceCommandContext) {
    return this.locked(command.lessonId, async () => {
      const handler = commandHandler(command.type)
      const lesson = await this.access(command.lessonId, user, command.type !== 'assistance.stop')
      const result = await handler(commandContext(this, user, lesson, readShare(lesson.share), command, context))
      return result ?? this.broadcast(command.lessonId)
    })
  }
  async authorizeLivekit(uri: string, proxySecret: string, authorization?: string) {
    if (!process.env.PROXY_AUTH_SECRET || proxySecret !== process.env.PROXY_AUTH_SECRET) throw new ApiError('FORBIDDEN', '접근할 수 없습니다.', 403)
    const url = new URL(uri, 'http://internal')
    const queryToken = url.searchParams.get('access_token')
    const bearerToken = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
    // Native SDKs use a header; browser clients may still use a query token.
    // Conflicting credentials must never select a different admission implicitly.
    if (queryToken && bearerToken && queryToken !== bearerToken) throw new ApiError('UNAUTHENTICATED', '입장 토큰이 일치하지 않습니다.', 401)
    const token = bearerToken || queryToken
    if (!token) throw new ApiError('UNAUTHENTICATED', '입장 토큰이 필요합니다.', 401)
    const claims = await this.livekit.verifyToken(token)
    if (!claims) throw new ApiError('UNAUTHENTICATED', '입장 토큰이 유효하지 않습니다.', 401)
    const lesson = await this.db.lesson.findUnique({ where: { roomName: claims.video?.room }, include: { members: true } })
    const member = lesson?.members.find(member => member.userId === claims.sub)
    if (!lesson || !member || member.banned || member.admissionId !== admissionMetadata(claims.metadata).admissionId || !['LIVE','SCHEDULED'].includes(lesson.status) || (lesson.status === 'SCHEDULED' && lesson.teacherId !== member.userId)) throw new ApiError('FORBIDDEN', '수업에 참여할 권한이 없습니다.', 403)
    return { ok: true }
  }
  async webhook(body: string, authorization: string) {
    const event = await this.receiver.receive(body, authorization).catch(() => { throw new ApiError('INVALID_SIGNATURE', '유효하지 않은 webhook입니다.', 401) })
    if (event.id && await this.db.webhookEvent.findUnique({ where: { id: event.id } })) return { ok: true }
    const lesson = event.room?.name ? await this.db.lesson.findUnique({ where: { roomName: event.room.name }, include: { members: true } }) : null
    if (lesson) await this.locked(lesson.id, async () => {
      if (event.event === 'participant_joined' && event.participant) await this.applyParticipant(await this.get(lesson.id), event.participant)
      if (event.event === 'participant_left' && event.participant) await this.offline(lesson.id, event.participant.identity, event.participant.sid)
      if (event.event === 'track_unpublished' && event.participant && event.track?.source === TrackSource.SCREEN_SHARE) {
        const share = readShare((await this.get(lesson.id)).share)
        // Regular shares can republish on reconnect. Approved assistance keeps its immediate cleanup.
        const assistance = this.assistance.current(lesson.id)
        if (share?.type === 'screen' && share.assistanceId && share.ownerId === event.participant.identity &&
            assistance?.id === share.assistanceId && assistance.trackSid === event.track.sid) {
          await this.db.lesson.update({ where: { id: lesson.id }, data: { share: Prisma.DbNull } })
        }
      }
      await this.broadcast(lesson.id)
    })
    if (event.id) await this.db.webhookEvent.upsert({ where: { id: event.id }, create: { id: event.id }, update: {} })
    return { ok: true }
  }
  reconcile() { return this.reconciler.run() }
}
