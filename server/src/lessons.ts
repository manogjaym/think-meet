import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'livekit-server-sdk'
import { jwtVerify } from 'jose'
import { randomUUID, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { Database, publicUser } from './auth'
import { ApiError } from './errors'
import type { PublicUser, Share, Command } from './types'
import { AssistanceSessions, assistanceGeometrySchema, type AssistanceBinding, type AssistanceCommandContext } from './assistance'
const ids = z.array(z.string().uuid()).min(1).max(100)
const screenShareRecoveryMs = 30_000
const subjectSelect = { id: true, name: true } as const
const lessonMode = z.enum(['classroom', 'mirroring'])
const lessonModeChange = z.object({
  mode: lessonMode, expectedMode: lessonMode,
  expectedShareId: z.uuid().nullable(), expectedAssistanceId: z.uuid().nullable(),
})
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
@Injectable()
export class Lessons implements OnModuleInit, OnModuleDestroy {
  readonly livekit = new RoomServiceClient(process.env.LIVEKIT_URL || 'http://livekit:7880', process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET)
  readonly receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY || '', process.env.LIVEKIT_API_SECRET || '')
  publishSnapshot: (id: string, snapshot: any) => void | Promise<void> = () => {}
  disconnectUser: (id: string, userId: string, code: string) => void = () => {}
  notifyUsers: (ids: string[]) => void = () => {}
  notifyAllUsers: () => void = () => {}
  readonly assistance = new AssistanceSessions()
  assistanceConnected: (session: AssistanceBinding) => boolean = () => false
  private locks = new Map<string, Promise<any>>()
  private missingScreenShares = new Map<string, { shareId: string; since: number }>()
  private timer?: NodeJS.Timeout
  constructor(readonly db: Database) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.reconcile().catch(error => console.error('reconciliation failed', error.message))
      void this.db.prejoinWait.deleteMany({ where: { expiresAt: { lte: new Date() } } })
        .catch(error => console.error('prejoin wait cleanup failed', error.message))
    }, 10_000)
    this.timer.unref()
  }
  onModuleDestroy() { clearInterval(this.timer) }
  async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) || Promise.resolve()
    const next = previous.catch(() => {}).then(fn)
    this.locks.set(id, next)
    try { return await next } finally { if (this.locks.get(id) === next) this.locks.delete(id) }
  }
  async clearAssistanceShare(session: AssistanceBinding) {
    if (!session.shareId) return
    const lesson = await this.get(session.lessonId)
    const share = lesson.share as Share | null
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
    const share = lesson.share as Share | null
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
    const lesson = await this.get(id)
    if (teacherOnly && lesson.teacherId !== user.id) throw new ApiError('FORBIDDEN', '수업을 관리할 권한이 없습니다.', 403)
    const member = lesson.members.find(member => member.userId === user.id)
    if (!member && lesson.teacherId !== user.id && (lesson.accessMode !== 'OPEN' || requireLive)) throw new ApiError('ACCOUNT', '이 수업에 참여할 권한이 없습니다.', 403)
    if (member?.banned) throw new ApiError('KICKED', '선생님에 의해 수업에서 퇴장되었습니다.', 403)
    if (requireLive && lesson.status !== 'LIVE') throw new ApiError(lesson.status === 'CANCELLED' ? 'CANCELLED' : lesson.status === 'ENDED' ? 'ENDED' : 'WAITING', '현재 참여할 수 없는 수업입니다.', 409)
    return lesson
  }
  async dto(lesson: any) {
    const members = lesson.members || await this.db.lessonMember.findMany({ where: { lessonId: lesson.id } })
    const users = await this.db.user.findMany({ where: { id: { in: [lesson.teacherId, ...members.map((m: any) => m.userId)] } } })
    const teacher = users.find(user => user.id === lesson.teacherId)!
    const attendance = await this.db.attendance.findMany({ where: { lessonId: lesson.id }, orderBy: { joinedAt: 'asc' } })
    return {
      id: lesson.id, title: lesson.title, description: lesson.description, accessMode: lesson.accessMode || 'INVITE_ONLY', teacher: publicUser(teacher),
      ...(lesson.subject ? { subject: lesson.subject } : {}),
      students: users.filter(user => user.id !== lesson.teacherId).map(publicUser),
      startsAt: lesson.startsAt.toISOString(), endsAt: lesson.endsAt?.toISOString() || null, status: lesson.status, code: lesson.code,
      startedAt: lesson.startedAt?.toISOString() || null, endedAt: lesson.endedAt?.toISOString() || null,
      attendance: attendance.map(row => ({ userId: row.userId, joinedAt: row.joinedAt.toISOString(), leftAt: row.leftAt?.toISOString() || null })),
      participants: members.filter((m: any) => m.online && !m.banned).map((m: any) => ({ userId: m.userId, joinedAt: attendance.find(row => row.userId === m.userId && !row.leftAt)?.joinedAt.toISOString() || lesson.startedAt?.toISOString() || new Date().toISOString() })),
    }
  }
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
      await this.db.$transaction([
        this.db.lesson.update({ where: { id }, data: { title: data.title, description: data.description, accessMode: data.accessMode, startsAt: new Date(data.startsAt), endsAt: data.endsAt === null ? null : new Date(data.endsAt), subjectId: data.subjectId } }),
        ...(data.accessMode === 'INVITE_ONLY' ? [this.db.lessonMember.deleteMany({ where: { lessonId: id, userId: { notIn: [user.id, ...data.studentIds] } } })] : []),
        ...data.studentIds.map(userId => this.db.lessonMember.upsert({ where: { lessonId_userId: { lessonId: id, userId } }, create: { lessonId: id, userId }, update: {} })),
      ])
      await this.broadcast(id)
      if (lesson.accessMode === 'OPEN' || data.accessMode === 'OPEN') this.notifyAllUsers()
      return this.dto(await this.get(id))
    })
  }
  async cancel(id: string, user: PublicUser) {
    return this.locked(id, async () => {
      const lesson = await this.access(id, user, false, true)
      if (lesson.status !== 'SCHEDULED') throw new ApiError('CONFLICT', '예정된 수업만 취소할 수 있습니다.', 409)
      this.assistance.remove(id)
      await this.db.lesson.update({ where: { id }, data: { status: 'CANCELLED', endedAt: new Date(), share: Prisma.DbNull } })
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
        await this.db.$transaction([admit, this.db.lesson.update({ where: { id }, data: { instructionPhase: 'preparing' } })])
      } else await admit
      const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: user.id, name: user.name, ttl: '2m', metadata: JSON.stringify({ admissionId, userId: user.id, role: user.id === lesson.teacherId ? 'teacher' : 'student' }) })
      token.addGrant({ roomJoin: true, room: lesson.roomName, canPublish: true, canSubscribe: true, canPublishData: false })
      return { waiting: false, lesson: await this.dto(lesson), admissionId, token: await token.toJwt(), livekitUrl: process.env.LIVEKIT_PUBLIC_URL || `${process.env.PUBLIC_ORIGIN?.replace(/^http/, 'ws')}/livekit` }
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
    let metadata: any = {}
    try { metadata = JSON.parse(participant.metadata || '{}') } catch {}
    if (!member || member.banned || member.admissionId !== metadata.admissionId || ['ENDED','CANCELLED'].includes(lesson.status)) {
      await this.livekit.removeParticipant(lesson.roomName, participant.identity).catch(() => {})
      return
    }
    const previous = await this.db.attendance.findFirst({ where: { lessonId: lesson.id, userId: member.userId, leftAt: null } })
    if (previous && previous.livekitSid !== participant.sid) {
      await this.stopAssistanceForUser(lesson.id, member.userId)
      await this.db.attendance.update({ where: { id: previous.id }, data: { leftAt: new Date() } })
    }
    if (!previous || previous.livekitSid !== participant.sid) await this.db.attendance.upsert({ where: { livekitSid: participant.sid }, create: { lessonId: lesson.id, userId: member.userId, admissionId: member.admissionId!, livekitSid: participant.sid }, update: {} })
    await this.db.lessonMember.update({ where: { lessonId_userId: { lessonId: lesson.id, userId: member.userId } }, data: { online: true, disconnectedAt: null } })
    if (member.userId === lesson.teacherId && lesson.status === 'SCHEDULED') {
      await this.db.lesson.updateMany({ where: { id: lesson.id, status: 'SCHEDULED' }, data: { status: 'LIVE', startedAt: new Date() } })
      if (lesson.accessMode === 'OPEN') this.notifyAllUsers()
    }
  }
  async leave(id: string, user: PublicUser) {
    return this.locked(id, async () => {
      const lesson = await this.access(id, user)
      await this.stopAssistanceForUser(id, user.id)
      if (!lesson.members.some(member => member.userId === user.id)) return { ok: true }
      await this.db.lessonMember.update({ where: { lessonId_userId: { lessonId: id, userId: user.id } }, data: { admissionId: null } })
      await this.livekit.removeParticipant(lesson.roomName, user.id).catch(() => {})
      await this.offline(id, user.id)
      if ((lesson.share as Share | null)?.ownerId === user.id) await this.db.lesson.update({ where: { id }, data: { share: Prisma.DbNull } })
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
    await this.db.$transaction([
      this.db.attendance.updateMany({ where: { lessonId: id, userId, leftAt: null }, data: { leftAt: new Date() } }),
      this.db.lessonMember.updateMany({ where: { lessonId: id, userId, online: true }, data: { online: false, disconnectedAt: new Date(), raised: false } }),
    ])
  }
  async end(id: string, user: PublicUser) {
    return this.locked(id, async () => {
      const lesson = await this.access(id, user, false, true)
      if (lesson.status === 'ENDED') return this.dto(lesson)
      if (lesson.status !== 'LIVE') throw new ApiError('CONFLICT', '진행 중인 수업만 종료할 수 있습니다.', 409)
      this.assistance.remove(id)
      await this.db.$transaction([
        this.db.lesson.update({ where: { id }, data: { status: 'ENDED', endedAt: new Date(), share: Prisma.DbNull } }),
        this.db.lessonMember.updateMany({ where: { lessonId: id }, data: { online: false, raised: false, admissionId: null } }),
        this.db.attendance.updateMany({ where: { lessonId: id, leftAt: null }, data: { leftAt: new Date() } }),
      ])
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
      await this.db.lessonMember.update({ where: { lessonId_userId: { lessonId: id, userId } }, data: { banned: true, admissionId: null, raised: false } })
      this.disconnectUser(id, userId, 'KICKED')
      await this.livekit.removeParticipant(lesson.roomName, userId).catch(() => {})
      await this.offline(id, userId)
      const share = lesson.share as Share | null
      if (share?.ownerId === userId) await this.db.lesson.update({ where: { id }, data: { share: Prisma.DbNull } })
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
  private async snapshotUnlocked(id: string, user?: PublicUser) {
    const lesson = user ? await this.access(id, user) : await this.get(id)
    await this.validateAssistance(lesson)
    const users = await this.db.user.findMany({ where: { id: { in: lesson.members.map(member => member.userId) } } })
    const messages = await this.db.message.findMany({ where: { lessonId: id }, orderBy: { createdAt: 'desc' }, take: 100 })
    const share = lesson.share as Share | null
    const strokes = share ? await this.db.stroke.findMany({ where: { lessonId: id, shareId: share.id }, orderBy: { createdAt: 'asc' } }) : []
    return {
      lessonId: id, lesson: await this.dto(lesson), seq: lesson.seq, serverTime: new Date().toISOString(),
      ...(lesson.instructionPhase && { instruction: { phase: lesson.instructionPhase, startedAt: lesson.instructionStartedAt?.toISOString() ?? null } }),
      participants: lesson.members.filter(member => !member.banned).map(member => ({ user: publicUser(users.find(user => user.id === member.userId)!), online: member.online, raised: member.raised })),
      messages: messages.reverse().map(({ lessonId, ...message }) => message), share, assistance: this.assistance.publicState(id),
      strokes: strokes.map(({ id, authorId, shareId, page, tool, color, points, deleted }) => ({ id, authorId, shareId, page, tool, color, points, deleted })),
    }
  }
  async broadcast(id: string) {
    await this.db.lesson.update({ where: { id }, data: { seq: { increment: 1 } } })
    const snapshot = await this.snapshotUnlocked(id)
    await this.publishSnapshot(id, snapshot)
    this.notifyUsers(snapshot.participants.map(member => member.user.id))
    return snapshot
  }
  materialDto(material: any) { return { id: material.id, name: material.name, type: material.kind, size: material.size, duration: material.duration ?? undefined, pages: material.pages ?? undefined, createdAt: material.createdAt.toISOString() } }
  async command(user: PublicUser, command: Command, context?: AssistanceCommandContext) {
    return this.locked(command.lessonId, async () => {
      const { lessonId: id, type, payload: p = {} } = command
      const lesson = await this.access(id, user, type !== 'assistance.stop')
      const share = lesson.share as Share | null
      const requireShare = () => { if (!share) throw new ApiError('NO_SHARE', '공유 중인 콘텐츠가 없습니다.', 409); return share }
      const teacher = () => { if (lesson.teacherId !== user.id) throw new ApiError('FORBIDDEN', '선생님만 조작할 수 있습니다.', 403) }
      const writeShare = async (next: Share | null) => this.db.lesson.update({ where: { id }, data: { share: next ? next as any : Prisma.DbNull } })
      if (type === 'lesson.start' || type === 'lesson.mode.set') {
        teacher()
        if (!lesson.members.some(member => member.userId === user.id && member.online && member.admissionId)) {
          throw new ApiError('NOT_CONNECTED', '화상미팅에 연결한 후 다시 시도해 주세요.', 409)
        }
        const phase = lesson.instructionPhase
        if (!phase) throw new ApiError('FEATURE_UNAVAILABLE', '이 화상미팅에서는 수업 모드를 사용할 수 없어요.', 409)
        if (type === 'lesson.start') {
          if (phase !== 'preparing') return this.snapshotUnlocked(id)
          await this.db.lesson.update({ where: { id }, data: { instructionPhase: 'classroom', instructionStartedAt: new Date() } })
        } else {
          if (phase === 'preparing') throw new ApiError('LESSON_NOT_STARTED', '먼저 수업을 시작해 주세요.', 409)
          const next = lessonModeChange.parse(p)
          if (phase === next.mode) return this.snapshotUnlocked(id)
          const assistance = this.assistance.current(id)
          if (phase !== next.expectedMode || (share?.id ?? null) !== next.expectedShareId || (assistance?.id ?? null) !== next.expectedAssistanceId) {
            throw new ApiError('LESSON_MODE_CHANGED', '공유 또는 요청 상태가 달라졌어요. 최신 상태를 확인한 뒤 다시 시도해 주세요.', 409)
          }
          await this.db.lesson.update({ where: { id }, data: { instructionPhase: next.mode, share: Prisma.DbNull } })
          this.assistance.remove(id)
        }
      } else if (type.startsWith('assistance.')) {
        if (type !== 'assistance.stop' && lesson.instructionPhase && lesson.instructionPhase !== 'mirroring') {
          throw new ApiError('LESSON_MODE_REQUIRED', '미러링 모드에서 학생 화면 보기를 사용할 수 있어요.', 409)
        }
        return this.assistanceCommand(lesson, user, command, context)
      } else if (type === 'chat.send') {
        const body = z.object({ text: z.string().trim().min(1).max(2000), clientId: z.string().min(1).max(100) }).parse(p)
        await this.db.message.upsert({ where: { lessonId_userId_clientId: { lessonId: id, userId: user.id, clientId: body.clientId } }, create: { lessonId: id, userId: user.id, userName: user.name, ...body }, update: {} })
      } else if (type === 'hand.set') {
        const { raised } = z.object({ raised: z.boolean() }).parse(p)
        await this.db.lessonMember.update({ where: { lessonId_userId: { lessonId: id, userId: user.id } }, data: { raised } })
      } else if (type === 'share.start') {
        if (lesson.instructionPhase) {
          teacher()
          if (lesson.instructionPhase !== 'classroom') throw new ApiError('LESSON_MODE_REQUIRED', '수업방 모드에서 화면 또는 자료를 공유할 수 있어요.', 409)
        }
        const body = z.object({ type: z.enum(['screen','media','document']), materialId: z.string().uuid().optional() }).parse(p)
        if (body.type === 'screen') {
          await writeShare({ id: randomUUID(), type: 'screen', ownerId: user.id, page: 1, playing: false, position: 0, updatedAt: new Date().toISOString() })
        } else {
          teacher()
          await this.locked(`material:${body.materialId}`, async () => {
            const material = body.materialId ? await this.db.material.findUnique({ where: { id: body.materialId } }) : null
            if (!material || material.ownerId !== user.id || material.kind !== body.type) throw new ApiError('INVALID_MATERIAL', '공유할 자료를 찾을 수 없습니다.', 404)
            await writeShare({ id: randomUUID(), type: body.type, ownerId: user.id, materialId: material.id, material: this.materialDto(material), page: 1, playing: false, position: 0, updatedAt: new Date().toISOString() })
          })
        }
        this.assistance.remove(id)
      } else if (type === 'document.open') {
        teacher()
        if (!lesson.members.some(member => member.userId === user.id && member.online && member.admissionId)) {
          throw new ApiError('NOT_CONNECTED', '화상미팅에 연결한 후 다시 시도해 주세요.', 409)
        }
        if (lesson.instructionPhase && lesson.instructionPhase !== 'classroom') {
          throw new ApiError('LESSON_MODE_REQUIRED', '수업방 모드에서 교재를 불러올 수 있어요.', 409)
        }
        const { materialId, page } = z.object({ materialId: z.string().uuid(), page: z.number().int().min(1) }).parse(p)
        await this.locked(`material:${materialId}`, async () => {
          const material = await this.db.material.findUnique({ where: { id: materialId } })
          if (!material || material.ownerId !== user.id || material.kind !== 'document') {
            throw new ApiError('INVALID_MATERIAL', '공유할 교재를 찾을 수 없습니다.', 404)
          }
          if (page > (material.pages || 1)) throw new ApiError('VALIDATION', '문서 페이지를 확인해 주세요.')
          const updatedAt = new Date().toISOString()
          if (share?.type === 'document' && share.materialId === materialId) {
            if (share.page !== page) await writeShare({ ...share, page, updatedAt })
          } else {
            await writeShare({ id: randomUUID(), type: 'document', ownerId: user.id, materialId, material: this.materialDto(material), page, playing: false, position: 0, updatedAt })
            this.assistance.remove(id)
          }
        })
      } else if (type === 'share.stop') {
        // An old capture can end after a different share has already taken its place.
        if (command.expectedShareId && share?.id !== command.expectedShareId) return this.snapshotUnlocked(id)
        if (lesson.instructionPhase && !share) return this.snapshotUnlocked(id)
        if (share && share.ownerId !== user.id && user.id !== lesson.teacherId) throw new ApiError('FORBIDDEN', '자신의 화면 공유만 중지할 수 있습니다.', 403)
        await writeShare(null)
        this.assistance.remove(id)
      } else if (type === 'media.update') {
        teacher(); const active = requireShare()
        if (active.type !== 'media') throw new ApiError('CONFLICT', '영상 공유 상태가 아닙니다.', 409)
        const body = z.object({ playing: z.boolean(), position: z.number().finite().min(0) }).parse(p)
        if (active.material?.duration && body.position > active.material.duration + 1) throw new ApiError('VALIDATION', '재생 위치를 확인해 주세요.')
        await writeShare({ ...active, ...body, updatedAt: new Date().toISOString() })
      } else if (type === 'document.page') {
        teacher(); const active = requireShare()
        const { page } = z.object({ page: z.number().int().min(1) }).parse(p)
        if (active.type !== 'document' || page > (active.material?.pages || 1)) throw new ApiError('VALIDATION', '문서 페이지를 확인해 주세요.')
        await writeShare({ ...active, page, updatedAt: new Date().toISOString() })
      } else if (type === 'stroke.add') {
        const active = requireShare()
        const body = z.object({ id: z.string().uuid(), shareId: z.string().uuid(), page: z.number().int().min(1), tool: z.enum(['pen','highlighter']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(20000) }).parse(p)
        if (body.shareId !== active.id || body.page !== active.page) throw new ApiError('STALE_SHARE', '공유 화면이 변경되었습니다.', 409)
        const existing = await this.db.stroke.findUnique({ where: { id: body.id } })
        if (existing && (existing.authorId !== user.id || existing.lessonId !== id)) throw new ApiError('CONFLICT', '중복된 판서 번호입니다.', 409)
        if (!existing) {
          await this.db.$transaction([
            this.db.stroke.create({ data: { ...body, lessonId: id, authorId: user.id } }),
            this.db.annotationOperation.deleteMany({ where: { lessonId: id, actorId: user.id, shareId: active.id, page: active.page, undone: true } }),
            this.db.annotationOperation.create({ data: { lessonId: id, actorId: user.id, shareId: active.id, page: active.page, patches: [{ id: body.id, before: true, after: false }] } }),
          ])
        }
      } else if (type === 'stroke.erase') {
        const active = requireShare()
        const { ids: strokeIds } = z.object({ ids: z.array(z.string().uuid()).max(500) }).parse(p)
        const where = { id: { in: strokeIds }, lessonId: id, shareId: active.id, page: active.page, ...(user.id === lesson.teacherId ? {} : { authorId: user.id }) }
        const targets = await this.db.stroke.findMany({ where: { ...where, deleted: false } })
        if (targets.length) await this.db.$transaction([
          this.db.stroke.updateMany({ where, data: { deleted: true } }),
          this.db.annotationOperation.deleteMany({ where: { lessonId: id, actorId: user.id, shareId: active.id, page: active.page, undone: true } }),
          this.db.annotationOperation.create({ data: { lessonId: id, actorId: user.id, shareId: active.id, page: active.page, patches: targets.map(stroke => ({ id: stroke.id, before: false, after: true })) } }),
        ])
      } else if (type === 'annotation.undo' || type === 'annotation.redo') {
        const active = requireShare()
        const redo = type === 'annotation.redo'
        const operation = await this.db.annotationOperation.findFirst({
          where: { lessonId: id, actorId: user.id, shareId: active.id, page: active.page, undone: redo },
          orderBy: redo ? { touchedAt: 'desc' } : { createdAt: 'desc' },
        })
        if (operation) await this.db.$transaction([
          ...(operation.patches as { id: string; before: boolean; after: boolean }[]).map(patch => this.db.stroke.updateMany({ where: { id: patch.id, lessonId: id, shareId: active.id, page: active.page }, data: { deleted: redo ? patch.after : patch.before } })),
          this.db.annotationOperation.update({ where: { id: operation.id }, data: { undone: !redo } }),
        ])
      } else if (type === 'annotation.clear') {
        const active = requireShare()
        const where = { lessonId: id, shareId: active.id, page: active.page, ...(user.id === lesson.teacherId ? {} : { authorId: user.id }) }
        const targets = await this.db.stroke.findMany({ where, select: { id: true } })
        const targetIds = new Set(targets.map(stroke => stroke.id))
        const operations = await this.db.annotationOperation.findMany({ where: { lessonId: id, shareId: active.id, page: active.page } })
        await this.db.$transaction([
          this.db.stroke.updateMany({ where, data: { deleted: true } }),
          ...operations.flatMap(operation => {
            const previous = operation.patches as { id: string; before: boolean; after: boolean }[]
            const patches = previous.filter(patch => !targetIds.has(patch.id))
            if (patches.length === previous.length) return []
            return [patches.length ? this.db.annotationOperation.update({ where: { id: operation.id }, data: { patches } }) : this.db.annotationOperation.delete({ where: { id: operation.id } })]
          }),
        ])
      } else throw new ApiError('UNKNOWN_COMMAND', '지원하지 않는 수업 조작입니다.')
      return this.broadcast(id)
    })
  }
  private async assistanceCommand(lesson: any, user: PublicUser, command: Command, context?: AssistanceCommandContext) {
    const { lessonId: id, type, payload: p } = command
    if (!context) throw new ApiError('FORBIDDEN', '수업에 연결한 기기에서 요청해 주세요.', 403)
    if (type === 'assistance.request') {
      if (lesson.teacherId !== user.id) throw new ApiError('FORBIDDEN', '수업 선생님만 화면 보기를 요청할 수 있어요.', 403)
      const { studentId } = z.object({ studentId: z.string().uuid() }).parse(p)
      const student = lesson.members.find((member: any) => member.userId === studentId && !member.banned && member.online && member.admissionId)
      if (studentId === user.id || !student || !context.studentSocketId) throw new ApiError('ASSISTANCE_UNAVAILABLE', '연결된 Android 학생에게 화면 보기를 요청해 주세요.', 409)
      const current = this.assistance.current(id)
      if (lesson.share && (!current || (lesson.share as Share).id !== current.shareId)) throw new ApiError('SHARE_BUSY', '현재 공유를 종료한 후 화면 보기를 요청해 주세요.', 409)
      const session = this.assistance.request(id, user.id, studentId, context.socketId, context.studentSocketId)
      if (!this.assistanceConnected(session)) { this.assistance.remove(id); throw new ApiError('ASSISTANCE_UNAVAILABLE', '학생 연결이 변경되었어요. 다시 요청해 주세요.', 409) }
    } else {
      const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(p)
      const session = this.assistance.current(id)
      if (type === 'assistance.stop' && !session) return this.broadcast(id)
      const current = this.assistance.require(id, sessionId)
      const teacher = user.id === current.teacherId && context.socketId === current.teacherSocketId
      const student = user.id === current.studentId && context.socketId === current.studentSocketId
      if (!teacher && !student) throw new ApiError('FORBIDDEN', '이 화면 보기 요청을 처리할 권한이 없어요.', 403)
      if (type === 'assistance.stop') {
        this.assistance.remove(id)
        await this.clearAssistanceShare(current)
      } else {
        if (!this.assistanceConnected(current)) { this.assistance.remove(id); await this.clearAssistanceShare(current); throw new ApiError('STALE_ASSISTANCE', '연결이 변경되어 화면 보기 요청이 종료되었어요.', 409) }
        if (!student) throw new ApiError('FORBIDDEN', '요청받은 학생만 화면 공유를 승인할 수 있어요.', 403)
        if (type === 'assistance.respond') {
          const body = z.object({ approved: z.boolean() }).parse(p)
          this.assistance.respond(current, body.approved)
        } else if (type === 'assistance.start') {
          const { geometry } = z.object({ geometry: assistanceGeometrySchema }).parse(p)
          if (current.status === 'active' && (lesson.share as Share | null)?.id === current.shareId) return this.broadcast(id)
          if (current.status !== 'approved') throw new ApiError('CONSENT_REQUIRED', '학생이 화면 보기 요청을 승인한 후 공유해 주세요.', 409)
          if (lesson.share) throw new ApiError('SHARE_BUSY', '다른 화면이 공유되고 있어요. 새로 요청해 주세요.', 409)
          const participant = await this.livekit.getParticipant(lesson.roomName, user.id).catch(() => null)
          let metadata: any = {}
          try { metadata = JSON.parse(participant?.metadata || '{}') } catch {}
          const member = lesson.members.find((entry: any) => entry.userId === user.id)
          const track = participant?.tracks.find(track => track.source === TrackSource.SCREEN_SHARE && !track.muted)
          if (!track || metadata.admissionId !== member?.admissionId) throw new ApiError('SCREEN_NOT_PUBLISHED', '기기의 화면 공유를 시작한 후 다시 시도해 주세요.', 409)
          if (this.assistance.current(id) !== current || !this.assistanceConnected(current)) throw new ApiError('STALE_ASSISTANCE', '화면 보기 요청이 종료되었어요. 새로 요청해 주세요.', 409)
          const share: Share = { id: randomUUID(), type: 'screen', ownerId: user.id, page: 1, playing: false, position: 0, updatedAt: new Date().toISOString(), assistanceId: current.id }
          await this.db.lesson.update({ where: { id }, data: { share: share as any } })
          if (this.assistance.current(id) !== current || !this.assistanceConnected(current)) {
            await this.db.lesson.update({ where: { id }, data: { share: Prisma.DbNull } })
            throw new ApiError('STALE_ASSISTANCE', '연결이 변경되어 화면 공유를 중지했어요.', 409)
          }
          this.assistance.activate(current, share.id, geometry, track.sid)
        } else if (type === 'assistance.geometry') {
          const { geometry } = z.object({ geometry: assistanceGeometrySchema }).parse(p)
          this.assistance.geometry(current, geometry)
        } else throw new ApiError('UNKNOWN_COMMAND', '지원하지 않는 화면 보기 조작입니다.')
      }
    }
    return this.broadcast(id)
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
    let claims: any
    try { claims = (await jwtVerify(token, new TextEncoder().encode(process.env.LIVEKIT_API_SECRET), { algorithms: ['HS256'], issuer: process.env.LIVEKIT_API_KEY })).payload } catch { throw new ApiError('UNAUTHENTICATED', '입장 토큰이 유효하지 않습니다.', 401) }
    const lesson = await this.db.lesson.findUnique({ where: { roomName: claims.video?.room }, include: { members: true } })
    const member = lesson?.members.find(member => member.userId === claims.sub)
    let metadata: any = {}
    try { metadata = JSON.parse(claims.metadata || '{}') } catch {}
    if (!lesson || !member || member.banned || member.admissionId !== metadata.admissionId || !['LIVE','SCHEDULED'].includes(lesson.status) || (lesson.status === 'SCHEDULED' && lesson.teacherId !== member.userId)) throw new ApiError('FORBIDDEN', '수업에 참여할 권한이 없습니다.', 403)
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
        const current = await this.get(lesson.id)
        const share = current.share as Share | null
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
  async reconcile() {
    for (const session of this.assistance.sweep(this.assistanceConnected)) await this.locked(session.lessonId, async () => {
      await this.clearAssistanceShare(session)
      await this.broadcast(session.lessonId)
    })
    const lessons = await this.db.lesson.findMany({ where: { status: { in: ['LIVE','SCHEDULED'] }, OR: [{ members: { some: { admissionId: { not: null } } } }, { share: { not: Prisma.DbNull } }] }, include: { members: true } })
    const activeLessonIds = new Set(lessons.map(lesson => lesson.id))
    for (const id of this.missingScreenShares.keys()) if (!activeLessonIds.has(id)) this.missingScreenShares.delete(id)
    for (const candidate of lessons) await this.locked(candidate.id, async () => {
      const lesson = await this.get(candidate.id)
      let participants: Awaited<ReturnType<RoomServiceClient['listParticipants']>>
      try { participants = await this.livekit.listParticipants(lesson.roomName) } catch (error: any) { if (error.status !== 404 && error.code !== 'not_found') return; participants = [] }
      let changed = false
      for (const participant of participants) {
        const member = lesson.members.find(member => member.userId === participant.identity)
        if (!member?.online || member.banned) { await this.applyParticipant(lesson, participant); changed = true }
      }
      for (const member of lesson.members) if (member.online && !participants.some(participant => participant.identity === member.userId)) { await this.offline(lesson.id, member.userId); changed = true }
      const share = lesson.share as Share | null
      const screenMissing = share?.type === 'screen' && !share.assistanceId && !participants.some(participant =>
        participant.identity === share.ownerId && participant.tracks.some(track => track.source === TrackSource.SCREEN_SHARE))
      let screenExpired = false
      if (screenMissing) {
        const missing = this.missingScreenShares.get(lesson.id)
        const now = Date.now()
        if (missing?.shareId === share.id) screenExpired = now - missing.since >= screenShareRecoveryMs
        else this.missingScreenShares.set(lesson.id, { shareId: share.id, since: now })
      } else this.missingScreenShares.delete(lesson.id)

      if (share) {
        const owner = await this.db.lessonMember.findUnique({ where: { lessonId_userId: { lessonId: lesson.id, userId: share.ownerId } } })
        const ownerExpired = !owner?.online && owner?.disconnectedAt && Date.now() - owner.disconnectedAt.getTime() > screenShareRecoveryMs
        if (screenExpired || ownerExpired || share.assistanceId && this.assistance.current(lesson.id)?.id !== share.assistanceId) {
          await this.db.lesson.update({ where: { id: lesson.id }, data: { share: Prisma.DbNull } })
          this.missingScreenShares.delete(lesson.id)
          changed = true
        }
      }
      if (changed) await this.broadcast(lesson.id)
    })
    await this.db.loginSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    await this.db.webhookEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86400000) } } })
  }
}
