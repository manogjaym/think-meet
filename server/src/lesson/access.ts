import { ApiError } from '../errors'
import type { PublicUser } from '../types'

type AccessLesson = { teacherId: string; accessMode: string; status: string; members: Array<{ userId: string; banned: boolean }> }

/**
 * Pure lesson authorization, shared by HTTP/Socket handlers and per-socket broadcast filtering
 * so a broadcast can check many sockets against one lesson read.
 */
export function assertLessonAccess<T extends AccessLesson>(lesson: T, user: PublicUser, requireLive = false, teacherOnly = false): T {
  if (teacherOnly && lesson.teacherId !== user.id) throw new ApiError('FORBIDDEN', '수업을 관리할 권한이 없습니다.', 403)
  const member = lesson.members.find(member => member.userId === user.id)
  if (!member && lesson.teacherId !== user.id && (lesson.accessMode !== 'OPEN' || requireLive)) throw new ApiError('ACCOUNT', '이 수업에 참여할 권한이 없습니다.', 403)
  if (member?.banned) throw new ApiError('KICKED', '선생님에 의해 수업에서 퇴장되었습니다.', 403)
  if (requireLive && lesson.status !== 'LIVE') throw new ApiError(lesson.status === 'CANCELLED' ? 'CANCELLED' : lesson.status === 'ENDED' ? 'ENDED' : 'WAITING', '현재 참여할 수 없는 수업입니다.', 409)
  return lesson
}
