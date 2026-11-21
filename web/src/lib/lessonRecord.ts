import type { ApiLesson } from "../generated/contracts"
import { koreaParts } from "./api"

export function lessonRecordStart(lesson: ApiLesson) {
  return lesson.instruction ? lesson.instruction.startedAt : lesson.startedAt
}

export function completedLessonTime(lesson: ApiLesson) {
  const startedAt = lessonRecordStart(lesson)
  if (lesson.status !== "ENDED" || !startedAt || !lesson.endedAt) return undefined
  const elapsed = Date.parse(lesson.endedAt) - Date.parse(startedAt)
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined
  const start = koreaParts(startedAt)
  const end = koreaParts(lesson.endedAt)
  const finish = start.dateISO === end.dateISO ? end.time : `${end.dateISO} ${end.time}`
  return `${start.dateISO} ${start.time} – ${finish} · ${Math.round(elapsed / 60_000)}분`
}
