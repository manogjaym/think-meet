// Generated from contracts/openapi.json and realtime.json. Do not edit.
export const CONTRACT_REVISION = 15 as const;
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
  "AssistancePointer": "assistance.pointer",
  "ParticipantMedia": "participant.media"
} as const;
export const REALTIME_EVENTS = SOCKET_EVENTS;
export type Role = "teacher" | "student";
export type LessonAccessMode = "INVITE_ONLY" | "OPEN";
export type User = { id: string; username: string; name: string; role: Role };
export type LessonParticipant = { userId: string; joinedAt: string };
export type Attendance = { userId: string; joinedAt: string; leftAt: (string) | null };
export type TeacherSubject = { id: string; name: string };
export type Lesson = { id: string; title: string; description: string; accessMode?: LessonAccessMode; teacher: User; subject?: TeacherSubject; instruction?: LessonInstruction; students: Array<User>; startsAt: string; endsAt: (string) | null; status: "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED"; code: string; startedAt: (string) | null; endedAt: (string) | null; participants?: Array<LessonParticipant>; attendance?: Array<Attendance> };
export type LessonInput = { title: string; subjectId?: (string) | null; description?: string; startsAt: string; endsAt: (string) | null; accessMode?: LessonAccessMode; studentIds?: Array<string> };
export type JoinResult = { waiting: boolean; lesson: Lesson; token?: string; livekitUrl?: string; admissionId?: string };
export type Material = { id: string; name: string; type: "media" | "document"; size: number; duration?: (number) | null; pages?: (number) | null; createdAt: string; subject?: TeacherSubject };
export type Share = { id: string; type: "screen" | "media" | "document"; ownerId: string; materialId?: string; material?: Material; page: number; playing: boolean; position: number; updatedAt: string; assistanceId?: string };
export type Point = { x: number; y: number };
export type Stroke = { id: string; authorId: string; shareId: string; page: number; tool: "pen" | "highlighter"; color: string; points: Array<Point>; deleted: boolean };
export type PreviewStroke = { shareId: string; page: number; tool: "pen" | "highlighter"; color: string; points: Array<Point>; authorId?: string };
export type StrokePreview = { lessonId: string; shareId: string; page: number; tool: "pen" | "highlighter"; color: string; points: Array<Point>; authorId?: string };
export type MeetingParticipant = { user: User; online: boolean; raised: boolean; annotationAllowed?: boolean };
export type ChatMessage = { id: string; clientId: string; userId: string; userName: string; text: string; createdAt: string };
export type LessonInstruction = { phase: "preparing" | "classroom" | "mirroring"; startedAt: (string) | null };
export type MeetingSnapshot = { lessonId: string; lesson: Lesson; instruction?: LessonInstruction; participants: Array<MeetingParticipant>; messages: Array<ChatMessage>; share: (Share) | null; strokes: Array<Stroke>; seq: number; serverTime: string; assistance?: (AssistanceSession) | null };
export type RealtimeError = { code: string; message: string };
export type ErrorResponse = { code: string; message: string };
export type ErrorCode = "ACCOUNT" | "ANNOTATION_NOT_ALLOWED" | "ASSISTANCE_BUSY" | "ASSISTANCE_UNAVAILABLE" | "CANCELLED" | "CLIENT_UPDATE_REQUIRED" | "CONFLICT" | "CONNECTION" | "CONSENT_REQUIRED" | "ENDED" | "FEATURE_UNAVAILABLE" | "FILE_TOO_LARGE" | "FORBIDDEN" | "INTERNAL" | "INVALID" | "INVALID_CREDENTIALS" | "INVALID_FILE" | "INVALID_MATERIAL" | "INVALID_SIGNATURE" | "KICKED" | "LESSON_MODE_CHANGED" | "LESSON_MODE_REQUIRED" | "LESSON_NOT_STARTED" | "LIVE" | "MATERIAL_IN_USE" | "NOTE_SHARE_CHANGED" | "NOTE_TARGET_CHANGED" | "NOT_CONNECTED" | "NOT_FOUND" | "NOT_READY" | "NO_SHARE" | "PARTICIPANT_UNAVAILABLE" | "RATE_LIMIT" | "RECORDING_OFFSET" | "REQUEST_FAILED" | "SCREEN_NOT_PUBLISHED" | "SHARE_BUSY" | "STALE_ASSISTANCE" | "STALE_GEOMETRY" | "STALE_SHARE" | "UNAUTHENTICATED" | "UNKNOWN_COMMAND" | "UNSUPPORTED_CODEC" | "UNSUPPORTED_FILE" | "UPLOAD_CANCELLED" | "VALIDATION" | "WAITING";
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
export type LessonModeSetPayload = { mode: "classroom" | "mirroring"; expectedMode: "classroom" | "mirroring"; expectedShareId: (string) | null; expectedAssistanceId: (string) | null };
export type DocumentOpenPayload = { materialId: string; page: number };
export type ShareStartPayload = { type: "screen" | "media" | "document"; materialId?: string };
export type EmptyPayload = Record<string, never>;
export type MediaUpdatePayload = { playing: boolean; position: number };
export type DocumentPagePayload = { page: number };
export type StrokeAddPayload = { id: string; shareId: string; page: number; tool: "pen" | "highlighter"; color: string; points: Array<Point> };
export type StrokeErasePayload = { ids: Array<string> };
export type ParticipantControlPayload = { userId: string; microphone?: boolean; camera?: boolean; annotation?: boolean };
export type ParticipantMediaRequest = { lessonId: string; userId: string; requestedBy: string; microphone?: boolean; camera?: boolean };
export type AssistanceGeometry = { width: number; height: number; rotation: 0 | 90 | 180 | 270; version: number };
export type AssistanceSession = { id: string; teacherId: string; studentId: string; status: "pending" | "approved" | "active"; expiresAt: (string) | null; shareId?: string; geometry?: AssistanceGeometry };
export type AssistancePointer = { lessonId: string; sessionId: string; shareId: string; geometryVersion: number; x: number; y: number; authorId?: string };
export type AssistanceRequestPayload = { studentId: string };
export type AssistanceRespondPayload = { sessionId: string; approved: boolean };
export type AssistanceStartPayload = { sessionId: string; geometry: AssistanceGeometry };
export type AssistanceGeometryPayload = { sessionId: string; geometry: AssistanceGeometry };
export type AssistanceStopPayload = { sessionId: string };
export type ClassNoteLesson = { id: string; title: string; startsAt: string; teacherName: string; subject?: TeacherSubject };
export type ClassNoteTarget = { lesson: (ClassNoteLesson) | null };
export type ClassNoteImage = { id: string; createdAt: string };
export type ClassNoteWorksheet = { lesson: ClassNoteLesson; studentName: string; original: ClassNoteImage; correction: (ClassNoteImage) | null };
export type ClassNoteCapture = { lesson: ClassNoteLesson; image: ClassNoteImage; source: "self" | "teacher" };
export type StudentAttendanceStatus = "PRESENT" | "LATE" | "ABSENT";
export type StudentAttendanceReason = "DEVICE" | "NETWORK" | "OTHER";
export type StudentAttendanceStudent = { id: string; name: string };
export type StudentAttendanceSummary = { rate: (number) | null; present: number; late: number; absent: number };
export type StudentAttendanceRow = { lessonId: string; lessonTitle: string; startsAt: string; firstJoinedAt: (string) | null; lastLeftAt: (string) | null; durationSeconds: number; status: StudentAttendanceStatus; reason: (StudentAttendanceReason) | null; memo: (string) | null };
export type StudentAttendanceMonth = { student: StudentAttendanceStudent; month: string; summary: StudentAttendanceSummary; rows: Array<StudentAttendanceRow> };
export type StudentAttendanceInput = { status: StudentAttendanceStatus; reason?: (StudentAttendanceReason) | null; memo?: (string) | null };
export type PrejoinStudent = { id: string; name: string };
export type PrejoinStatus = { status: "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED"; waitingStudents?: Array<PrejoinStudent> };
export type LessonRecordingInput = { requestId: string; size: number; durationMs: number; width: number; height: number; startedAt: string };
export type LessonRecording = { id: string; lessonId: string; lessonTitle: string; status: "uploading" | "ready"; size: number; uploadedBytes: number; chunkSize: number; durationMs: number; width: number; height: number; startedAt: string; createdAt: string; expiresAt: string; lesson?: ClassNoteLesson };
export type ApiLesson = Lesson;
export const ERROR_CODES = ["ACCOUNT","ANNOTATION_NOT_ALLOWED","ASSISTANCE_BUSY","ASSISTANCE_UNAVAILABLE","CANCELLED","CLIENT_UPDATE_REQUIRED","CONFLICT","CONNECTION","CONSENT_REQUIRED","ENDED","FEATURE_UNAVAILABLE","FILE_TOO_LARGE","FORBIDDEN","INTERNAL","INVALID","INVALID_CREDENTIALS","INVALID_FILE","INVALID_MATERIAL","INVALID_SIGNATURE","KICKED","LESSON_MODE_CHANGED","LESSON_MODE_REQUIRED","LESSON_NOT_STARTED","LIVE","MATERIAL_IN_USE","NOTE_SHARE_CHANGED","NOTE_TARGET_CHANGED","NOT_CONNECTED","NOT_FOUND","NOT_READY","NO_SHARE","PARTICIPANT_UNAVAILABLE","RATE_LIMIT","RECORDING_OFFSET","REQUEST_FAILED","SCREEN_NOT_PUBLISHED","SHARE_BUSY","STALE_ASSISTANCE","STALE_GEOMETRY","STALE_SHARE","UNAUTHENTICATED","UNKNOWN_COMMAND","UNSUPPORTED_CODEC","UNSUPPORTED_FILE","UPLOAD_CANCELLED","VALIDATION","WAITING"] as const;
export type ApiOperations = {
  health: { method: "GET"; path: "/health"; params: undefined; query: undefined; body: undefined; response: Record<string, unknown> };
  capabilities: { method: "GET"; path: "/capabilities"; params: undefined; query: undefined; body: undefined; response: CapabilitiesResponse };
  authMe: { method: "GET"; path: "/auth/me"; params: undefined; query: undefined; body: undefined; response: User };
  authLogin: { method: "POST"; path: "/auth/login"; params: undefined; query: undefined; body: LoginInput; response: User };
  authLogout: { method: "POST"; path: "/auth/logout"; params: undefined; query: undefined; body: undefined; response: Record<string, unknown> };
  listStudents: { method: "GET"; path: "/students"; params: undefined; query: undefined; body: undefined; response: Array<User> };
  listStudentAttendance: { method: "GET"; path: "/students/{studentId}/attendance"; params: { studentId: string }; query: { month: string }; body: undefined; response: StudentAttendanceMonth };
  saveStudentAttendance: { method: "PUT"; path: "/students/{studentId}/attendance/{lessonId}"; params: { studentId: string; lessonId: string }; query: undefined; body: StudentAttendanceInput; response: StudentAttendanceMonth };
  listTeacherSubjects: { method: "GET"; path: "/subjects"; params: undefined; query: undefined; body: undefined; response: Array<TeacherSubject> };
  listLessons: { method: "GET"; path: "/lessons"; params: undefined; query: undefined; body: undefined; response: Array<Lesson> };
  createLesson: { method: "POST"; path: "/lessons"; params: undefined; query: undefined; body: LessonInput; response: Lesson };
  resolveLesson: { method: "GET"; path: "/join/{code}"; params: { code: string }; query: undefined; body: undefined; response: Lesson };
  getLesson: { method: "GET"; path: "/lessons/{id}"; params: { id: string }; query: undefined; body: undefined; response: Lesson };
  updateLesson: { method: "PATCH"; path: "/lessons/{id}"; params: { id: string }; query: undefined; body: LessonInput; response: Lesson };
  cancelLesson: { method: "POST"; path: "/lessons/{id}/cancel"; params: { id: string }; query: undefined; body: undefined; response: Lesson };
  connectedLesson: { method: "POST"; path: "/lessons/{id}/connected"; params: { id: string }; query: undefined; body: undefined; response: Lesson };
  endLesson: { method: "POST"; path: "/lessons/{id}/end"; params: { id: string }; query: undefined; body: undefined; response: Lesson };
  joinLesson: { method: "POST"; path: "/lessons/{id}/join"; params: { id: string }; query: undefined; body: undefined; response: JoinResult };
  leaveLesson: { method: "POST"; path: "/lessons/{id}/leave"; params: { id: string }; query: undefined; body: undefined; response: Record<string, unknown> };
  kickParticipant: { method: "POST"; path: "/lessons/{id}/kick"; params: { id: string }; query: undefined; body: KickInput; response: Record<string, unknown> };
  inviteStudents: { method: "POST"; path: "/lessons/{id}/invites"; params: { id: string }; query: undefined; body: InviteInput; response: Lesson };
  getSnapshot: { method: "GET"; path: "/lessons/{id}/snapshot"; params: { id: string }; query: undefined; body: undefined; response: MeetingSnapshot };
  listMaterials: { method: "GET"; path: "/materials"; params: undefined; query: { lessonId?: string }; body: undefined; response: Array<Material> };
  uploadMaterial: { method: "POST"; path: "/materials"; params: undefined; query: { lessonId?: string }; body: FormData; response: Material };
  deleteMaterial: { method: "DELETE"; path: "/materials/{id}"; params: { id: string }; query: undefined; body: undefined; response: Record<string, unknown> };
  getMaterialContent: { method: "GET"; path: "/materials/{id}/content"; params: { id: string }; query: { lessonId?: string }; body: undefined; response: Response };
  livekitWebhook: { method: "POST"; path: "/webhooks/livekit"; params: undefined; query: undefined; body: string; response: Record<string, unknown> };
  getClassNoteTarget: { method: "GET"; path: "/class-notes/target"; params: undefined; query: undefined; body: undefined; response: ClassNoteTarget };
  listClassNoteWorksheets: { method: "GET"; path: "/class-notes/worksheets"; params: undefined; query: { month?: string; lessonId?: string }; body: undefined; response: Array<ClassNoteWorksheet> };
  submitClassNoteWorksheet: { method: "POST"; path: "/class-notes/lessons/{id}/worksheets"; params: { id: string }; query: undefined; body: FormData; response: ClassNoteImage };
  submitClassNoteCorrection: { method: "POST"; path: "/class-notes/worksheets/{id}/correction"; params: { id: string }; query: undefined; body: FormData; response: ClassNoteImage };
  listClassNoteCaptures: { method: "GET"; path: "/class-notes/captures"; params: undefined; query: undefined; body: undefined; response: Array<ClassNoteCapture> };
  saveClassNoteCapture: { method: "POST"; path: "/class-notes/lessons/{id}/captures"; params: { id: string }; query: undefined; body: FormData; response: ClassNoteImage };
  getClassNoteImage: { method: "GET"; path: "/class-notes/images/{id}"; params: { id: string }; query: undefined; body: undefined; response: Response };
  getPrejoinStatus: { method: "GET"; path: "/lessons/{id}/prejoin"; params: { id: string }; query: undefined; body: undefined; response: PrejoinStatus };
  renewPrejoinWait: { method: "PUT"; path: "/lessons/{id}/waiting/{clientId}"; params: { id: string; clientId: string }; query: undefined; body: undefined; response: void };
  clearPrejoinWait: { method: "DELETE"; path: "/lessons/{id}/waiting/{clientId}"; params: { id: string; clientId: string }; query: undefined; body: undefined; response: void };
  createLessonRecording: { method: "POST"; path: "/lessons/{id}/recordings"; params: { id: string }; query: undefined; body: LessonRecordingInput; response: LessonRecording };
  listLessonRecordings: { method: "GET"; path: "/recordings"; params: undefined; query: { lessonId?: string }; body: undefined; response: Array<LessonRecording> };
  uploadLessonRecordingChunk: { method: "PUT"; path: "/recordings/{id}/content"; params: { id: string }; query: { offset: number }; body: string; response: LessonRecording };
  getLessonRecordingContent: { method: "GET"; path: "/recordings/{id}/content"; params: { id: string }; query: { platform?: "web" | "android" | "ios"; contractRevision?: number }; body: undefined; response: Response };
};
export type ApiOperationId = keyof ApiOperations;
export const API_OPERATIONS = {
  "health": {
    "method": "GET",
    "path": "/health"
  },
  "capabilities": {
    "method": "GET",
    "path": "/capabilities"
  },
  "authMe": {
    "method": "GET",
    "path": "/auth/me"
  },
  "authLogin": {
    "method": "POST",
    "path": "/auth/login"
  },
  "authLogout": {
    "method": "POST",
    "path": "/auth/logout"
  },
  "listStudents": {
    "method": "GET",
    "path": "/students"
  },
  "listStudentAttendance": {
    "method": "GET",
    "path": "/students/{studentId}/attendance"
  },
  "saveStudentAttendance": {
    "method": "PUT",
    "path": "/students/{studentId}/attendance/{lessonId}"
  },
  "listTeacherSubjects": {
    "method": "GET",
    "path": "/subjects"
  },
  "listLessons": {
    "method": "GET",
    "path": "/lessons"
  },
  "createLesson": {
    "method": "POST",
    "path": "/lessons"
  },
  "resolveLesson": {
    "method": "GET",
    "path": "/join/{code}"
  },
  "getLesson": {
    "method": "GET",
    "path": "/lessons/{id}"
  },
  "updateLesson": {
    "method": "PATCH",
    "path": "/lessons/{id}"
  },
  "cancelLesson": {
    "method": "POST",
    "path": "/lessons/{id}/cancel"
  },
  "connectedLesson": {
    "method": "POST",
    "path": "/lessons/{id}/connected"
  },
  "endLesson": {
    "method": "POST",
    "path": "/lessons/{id}/end"
  },
  "joinLesson": {
    "method": "POST",
    "path": "/lessons/{id}/join"
  },
  "leaveLesson": {
    "method": "POST",
    "path": "/lessons/{id}/leave"
  },
  "kickParticipant": {
    "method": "POST",
    "path": "/lessons/{id}/kick"
  },
  "inviteStudents": {
    "method": "POST",
    "path": "/lessons/{id}/invites"
  },
  "getSnapshot": {
    "method": "GET",
    "path": "/lessons/{id}/snapshot"
  },
  "listMaterials": {
    "method": "GET",
    "path": "/materials"
  },
  "uploadMaterial": {
    "method": "POST",
    "path": "/materials"
  },
  "deleteMaterial": {
    "method": "DELETE",
    "path": "/materials/{id}"
  },
  "getMaterialContent": {
    "method": "GET",
    "path": "/materials/{id}/content"
  },
  "livekitWebhook": {
    "method": "POST",
    "path": "/webhooks/livekit"
  },
  "getClassNoteTarget": {
    "method": "GET",
    "path": "/class-notes/target"
  },
  "listClassNoteWorksheets": {
    "method": "GET",
    "path": "/class-notes/worksheets"
  },
  "submitClassNoteWorksheet": {
    "method": "POST",
    "path": "/class-notes/lessons/{id}/worksheets"
  },
  "submitClassNoteCorrection": {
    "method": "POST",
    "path": "/class-notes/worksheets/{id}/correction"
  },
  "listClassNoteCaptures": {
    "method": "GET",
    "path": "/class-notes/captures"
  },
  "saveClassNoteCapture": {
    "method": "POST",
    "path": "/class-notes/lessons/{id}/captures"
  },
  "getClassNoteImage": {
    "method": "GET",
    "path": "/class-notes/images/{id}"
  },
  "getPrejoinStatus": {
    "method": "GET",
    "path": "/lessons/{id}/prejoin"
  },
  "renewPrejoinWait": {
    "method": "PUT",
    "path": "/lessons/{id}/waiting/{clientId}"
  },
  "clearPrejoinWait": {
    "method": "DELETE",
    "path": "/lessons/{id}/waiting/{clientId}"
  },
  "createLessonRecording": {
    "method": "POST",
    "path": "/lessons/{id}/recordings"
  },
  "listLessonRecordings": {
    "method": "GET",
    "path": "/recordings"
  },
  "uploadLessonRecordingChunk": {
    "method": "PUT",
    "path": "/recordings/{id}/content"
  },
  "getLessonRecordingContent": {
    "method": "GET",
    "path": "/recordings/{id}/content"
  }
} as const satisfies Record<ApiOperationId, { method: string; path: string }>;
export type CommandType = "lesson.start" | "lesson.mode.set" | "chat.send" | "hand.set" | "share.start" | "share.stop" | "media.update" | "document.page" | "document.open" | "stroke.add" | "stroke.erase" | "annotation.undo" | "annotation.redo" | "annotation.clear" | "assistance.request" | "assistance.respond" | "assistance.start" | "assistance.geometry" | "assistance.stop" | "participant.control";
export type CommandPayloads = { "lesson.start": EmptyPayload; "lesson.mode.set": LessonModeSetPayload; "chat.send": ChatSendPayload; "hand.set": HandSetPayload; "share.start": ShareStartPayload; "share.stop": EmptyPayload; "media.update": MediaUpdatePayload; "document.page": DocumentPagePayload; "document.open": DocumentOpenPayload; "stroke.add": StrokeAddPayload; "stroke.erase": StrokeErasePayload; "annotation.undo": EmptyPayload; "annotation.redo": EmptyPayload; "annotation.clear": EmptyPayload; "assistance.request": AssistanceRequestPayload; "assistance.respond": AssistanceRespondPayload; "assistance.start": AssistanceStartPayload; "assistance.geometry": AssistanceGeometryPayload; "assistance.stop": AssistanceStopPayload; "participant.control": ParticipantControlPayload };
