import type { CommandEnvelope, MeetingSnapshot } from "../generated/contracts"
import { API_BASE_PATH } from "../generated/contracts"
export type { Material, Share, Point, Stroke, PreviewStroke, MeetingSnapshot } from "../generated/contracts"
export type Command = (type: CommandEnvelope["type"], payload?: CommandEnvelope["payload"], expectedShareId?: CommandEnvelope["expectedShareId"]) => Promise<MeetingSnapshot>
export const materialContentUrl = (id: string, lessonId?: string) =>
  `${API_BASE_PATH}/materials/${encodeURIComponent(id)}/content${lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : ""}`
export const friendlyError = (error: unknown) => error instanceof Error ? error.message : "요청을 처리하지 못했어요. 다시 시도해 주세요."
export const formatDuration = (seconds: number) => { const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0; return `${Math.floor(value / 60).toString().padStart(2, "0")}:${Math.floor(value % 60).toString().padStart(2, "0")}` }
export const readDevicePreferences = (): { cameraId?: string; microphoneId?: string; speakerId?: string; noise?: boolean } => {
  try { return JSON.parse(localStorage.getItem("think-meet.devices") || "{}") } catch { return {} }
}
export const saveDevicePreferences = (value: { cameraId?: string; microphoneId?: string; speakerId?: string; noise?: boolean }) => { localStorage.setItem("think-meet.devices", JSON.stringify(value)) }
