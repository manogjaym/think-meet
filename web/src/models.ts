export type { Role } from "./generated/contracts"
export type Screen = "home" | "class-notes" | "students" | "attendance" | "detail" | "form" | "created" | "prejoin" | "waiting" | "meeting" | "ended" | "exception"
export type HomeState = "default" | "noHistory" | "noSchedule" | "empty" | "search" | "noSearch" | "loading" | "error"
export type Panel = "people" | "more" | "chat" | "invite" | "settings" | "content" | null
export type MeetingState = "solo" | "one" | "group" | "unstable" | "reconnecting"
