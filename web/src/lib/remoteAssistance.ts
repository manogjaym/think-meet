import type { AssistanceGeometry, AssistancePointer, AssistanceSession, MeetingSnapshot, Point } from "../generated/contracts"

export const REMOTE_POINTER_TTL_MS = 1500
export const REMOTE_POINTER_INTERVAL_MS = 50
export type RemotePointer = AssistancePointer & { receivedAt: number }

export function currentAssistance(session: AssistanceSession | null | undefined, now = Date.now()): session is AssistanceSession {
  return Boolean(session && (session.expiresAt === null || Date.parse(session.expiresAt) > now))
}

export function activeAssistance(snapshot: MeetingSnapshot | null, now = Date.now()): AssistanceSession | null {
  const session = snapshot?.assistance
  const share = snapshot?.share
  return currentAssistance(session, now) && session.status === "active" && session.geometry && share?.type === "screen" && share.assistanceId === session.id && session.shareId === share.id && session.studentId === share.ownerId && session.teacherId === snapshot?.lesson.teacher.id && snapshot.lesson.status === "LIVE" ? session : null
}

/** The geometry already describes the captured orientation, so never rotate these coordinates again. */
export function geometryMatchesVideo(geometry: AssistanceGeometry | undefined, videoWidth: number, videoHeight: number): boolean {
  if (!geometry || !Number.isFinite(videoWidth) || !Number.isFinite(videoHeight) || videoWidth <= 0 || videoHeight <= 0 || geometry.width <= 0 || geometry.height <= 0) return false
  return Math.abs(videoWidth / videoHeight / (geometry.width / geometry.height) - 1) < .01
}

/** Reject letterbox margins instead of mapping them to the student's screen edge. */
export function assistancePoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Point | null {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
  const x = (clientX - rect.left) / rect.width, y = (clientY - rect.top) / rect.height
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null
}

export function matchesAssistancePointer(frame: AssistancePointer, snapshot: MeetingSnapshot | null, now = Date.now()): boolean {
  const session = activeAssistance(snapshot, now)
  return Boolean(frame && session && frame.lessonId === snapshot?.lessonId && frame.sessionId === session.id && frame.shareId === session.shareId && frame.geometryVersion === session.geometry?.version && frame.authorId === session.teacherId && Number.isFinite(frame.x) && Number.isFinite(frame.y) && frame.x >= 0 && frame.x <= 1 && frame.y >= 0 && frame.y <= 1)
}
