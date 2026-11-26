import { z } from 'zod'
import { ApiError } from './errors'

/** One request may create at most this many lessons. */
export const MAX_SERIES_LESSONS = 100
const DAY = 24 * 60 * 60 * 1000
// Korea has no daylight saving time, so a fixed offset keeps the same wall-clock time every week.
const SEOUL_OFFSET = 9 * 60 * 60 * 1000

export const lessonRepeatInput = z.object({
  frequency: z.enum(['WEEKLY', 'BIWEEKLY']),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, '반복할 요일을 한 개 이상 선택해 주세요.').max(7)
    .refine(days => new Set(days).size === days.length, '중복된 요일이 있습니다.'),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '반복 종료일을 확인해 주세요.')
    .refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), '반복 종료일을 확인해 주세요.'),
})
export type LessonRepeatRule = z.infer<typeof lessonRepeatInput>

/** Days since 1970-01-01 of the Asia/Seoul calendar date containing `time`. */
const seoulDay = (time: number) => Math.floor((time + SEOUL_OFFSET) / DAY)
/** ISO weekday (1 = Monday … 7 = Sunday) of a Seoul day number; day 0 was a Thursday. */
const isoWeekday = (day: number) => ((day + 3) % 7 + 7) % 7 + 1

/**
 * Start/end instants from the first lesson date through `until` (inclusive, Asia/Seoul) on the chosen weekdays.
 * BIWEEKLY keeps the first lesson's Monday-based week and every second week after it.
 */
export function lessonOccurrences(startsAt: string, endsAt: string | null, rule: LessonRepeatRule) {
  const start = Date.parse(startsAt)
  const duration = endsAt === null ? null : Date.parse(endsAt) - start
  const first = seoulDay(start)
  const last = Math.floor(Date.parse(`${rule.until}T00:00:00Z`) / DAY)
  if (last < first) throw new ApiError('VALIDATION', '반복 종료일은 수업 날짜와 같거나 이후로 선택해 주세요.')
  const firstMonday = first - (isoWeekday(first) - 1)
  const weekdays = new Set(rule.weekdays)
  const result: { startsAt: Date; endsAt: Date | null }[] = []
  for (let day = first; day <= last; day++) {
    if (!weekdays.has(isoWeekday(day))) continue
    if (rule.frequency === 'BIWEEKLY' && Math.floor((day - firstMonday) / 7) % 2 !== 0) continue
    if (result.length === MAX_SERIES_LESSONS) throw new ApiError('VALIDATION', `반복 수업은 한 번에 최대 ${MAX_SERIES_LESSONS}회까지 예약할 수 있어요.`)
    const time = start + (day - first) * DAY
    result.push({ startsAt: new Date(time), endsAt: duration === null ? null : new Date(time + duration) })
  }
  if (!result.length) throw new ApiError('VALIDATION', '선택한 기간에 예약할 수업 날짜가 없어요.')
  return result
}
