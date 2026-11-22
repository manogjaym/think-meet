import { Injectable } from '@nestjs/common'
import type { AssistanceBinding } from './assistance'
import type { ErrorCode } from './errors'

/** What the lesson service needs from the realtime transport. Gateway implements it. */
export interface LessonRealtimeSink {
  publishSnapshot(lessonId: string, snapshot: { participants: Array<{ user: { id: string } }> }): void | Promise<void>
  notifyUsers(userIds: string[]): void
  notifyAllUsers(): void
  /** `REPLACED` is internal: the replacement is announced by LiveKit, so the socket is kept. */
  disconnectUser(lessonId: string, userId: string, code: ErrorCode | 'REPLACED'): void
  assistanceConnected(session: AssistanceBinding): boolean
}

/**
 * Explicit, typed seam between Lessons and Gateway. Lessons never holds transport callbacks itself;
 * a missing transport (CLI, tests without a gateway) is logged once instead of silently dropping events.
 */
@Injectable()
export class LessonRealtime implements LessonRealtimeSink {
  private sink?: LessonRealtimeSink
  private warned = false
  attach(sink: LessonRealtimeSink) { this.sink = sink }
  private target() {
    if (!this.sink && !this.warned) { this.warned = true; console.warn('lesson realtime transport is not attached; realtime events are not delivered') }
    return this.sink
  }
  publishSnapshot(lessonId: string, snapshot: Parameters<LessonRealtimeSink['publishSnapshot']>[1]) { return this.target()?.publishSnapshot(lessonId, snapshot) }
  notifyUsers(userIds: string[]) { this.target()?.notifyUsers(userIds) }
  notifyAllUsers() { this.target()?.notifyAllUsers() }
  disconnectUser(lessonId: string, userId: string, code: ErrorCode | 'REPLACED') { this.target()?.disconnectUser(lessonId, userId, code) }
  /** Without a transport no device is connected, so consent can never be considered live. */
  assistanceConnected(session: AssistanceBinding) { return this.target()?.assistanceConnected(session) ?? false }
}
