import type { ClassNoteCapture, ClassNoteImage, ClassNoteTarget, ClassNoteWorksheet } from "../generated/contracts"
import { api, apiResponse } from "./api"

export const notesFeature = "classroom.notes"
export const notesImageTypes = "image/jpeg,image/png"
const base = "/class-notes"
export const noteTarget = (signal?: AbortSignal) => api<ClassNoteTarget>(`${base}/target`, { signal })
export const noteWorksheets = (query: { month: string } | { lessonId: string }, signal?: AbortSignal) =>
  api<ClassNoteWorksheet[]>(`${base}/worksheets?${new URLSearchParams(query)}`, { signal })
export const noteCaptures = (signal?: AbortSignal) => api<ClassNoteCapture[]>(`${base}/captures`, { signal })
export const noteImage = async (id: string, signal: AbortSignal) => (await apiResponse(`${base}/images/${id}`, { signal })).blob()

export function uploadNote(path: string, file: Blob, requestId: string, fields: Record<string, string> = {}, signal?: AbortSignal) {
  const body = new FormData()
  body.append("file", file, file.type === "image/png" ? "image.png" : "image.jpg")
  body.append("requestId", requestId)
  Object.entries(fields).forEach(([name, value]) => body.append(name, value))
  return api<ClassNoteImage>(`${base}${path}`, { method: "POST", body, signal })
}

export function validateNoteFile(file: File) {
  if (!notesImageTypes.split(",").includes(file.type) && (file.type || !/\.(jpe?g|png)$/i.test(file.name))) return "JPEG 또는 PNG 이미지를 선택해 주세요."
  if (!file.size) return "이미지 파일이 비어 있어요."
  if (file.size > 10 * 1024 * 1024) return "이미지는 10MiB까지 올릴 수 있어요."
  return ""
}

const seoulDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
const readableDay = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" })
export const noteDay = (date: string) => seoulDay.format(new Date(date))
export const noteDateLabel = (date: string) => readableDay.format(new Date(date))
export const currentNoteMonth = () => seoulDay.format(new Date()).slice(0, 7)
export function shiftNoteMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number)
  return new Date(Date.UTC(year, value - 1 + delta, 1)).toISOString().slice(0, 7)
}
