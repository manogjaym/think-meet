import { WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets'
import { OnModuleInit } from '@nestjs/common'
import { Server, Socket } from 'socket.io'
import { z } from 'zod'
import { Auth } from './auth'
import { Lessons } from './lessons'
import { ApiError, toErrorBody, type ErrorCode } from './errors'
import { assertLessonAccess } from './lesson/access'
import { readShare } from './lesson/share'
import type { LessonRealtimeSink } from './realtime-port'
import { FeaturePolicy } from './features'
import { socketFeatureClient } from './feature-policy'
import type { AssistanceBinding, AssistanceCommandContext } from './assistance'
import { SOCKET_EVENTS } from './generated/contracts'
import type { CommandEnvelope, SubscribeInput, StrokePreview, AssistancePointer } from './generated/contracts'
const commandSchema = z.object({ lessonId: z.string().uuid(), type: z.string().min(1).max(100), payload: z.any().default({}), requestId: z.string().max(100).optional(), expectedShareId: z.string().uuid().optional() })
/** Socket acks use the same code/message mapping as HTTP responses. */
export function socketError(error: unknown) { return toErrorBody(error).body }
@WebSocketGateway({ cors: false, maxHttpBufferSize: 1024 * 1024, transports: ['websocket', 'polling'] })
export class Gateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, LessonRealtimeSink {
  @WebSocketServer() server!: Server
  private rates = new Map<string, { count: number; at: number }>()
  private subscriptions = new Map<string, string>()
  private pointerOrders = new WeakMap<AssistanceBinding, { received: number; delivered: number }>()
  constructor(readonly auth: Auth, readonly lessons: Lessons, readonly features: FeaturePolicy = new FeaturePolicy()) {}
  /** Gateway is the lesson realtime transport (see realtime-port.ts). */
  onModuleInit() { this.lessons.realtime.attach(this) }
  publishSnapshot(id: string, snapshot: { participants: Array<{ user: { id: string } }> }) {
    return this.emitAuthorized(id, SOCKET_EVENTS.Snapshot, snapshot, new Set(snapshot.participants.map(member => member.user.id)))
  }
  notifyUsers(ids: string[]) { for (const id of ids) this.server?.to(`user:${id}`).emit(SOCKET_EVENTS.LessonsChanged) }
  notifyAllUsers() { this.server?.emit(SOCKET_EVENTS.LessonsChanged) }
  disconnectUser(id: string, userId: string, code: ErrorCode | 'REPLACED') {
    if (!this.server) return
    // Replacement media disconnect is communicated by LiveKit's duplicate-identity event.
    // Do not evict the newly connecting socket together with the old socket.
    if (code === 'REPLACED') return
    for (const socket of this.server.sockets.sockets.values()) {
      if (socket.data.user?.id !== userId || !socket.rooms.has(`lesson:${id}`)) continue
      socket.emit(SOCKET_EVENTS.RoomError, { code, message: '선생님에 의해 수업에서 퇴장되었습니다.' })
      socket.leave(`lesson:${id}`)
    }
  }
  /**
   * Every delivery re-checks each socket's session, so a revoked session or kicked member stops
   * receiving immediately. Within one delivery the session lookup is shared per cookie and, when no
   * participant set is given, the lesson is read once and checked in memory.
   */
  async emitAuthorized(id: string, event: string, payload: any, allowed?: Set<string>, exceptSocketId?: string) {
    if (!this.server) return
    const sockets = [...this.server.sockets.sockets.values()].filter(socket => socket.id !== exceptSocketId && socket.rooms.has(`lesson:${id}`))
    if (!sockets.length) return
    const sessions = new Map<string, ReturnType<Auth['userFromCookie']>>()
    const userFor = (cookie = '') => { let user = sessions.get(cookie); if (!user) sessions.set(cookie, user = this.auth.userFromCookie(cookie)); return user }
    let lesson: ReturnType<Lessons['get']> | undefined
    await Promise.all(sockets.map(async socket => {
      try {
        const user = await userFor(socket.handshake.headers.cookie)
        if (allowed) { if (!allowed.has(user.id)) throw new ApiError('ACCOUNT', '이 수업의 초대 대상이 아닙니다.', 403) }
        else assertLessonAccess(await (lesson ??= this.lessons.get(id)), user, true)
        socket.emit(event, payload)
      } catch (error) {
        socket.emit(SOCKET_EVENTS.RoomError, socketError(error))
        socket.leave(`lesson:${id}`)
        if (error instanceof ApiError && error.getStatus() === 401) socket.disconnect(true)
      }
    }))
  }
  async handleConnection(socket: Socket) {
    try {
      const origin = socket.handshake.headers.origin
      if (origin && !this.allowedOrigin(origin)) throw new ApiError('FORBIDDEN', '허용되지 않은 접속 주소입니다.', 403)
      socket.data.user = await this.auth.userFromCookie(socket.handshake.headers.cookie)
      socket.join(`user:${socket.data.user.id}`)
    } catch (error) { socket.emit(SOCKET_EVENTS.RoomError, socketError(error)); socket.disconnect(true) }
  }
  handleDisconnect(socket: Socket) {
    this.rates.delete(socket.id)
    for (const [key, socketId] of this.subscriptions) if (socketId === socket.id) this.subscriptions.delete(key)
    void this.lessons.disconnectAssistance?.(socket.id).catch(error => console.error('assistance disconnect cleanup failed', error?.message))
  }
  private async assistanceUser(socket: Socket) {
    try { return await this.auth.userFromCookie(socket.handshake.headers.cookie) }
    catch (error) {
      if (error instanceof ApiError && error.getStatus() === 401) this.handleDisconnect(socket)
      throw error
    }
  }
  assistanceConnected(session: AssistanceBinding) {
    const room = `lesson:${session.lessonId}`
    return [[session.teacherId, session.teacherSocketId], [session.studentId, session.studentSocketId]].every(([userId, socketId]) => {
      const socket = this.server?.sockets.sockets.get(socketId)
      return socket?.rooms.has(room) && socket.data.user?.id === userId && this.subscriptions.get(`${session.lessonId}:${userId}`) === socketId
    })
  }
  private assertLessonSocket(socket: Socket, lessonId: string, userId: string) {
    if (!socket.rooms.has(`lesson:${lessonId}`) || this.subscriptions.get(`${lessonId}:${userId}`) !== socket.id) throw new ApiError('FORBIDDEN', '현재 수업에 연결된 기기에서 요청해 주세요.', 403)
  }
  private assertAndroidRecipient(socket: Socket) {
    const client = socketFeatureClient(socket.handshake.headers, socket.handshake.auth)
    if (client.platform !== 'android') throw new ApiError('ASSISTANCE_UNAVAILABLE', '학생의 Android 앱에서 화면 보기를 사용할 수 있어요.', 409)
    this.features.assertEvent(SOCKET_EVENTS.AssistancePointer, {}, socket.handshake.headers, socket.handshake.auth)
  }
  allowedOrigin(origin: string) { return [process.env.PUBLIC_ORIGIN, 'https://localhost', 'https://127.0.0.1', ...(process.env.DEV_ORIGINS || 'http://localhost:8443,http://127.0.0.1:8443').split(',')].includes(origin) }
  rate(socket: Socket, maximum = 60) {
    let hit = this.rates.get(socket.id)
    if (!hit || Date.now() - hit.at > 1000) { hit = { count: 0, at: Date.now() }; this.rates.set(socket.id, hit) }
    if (++hit.count > maximum) throw new ApiError('RATE_LIMIT', '조작이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', 429)
  }
  @SubscribeMessage(SOCKET_EVENTS.Subscribe)
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() input: any) {
    try {
      const { lessonId }: SubscribeInput = z.object({ lessonId: z.string().uuid() }).parse(input)
      const user = await this.auth.userFromCookie(socket.handshake.headers.cookie)
      this.features.assertEvent(SOCKET_EVENTS.Subscribe, input, socket.handshake.headers, socket.handshake.auth)
      socket.data.user = user
      let snapshot = await this.lessons.snapshot(lessonId, user)
      const key = `${lessonId}:${user.id}`
      const previous = this.subscriptions.get(key)
      const moving = [...socket.rooms].some(room => room.startsWith('lesson:') && room !== `lesson:${lessonId}`)
      if (previous && previous !== socket.id) await this.lessons.disconnectAssistance(previous)
      if (moving) await this.lessons.disconnectAssistance(socket.id)
      for (const [oldKey, socketId] of this.subscriptions) if (socketId === socket.id && oldKey !== key) this.subscriptions.delete(oldKey)
      for (const room of socket.rooms) if (room.startsWith('lesson:')) socket.leave(room)
      socket.join(`lesson:${lessonId}`)
      this.subscriptions.set(key, socket.id)
      if (previous && previous !== socket.id || moving) snapshot = await this.lessons.snapshot(lessonId, user)
      return { ok: true, snapshot }
    } catch (error) { return { ok: false, error: socketError(error) } }
  }
  @SubscribeMessage(SOCKET_EVENTS.Command)
  async command(@ConnectedSocket() socket: Socket, @MessageBody() input: any) {
    try {
      this.rate(socket)
      const command: CommandEnvelope = commandSchema.parse(input)
      const user = command.type.startsWith('assistance.') ? await this.assistanceUser(socket) : await this.auth.userFromCookie(socket.handshake.headers.cookie)
      this.features.assertEvent(SOCKET_EVENTS.Command, command, socket.handshake.headers, socket.handshake.auth)
      if (command.type === 'lesson.start' || command.type === 'lesson.mode.set' || command.type === 'document.open') this.assertLessonSocket(socket, command.lessonId, user.id)
      let context: AssistanceCommandContext | undefined
      if (command.type.startsWith('assistance.')) {
        this.assertLessonSocket(socket, command.lessonId, user.id)
        context = { socketId: socket.id }
        if (command.type === 'assistance.request') {
          const { studentId } = z.object({ studentId: z.string().uuid() }).parse(command.payload)
          const targetId = this.subscriptions.get(`${command.lessonId}:${studentId}`)
          const target = targetId ? this.server?.sockets.sockets.get(targetId) : undefined
          if (!target?.rooms.has(`lesson:${command.lessonId}`)) throw new ApiError('ASSISTANCE_UNAVAILABLE', '현재 수업에 연결된 Android 학생에게 요청해 주세요.', 409)
          const targetUser = await this.assistanceUser(target)
          if (targetUser.id !== studentId || targetUser.role !== 'student') throw new ApiError('FORBIDDEN', '수업에 참여한 학생에게 요청해 주세요.', 403)
          this.assertAndroidRecipient(target)
          context.studentSocketId = target.id
        }
      }
      const snapshot = await this.lessons.command(user, { ...command, payload: command.payload || {} }, context)
      return { ok: true, snapshot }
    } catch (error) { return { ok: false, error: socketError(error) } }
  }
  @SubscribeMessage(SOCKET_EVENTS.StrokePreview)
  async preview(@ConnectedSocket() socket: Socket, @MessageBody() input: any) {
    try {
      this.rate(socket)
      const body: StrokePreview = z.object({ lessonId: z.string().uuid(), shareId: z.string().uuid(), page: z.number().int().min(1), tool: z.enum(['pen','highlighter']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(1000) }).parse(input)
      const user = await this.auth.userFromCookie(socket.handshake.headers.cookie)
      this.features.assertEvent(SOCKET_EVENTS.StrokePreview, body, socket.handshake.headers, socket.handshake.auth)
      const lesson = await this.lessons.access(body.lessonId, user, true)
      const share = readShare(lesson.share)
      if (!share || share.id !== body.shareId || share.page !== body.page) return
      await this.emitAuthorized(body.lessonId, SOCKET_EVENTS.StrokePreview, { ...body, authorId: user.id }, undefined, socket.id)
    } catch (error) {
      if (error instanceof ApiError && ['FEATURE_UNAVAILABLE', 'CLIENT_UPDATE_REQUIRED'].includes((error.getResponse() as { code: string }).code)) socket.emit(SOCKET_EVENTS.RoomError, socketError(error))
    }
  }
  @SubscribeMessage(SOCKET_EVENTS.AssistancePointer)
  async assistancePointer(@ConnectedSocket() socket: Socket, @MessageBody() input: any) {
    try {
      this.rate(socket)
      const body: AssistancePointer = z.object({ lessonId: z.string().uuid(), sessionId: z.string().uuid(), shareId: z.string().uuid(),
        geometryVersion: z.number().int().min(1).max(2147483647), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).parse(input)
      const candidate = this.lessons.currentAssistance(body.lessonId)
      let order = candidate ? this.pointerOrders.get(candidate) : undefined
      if (candidate && !order) { order = { received: 0, delivered: 0 }; this.pointerOrders.set(candidate, order) }
      const received = order ? ++order.received : 0
      const user = await this.assistanceUser(socket)
      this.features.assertEvent(SOCKET_EVENTS.AssistancePointer, body, socket.handshake.headers, socket.handshake.auth)
      const lesson = await this.lessons.access(body.lessonId, user, true, true)
      const session = this.lessons.requireAssistance(body.lessonId, body.sessionId)
      if (session !== candidate || !order) return
      this.assertLessonSocket(socket, body.lessonId, user.id)
      if (session.teacherId !== user.id || session.teacherSocketId !== socket.id) throw new ApiError('FORBIDDEN', '이 요청의 선생님만 위치를 알려줄 수 있어요.', 403)
      const current = () => this.lessons.currentAssistance(body.lessonId) === session && session.status === 'active'
        && session.shareId === body.shareId && session.geometry?.version === body.geometryVersion && this.assistanceConnected(session)
      const share = readShare(lesson.share)
      if (!current() || share?.id !== body.shareId || share.assistanceId !== session.id || share.ownerId !== session.studentId || share.type !== 'screen') return
      const target = this.server?.sockets.sockets.get(session.studentSocketId)
      if (!target) return
      try {
        const student = await this.auth.userFromCookie(target.handshake.headers.cookie)
        await this.lessons.access(body.lessonId, student, true)
        if (student.id !== session.studentId) throw new ApiError('FORBIDDEN', '학생 연결이 변경되었어요.', 403)
        this.assertAndroidRecipient(target)
      } catch (error) {
        target.emit(SOCKET_EVENTS.RoomError, socketError(error)); target.leave(`lesson:${body.lessonId}`)
        await this.lessons.disconnectAssistance(target.id)
        if (error instanceof ApiError && error.getStatus() === 401) target.disconnect(true)
        throw error
      }
      if (!current() || received <= order.delivered) return
      order.delivered = received
      target.volatile.emit(SOCKET_EVENTS.AssistancePointer, { ...body, authorId: user.id })
    } catch (error) { socket.emit(SOCKET_EVENTS.RoomError, socketError(error)) }
  }
}
