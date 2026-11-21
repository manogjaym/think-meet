// Generated from contracts/openapi.json and realtime.json. Do not edit.
export const CONTRACT_REVISION = 6 as const;
export const API_BASE_PATH = "/api/v1" as const;
export const SOCKET_PATH = "/socket.io" as const;
export const SOCKET_EVENTS = {
  "Subscribe": "subscribe",
  "Command": "command",
  "StrokePreview": "stroke.preview",
  "Snapshot": "snapshot",
  "LessonsChanged": "lessons:changed",
  "RoomError": "room:error",
  "SessionReplaced": "session:replaced",
  "AssistancePointer": "assistance.pointer"
} as const;
export const REALTIME_EVENTS = SOCKET_EVENTS;
export type Role = "teacher" | "student";
export type LessonAccessMode = "INVITE_ONLY" | "OPEN";
export type User = { id: string; username: string; name: string; role: Role };
export type LessonParticipant = { userId: string; joinedAt: string };
export type Attendance = { userId: string; joinedAt: string; leftAt: (string) | null };
export type Lesson = { id: string; title: string; description: string; accessMode?: LessonAccessMode; teacher: User; students: Array<User>; startsAt: string; endsAt: (string) | null; status: "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED"; code: string; startedAt: (string) | null; endedAt: (string) | null; participants?: Array<LessonParticipant>; attendance?: Array<Attendance> };
export type LessonInput = { title: string; description?: string; startsAt: string; endsAt: (string) | null; accessMode?: LessonAccessMode; studentIds?: Array<string> };
export type JoinResult = { waiting: boolean; lesson: Lesson; token?: string; livekitUrl?: string; admissionId?: string };
export type Material = { id: string; name: string; type: "media" | "document"; size: number; duration?: (number) | null; pages?: (number) | null; createdAt: string };
export type Share = { id: string; type: "screen" | "media" | "document"; ownerId: string; materialId?: string; material?: Material; page: number; playing: boolean; position: number; updatedAt: string; assistanceId?: string };
export type Point = { x: number; y: number };
export type Stroke = { id: string; authorId: string; shareId: string; page: number; tool: "pen" | "highlighter"; color: string; points: Array<Point>; deleted: boolean };
export type PreviewStroke = { shareId: string; page: number; tool: "pen" | "highlighter"; color: string; points: Array<Point>; authorId?: string };
export type StrokePreview = { lessonId: string; shareId: string; page: number; tool: "pen" | "highlighter"; color: string; points: Array<Point>; authorId?: string };
export type MeetingParticipant = { user: User; online: boolean; raised: boolean };
export type ChatMessage = { id: string; clientId: string; userId: string; userName: string; text: string; createdAt: string };
export type MeetingSnapshot = { lessonId: string; lesson: Lesson; participants: Array<MeetingParticipant>; messages: Array<ChatMessage>; share: (Share) | null; strokes: Array<Stroke>; seq: number; serverTime: string; assistance?: (AssistanceSession) | null };
export type RealtimeError = { code: string; message: string };
export type ErrorResponse = { code: string; message: string };
export type LoginInput = { username: string; password: string };
export type KickInput = { userId: string };
export type InviteInput = { studentIds: Array<string> };
export type SubscribeInput = { lessonId: string };
export type CommandEnvelope = { lessonId: string; type: string; payload?: Record<string, unknown>; requestId?: string; expectedShareId?: string };
export type SuccessAck = { ok: true; snapshot: MeetingSnapshot };
export type ErrorAck = { ok: false; error: RealtimeError };
export type CommandAck = SuccessAck | ErrorAck;
export type CapabilitiesResponse = { contractRevision: number; features: Record<string, boolean> };
export type ChatSendPayload = { text: string; clientId: string };
export type HandSetPayload = { raised: boolean };
export type ShareStartPayload = { type: "screen" | "media" | "document"; materialId?: string };
export type EmptyPayload = Record<string, never>;
export type MediaUpdatePayload = { playing: boolean; position: number };
export type DocumentPagePayload = { page: number };
export type StrokeAddPayload = { id: string; shareId: string; page: number; tool: "pen" | "highlighter"; color: string; points: Array<Point> };
export type StrokeErasePayload = { ids: Array<string> };
export type AssistanceGeometry = { width: number; height: number; rotation: 0 | 90 | 180 | 270; version: number };
export type AssistanceSession = { id: string; teacherId: string; studentId: string; status: "pending" | "approved" | "active"; expiresAt: (string) | null; shareId?: string; geometry?: AssistanceGeometry };
export type AssistancePointer = { lessonId: string; sessionId: string; shareId: string; geometryVersion: number; x: number; y: number; authorId?: string };
export type AssistanceRequestPayload = { studentId: string };
export type AssistanceRespondPayload = { sessionId: string; approved: boolean };
export type AssistanceStartPayload = { sessionId: string; geometry: AssistanceGeometry };
export type AssistanceGeometryPayload = { sessionId: string; geometry: AssistanceGeometry };
export type AssistanceStopPayload = { sessionId: string };
export type ClassNoteLesson = { id: string; title: string; startsAt: string; teacherName: string };
export type ClassNoteTarget = { lesson: (ClassNoteLesson) | null };
export type ClassNoteImage = { id: string; createdAt: string };
export type ClassNoteWorksheet = { lesson: ClassNoteLesson; studentName: string; original: ClassNoteImage; correction: (ClassNoteImage) | null };
export type ClassNoteCapture = { lesson: ClassNoteLesson; image: ClassNoteImage; source: "self" | "teacher" };
export type ApiLesson = Lesson;
export type CommandType = "chat.send" | "hand.set" | "share.start" | "share.stop" | "media.update" | "document.page" | "stroke.add" | "stroke.erase" | "annotation.undo" | "annotation.redo" | "annotation.clear" | "assistance.request" | "assistance.respond" | "assistance.start" | "assistance.geometry" | "assistance.stop";
export type CommandPayloads = { "chat.send": ChatSendPayload; "hand.set": HandSetPayload; "share.start": ShareStartPayload; "share.stop": EmptyPayload; "media.update": MediaUpdatePayload; "document.page": DocumentPagePayload; "stroke.add": StrokeAddPayload; "stroke.erase": StrokeErasePayload; "annotation.undo": EmptyPayload; "annotation.redo": EmptyPayload; "annotation.clear": EmptyPayload; "assistance.request": AssistanceRequestPayload; "assistance.respond": AssistanceRespondPayload; "assistance.start": AssistanceStartPayload; "assistance.geometry": AssistanceGeometryPayload; "assistance.stop": AssistanceStopPayload };
