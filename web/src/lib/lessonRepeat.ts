import type { LessonRepeatFrequency } from "../generated/contracts"

/** Same limit as server/src/lesson-series.ts. */
export const MAX_SERIES_LESSONS = 100
export type LessonRepeatMode = "NONE" | LessonRepeatFrequency
/** ISO weekday numbers (1 = Monday … 7 = Sunday) in display order. */
export const REPEAT_WEEKDAYS = [
  { day: 1, label: "월" },
  { day: 2, label: "화" },
  { day: 3, label: "수" },
  { day: 4, label: "목" },
  { day: 5, label: "금" },
  { day: 6, label: "토" },
  { day: 7, label: "일" },
] as const

const DAY = 24 * 60 * 60 * 1000
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY)
const isoWeekday = (day: number) => (((day + 3) % 7) + 7) % 7 + 1
const dateText = (day: number) => new Date(day * DAY).toISOString().slice(0, 10)

export function weekdayOf(date: string) {
  const day = dayNumber(date)
  return Number.isNaN(day) ? undefined : isoWeekday(day)
}

/**
 * Lesson dates (YYYY-MM-DD, Asia/Seoul) from `start` through `until`, matching the server rule.
 * Stops after `MAX_SERIES_LESSONS + 1` dates so callers can report the limit.
 */
export function repeatDates(start: string, until: string, frequency: LessonRepeatFrequency, weekdays: number[]) {
  const first = dayNumber(start)
  const last = dayNumber(until)
  if (Number.isNaN(first) || Number.isNaN(last)) return []
  const firstMonday = first - (isoWeekday(first) - 1)
  const result: string[] = []
  for (let day = first; day <= last && result.length <= MAX_SERIES_LESSONS; day++) {
    if (!weekdays.includes(isoWeekday(day))) continue
    if (frequency === "BIWEEKLY" && Math.floor((day - firstMonday) / 7) % 2 !== 0) continue
    result.push(dateText(day))
  }
  return result
}

/** Default end date: four weeks after the first lesson, minus a day (e.g. 4 weekly Mondays). */
export function defaultRepeatUntil(start: string) {
  const first = dayNumber(start)
  return Number.isNaN(first) ? start : dateText(first + 27)
}

export function shortDate(date: string) {
  const [, month, day] = date.split("-").map(Number)
  const weekday = REPEAT_WEEKDAYS.find((item) => item.day === weekdayOf(date))?.label
  return `${month}월 ${day}일${weekday ? ` (${weekday})` : ""}`
}
