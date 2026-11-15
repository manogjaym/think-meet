import { WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets'
import { OnModuleInit } from '@nestjs/common'
import { Server, Socket } from 'socket.io'
import { z, ZodError } from 'zod'
import { Auth } from './auth'
import { Lessons } from './lessons'
import { ApiError } from './errors'
import { FeaturePolicy } from './features'
import { SOCKET_EVENTS } from './generated/contracts'
import type { CommandEnvelope, SubscribeInput, StrokePreview } from './generated/contracts'
const commandSchema = z.object({ lessonId: z.string().uuid(), type: z.string().min(1).max(100), payload: z.any().default({}), requestId: z.string().max(100).optional() })
export function socketError(error: any) {
  if (error instanceof ApiError) return error.getResponse()
  if (error instanceof ZodError) return { code: 'VALIDATION', message: error.issues[0]?.message || '입력값이 올바르지 않습니다.' }
  console.error('socket command failed', error?.message)
  return { code: 'INTERNAL', message: '요청을 처리하지 못했습니다.' }
}
@WebSocketGateway({ cors: false, maxHttpBufferSize: 1024 * 1024, transports: ['websocket', 'polling'] })
export class Gateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() server!: Server
  private rates = new Map<string, { count: number; at: number }>()
  constructor(readonly auth: Auth, readonly lessons: Lessons, readonly features: FeaturePolicy = new FeaturePolicy()) {}
  onModuleInit() {
    this.lessons.publishSnapshot = (id, snapshot) => this.emitAuthorized(id, SOCKET_EVENTS.Snapshot, snapshot, new Set(snapshot.participants.map((member: any) => member.user.id)))
    this.lessons.notifyUsers = ids => { for (const id of ids) this.server?.to(`user:${id}`).emit(SOCKET_EVENTS.LessonsChanged) }
    this.lessons.notifyAllUsers = () => { this.server?.emit(SOCKET_EVENTS.LessonsChanged) }
    this.lessons.disconnectUser = (id, userId, code) => {
      if (!this.server) return
      for (const socket of this.server.sockets.sockets.values()) {
        if (socket.data.user?.id !== userId || !socket.rooms.has(`lesson:${id}`)) continue
        // Replacement media disconnect is communicated by LiveKit's duplicate-identity event.
        // Do not evict the newly connecting socket together with the old socket.
        if (code === 'REPLACED') continue
        socket.emit(SOCKET_EVENTS.RoomError, { code, message: '선생님에 의해 수업에서 퇴장되었습니다.' })
        socket.leave(`lesson:${id}`)
      }
    }
  }
  async emitAuthorized(id: string, event: string, payload: any, allowed?: Set<string>, exceptSocketId?: string) {
    if (!this.server) return
    const sockets = [...this.server.sockets.sockets.values()].filter(socket => socket.id !== exceptSocketId && socket.rooms.has(`lesson:${id}`))
    await Promise.all(sockets.map(async socket => {
      try {
        const user = await this.auth.userFromCookie(socket.handshake.headers.cookie)
        if (allowed ? !allowed.has(user.id) : !(await this.lessons.access(id, user, true))) throw new ApiError('ACCOUNT', '이 수업의 초대 대상이 아닙니다.', 403)
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
  handleDisconnect(socket: Socket) { this.rates.delete(socket.id) }
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
      const snapshot = await this.lessons.snapshot(lessonId, user)
      for (const room of socket.rooms) if (room.startsWith('lesson:')) socket.leave(room)
      socket.join(`lesson:${lessonId}`)
      return { ok: true, snapshot }
    } catch (error) { return { ok: false, error: socketError(error) } }
  }
  @SubscribeMessage(SOCKET_EVENTS.Command)
  async command(@ConnectedSocket() socket: Socket, @MessageBody() input: any) {
    try {
      this.rate(socket)
      const command: CommandEnvelope = commandSchema.parse(input)
      const user = await this.auth.userFromCookie(socket.handshake.headers.cookie)
      this.features.assertEvent(SOCKET_EVENTS.Command, command, socket.handshake.headers, socket.handshake.auth)
      const snapshot = await this.lessons.command(user, { ...command, payload: command.payload || {} })
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
      const share: any = lesson.share
      if (!share || share.id !== body.shareId || share.page !== body.page) return
      await this.emitAuthorized(body.lessonId, SOCKET_EVENTS.StrokePreview, { ...body, authorId: user.id }, undefined, socket.id)
    } catch (error) {
      if (error instanceof ApiError && ['FEATURE_UNAVAILABLE', 'CLIENT_UPDATE_REQUIRED'].includes((error.getResponse() as { code: string }).code)) socket.emit(SOCKET_EVENTS.RoomError, socketError(error))
    }
  }
}
