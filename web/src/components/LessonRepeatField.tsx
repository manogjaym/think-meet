import { designContent } from "../generated/design-content"
import { REPEAT_WEEKDAYS, shortDate, type LessonRepeatMode } from "../lib/lessonRepeat"

const MODES: { value: LessonRepeatMode; label: string }[] = [
  { value: "NONE", label: designContent.lessonRepeatNone },
  { value: "WEEKLY", label: designContent.lessonRepeatWeekly },
  { value: "BIWEEKLY", label: designContent.lessonRepeatBiweekly },
]

/** classroom.repeat-schedule: repeat options shown under the lesson date and time when booking. */
export function LessonRepeatField({
  mode,
  weekdays,
  until,
  minUntil,
  dates,
  error,
  disabled,
  onMode,
  onWeekdays,
  onUntil,
}: {
  mode: LessonRepeatMode
  weekdays: number[]
  until: string
  minUntil: string
  /** Lesson dates for the current rule (YYYY-MM-DD). */
  dates: string[]
  error?: string
  disabled?: boolean
  onMode: (mode: LessonRepeatMode) => void
  onWeekdays: (weekdays: number[]) => void
  onUntil: (until: string) => void
}) {
  const repeating = mode !== "NONE"
  return (
    <div className="field lesson-repeat" role="group" aria-labelledby="lesson-repeat-label">
      <span id="lesson-repeat-label">{designContent.lessonRepeatLabel}</span>
      <div className="lesson-repeat-modes" role="radiogroup" aria-labelledby="lesson-repeat-label">
        {MODES.map((option) => (
          <button
            type="button"
            role="radio"
            key={option.value}
            aria-checked={mode === option.value}
            disabled={disabled}
            onClick={() => onMode(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {repeating && (
        <>
          <div className="lesson-repeat-weekdays" role="group" aria-label={designContent.lessonRepeatWeekdays}>
            {REPEAT_WEEKDAYS.map(({ day, label }) => {
              const selected = weekdays.includes(day)
              return (
                <button
                  type="button"
                  key={day}
                  aria-pressed={selected}
                  aria-label={`${label}요일`}
                  disabled={disabled}
                  onClick={() =>
                    onWeekdays(selected ? weekdays.filter((item) => item !== day) : [...weekdays, day].sort())
                  }
                >
                  {label}
                </button>
              )
            })}
          </div>
          <label className="lesson-repeat-until">
            <span>{designContent.lessonRepeatUntil}</span>
            <input
              type="date"
              value={until}
              min={minUntil}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              onChange={(event) => onUntil(event.target.value)}
            />
          </label>
          {!error && dates.length > 0 && (
            <p className="lesson-repeat-summary" role="status">
              {designContent.lessonRepeatSummary
                .replace("{start}", shortDate(dates[0]))
                .replace("{until}", shortDate(dates[dates.length - 1]))
                .replace("{count}", String(dates.length))}
            </p>
          )}
        </>
      )}
      {error && <em role="alert">{error}</em>}
    </div>
  )
}
