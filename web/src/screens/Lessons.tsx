import { TeacherWorksheets } from "./ClassNotes"
import { useEffect, useState } from "react"
import type { LessonInput, TeacherSubject } from "../generated/contracts"
import { designContent } from "../generated/design-content"
import { useFeature } from "../lib/useFeature"
import {
  api,
  colorFor,
  displayLesson,
  joinLink,
  type ApiLesson,
  type LessonAccessMode,
  type User,
} from "../lib/api"
import type { Role, Screen } from "../models"
import type { Lesson } from "./Home"
import { Avatar, Badge, Confirm, Icon } from "../components/ui"

function dateInputValue(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  }).formatToParts(date)
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value || ""
  return `${part("year")}-${part("month")}-${part("day")}`
}

function formatTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number)
  return `${
    hours >= 12 ? "오후" : "오전"
  } ${hours % 12 || 12}:${String(minutes).padStart(2, "0")}`
}

export function Detail({
  role,
  setScreen,
  lesson,
  onCancel,
  onEdit,
  notesEnabled,
}: {
  role: Role
  notesEnabled?: boolean
  setScreen: (s: Screen) => void
  lesson: Lesson
  onCancel?: (lesson: Lesson) => Promise<void>
  onEdit?: (lesson: Lesson) => void
}) {
  const subjectsEnabled = useFeature("classroom.subjects")
  const [cancel, setCancel] = useState(false)
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  )
  const details = lesson
  const isLive = lesson.state === "진행 중"
  const isUpcoming = lesson.state === "예정"
  const isOpen = lesson.accessMode === "OPEN"
  const canJoin = isLive || isUpcoming
  const participants = lesson.students.map((student) => ({
    ...student,
    color: colorFor(student.id),
    status: lesson.participants?.some((p) => p.userId === student.id)
      ? "참여 중"
      : "아직 입장하지 않음",
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [day, start] = lesson.date.split(", ")
  const time =
    details.startTime && details.endTime
      ? `${formatTime(details.startTime)} – ${formatTime(details.endTime)} · ${lesson.duration}`
      : `${start || "시간 미정"} · ${lesson.duration}`
  return (
    <main className="page detail-page">
      <div className="detail-grid">
        <section className="detail-main">
          <div className="detail-title">
            <div className="lesson-badges">
              <Badge tone={isLive ? "live" : isUpcoming ? "blue" : "muted"}>
                {lesson.state}
              </Badge>
              {isOpen && (
                <span className="lesson-access-badge">
                  <Icon name="globe" size={14} />
                  공개 수업
                </span>
              )}
            </div>
            <h1>{lesson.title}</h1>
            <p>
              {details.description ||
                `${lesson.teacher.name} 선생님과 함께하는 화상 수업`}
            </p>
          </div>
          <div className="info-grid">
            <Info icon="calendar" label="날짜" value={day} />
            <Info icon="clock" label="수업 시간" value={time} />
            <Info
              icon="users"
              label="선생님"
              value={`${lesson.teacher.name} 선생님`}
            />
            <Info
              icon={isOpen ? "globe" : "lock"}
              label="참여 방식"
              value={isOpen ? "누구나 참여 가능" : "선택한 학생만 참여"}
            />
            {subjectsEnabled && lesson.subject && (
              <Info icon="file" label={designContent.lessonSubjectLabel} value={lesson.subject.name} />
            )}
          </div>
          {isOpen && (
            <div className="detail-access-note">
              <Icon name="globe" size={20} />
              <div>
                <strong>함께하고 싶은 누구나 참여할 수 있어요</strong>
                <p>
                  {canJoin
                    ? "로그인 후 수업 목록이나 참여 링크로 입장할 수 있어요."
                    : "누구나 참여할 수 있도록 열린 공개 수업이에요."}
                </p>
              </div>
            </div>
          )}
          <div className="student-block">
            <div className="section-title">
              <h2>{isOpen ? "참여자" : canJoin ? "초대 학생" : "참여 학생"}</h2>
              <span>{participants.length}명</span>
            </div>
            {isOpen && participants.length === 0 && (
              <div className="lesson-participants-empty">
                <Icon name="users" size={24} />
                <p>
                  {canJoin
                    ? "아직 참여한 사람이 없어요."
                    : "참여 기록이 없어요."}
                </p>
                {canJoin && (
                  <span>참여 링크를 공유해 함께할 사람을 만나 보세요.</span>
                )}
              </div>
            )}
            {participants.map((student) => (
              <div className="student-row" key={student.id}>
                <Avatar name={student.name} color={student.color} />
                <div>
                  <strong>{student.name}</strong>
                  <span>
                    {isOpen
                      ? student.role === "teacher"
                        ? "선생님"
                        : "학생"
                      : "초등 5학년"}
                  </span>
                </div>
                <Badge
                  tone={
                    isLive && student.status === "참여 중" ? "live" : "muted"
                  }
                >
                  {isLive
                    ? student.status
                    : isUpcoming
                      ? isOpen
                        ? "입장 대기"
                        : "초대됨"
                      : lesson.state === "취소"
                        ? "취소"
                        : "수업 종료"}
                </Badge>
              </div>
            ))}
          </div>
        </section>
        <aside className="detail-aside">
          <p className="eyebrow">{canJoin ? "수업 참여" : "수업 기록"}</p>
          <h2>
            {isLive
              ? "지금 수업이 진행 중이에요"
              : isUpcoming
                ? "수업을 미리 준비해 보세요"
                : lesson.state === "취소"
                  ? "취소된 수업이에요"
                  : "종료된 수업이에요"}
          </h2>
          <p>
            {canJoin
              ? "입장 전에 카메라와 마이크를 확인할 수 있어요."
              : "내 수업에서 다른 일정과 지난 수업을 확인할 수 있어요."}
          </p>
          {canJoin ? (
            <button
              className="primary full"
              onClick={() => setScreen("prejoin")}
            >
              <Icon name="video" />
              {isUpcoming ? "입장 준비" : "수업 참여"}
            </button>
          ) : (
            <button className="primary full" onClick={() => setScreen("home")}>
              홈으로 돌아가기
            </button>
          )}
          {role === "teacher" && isUpcoming && (
            <>
              <button
                className="secondary full"
                onClick={() => (onEdit ? onEdit(lesson) : setScreen("form"))}
              >
                일정 수정
              </button>
              <button
                className="danger-text full"
                onClick={() => setCancel(true)}
              >
                예정 수업 취소
              </button>
            </>
          )}
          {canJoin && (
            <>
              <div className="divider" />
              <button
                className="link-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(joinLink(lesson))
                    setCopyState("copied")
                  } catch {
                    setCopyState("failed")
                  }
                }}
              >
                <Icon name={copyState === "copied" ? "check" : "copy"} />
                {copyState === "copied"
                  ? "참여 링크 복사 완료"
                  : "참여 링크 복사"}
              </button>
              {isOpen && (
                <p className="detail-link-note">
                  로그인한 누구나 이 링크로 참여할 수 있어요.
                </p>
              )}
              {copyState === "failed" && (
                <p role="status">복사하지 못했어요. {joinLink(lesson)}</p>
              )}
            </>
          )}
        </aside>
      </div>
      {notesEnabled && role === "teacher" && <TeacherWorksheets key={lesson.id} lessonId={lesson.id} />}
      {error && (
        <p className="service-error" role="alert">
          {error}
        </p>
      )}
      {cancel && (
        <Confirm
          title="이 수업을 취소할까요?"
          copy="취소한 수업은 예정된 수업에서 더 이상 참여할 수 없습니다."
          cancel={() => setCancel(false)}
          confirm={async () => {
            if (busy) return
            setBusy(true)
            setError("")
            try {
              await onCancel?.(lesson)
              setCancel(false)
              setScreen("home")
            } catch (e) {
              setError(e instanceof Error ? e.message : "취소하지 못했어요.")
              setCancel(false)
            } finally {
              setBusy(false)
            }
          }}
          confirmText="수업 취소"
        />
      )}
    </main>
  )
}

function Info({
  icon,
  label,
  value,
}: {
  icon: string
  label: string
  value: string
}) {
  return (
    <div className="info">
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

export function Form({
  setScreen,
  onCreated,
  lesson,
  students,
}: {
  setScreen: (s: Screen) => void
  onCreated?: (lesson: Lesson) => void
  lesson?: Lesson
  students: User[]
}) {
  const details = lesson
  const subjectsEnabled = useFeature("classroom.subjects")
  const [subjects, setSubjects] = useState<TeacherSubject[] | null>(null)
  const [subjectsFailed, setSubjectsFailed] = useState(false)
  const [subjectRetry, setSubjectRetry] = useState(0)
  const [subjectChange, setSubjectChange] = useState<string | null>()
  const savedSubjectId = lesson?.subject?.id ?? null
  const selectedSubjectId = subjectChange === undefined ? savedSubjectId : subjectChange
  const subjectsMessage = subjectsFailed
    ? designContent.lessonSubjectsError
    : subjects === null
      ? designContent.lessonSubjectsLoading
      : subjects.length === 0 ? designContent.lessonSubjectsEmpty : null
  useEffect(() => {
    if (!subjectsEnabled) return
    const request = new AbortController()
    setSubjects(null)
    setSubjectsFailed(false)
    void api<TeacherSubject[]>("/subjects", { signal: request.signal }).then(
      (rows) => { if (!request.signal.aborted) setSubjects(rows) },
      () => { if (!request.signal.aborted) setSubjectsFailed(true) },
    )
    return () => request.abort()
  }, [subjectsEnabled, subjectRetry])
  const [title, setTitle] = useState(lesson?.title || "")
  const [description, setDescription] = useState(details?.description || "")
  const [date, setDate] = useState(
    details?.dateISO ||
      (() => {
        const dateMatch = lesson?.date.match(/(\d+)월\s*(\d+)일/)
        if (dateMatch)
          return `${dateInputValue(new Date()).slice(0, 4)}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`
        return dateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000))
      })(),
  )
  const [startTime, setStartTime] = useState(
    details?.startTime ||
      (() => {
        const match = lesson?.date.match(/(오전|오후)\s*(\d+):(\d+)/)
        if (!match) return "16:00"
        const hour = (Number(match[2]) % 12) + (match[1] === "오후" ? 12 : 0)
        return `${String(hour).padStart(2, "0")}:${match[3]}`
      })(),
  )
  const [endTime, setEndTime] = useState(
    details?.endTime ||
      (() => {
        const [hour, minute] = startTime.split(":").map(Number)
        const total =
          hour * 60 + minute + Number(lesson?.duration.replace(/\D/g, "") || 50)
        return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
      })(),
  )
  const [noScheduledEnd, setNoScheduledEnd] = useState(lesson?.endsAt === null)
  const [accessMode, setAccessMode] = useState<LessonAccessMode>(
    lesson?.accessMode || "INVITE_ONLY",
  )
  const isOpen = accessMode === "OPEN"
  const [selected, setSelected] = useState<string[]>(
    lesson?.accessMode === "OPEN"
      ? []
      : lesson?.students.map((student) => student.id) || [],
  )
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const toggle = (name: string) =>
    setSelected((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    )
  const results = students.filter((student) =>
    student.name.includes(search.trim()),
  )
  const save = async () => {
    if (saving) return
    const nextErrors: Record<string, string> = {}
    if (!title.trim()) nextErrors.title = "학습 제목을 입력해 주세요."
    if (!date) nextErrors.date = "날짜를 선택해 주세요."
    else if (date < dateInputValue(new Date()))
      nextErrors.date = "오늘 이후의 날짜를 선택해 주세요."
    if (!startTime) nextErrors.start = "시작 시간을 선택해 주세요."
    else if (
      date &&
      new Date(`${date}T${startTime}:00+09:00`).getTime() < Date.now()
    )
      nextErrors.start = "현재 시간 이후의 시작 시간을 선택해 주세요."
    if (!noScheduledEnd && !endTime)
      nextErrors.end = "종료 시간을 선택해 주세요."
    else if (!noScheduledEnd && startTime && endTime <= startTime)
      nextErrors.end = "종료 시간은 시작 시간보다 늦어야 해요."
    if (!isOpen && !selected.length)
      nextErrors.students = "학생을 한 명 이상 선택해 주세요."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setSaving(true)
    try {
      const result = await api<ApiLesson>(
        lesson ? `/lessons/${lesson.id}` : "/lessons",
        {
          method: lesson ? "PATCH" : "POST",
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            startsAt: new Date(`${date}T${startTime}:00+09:00`).toISOString(),
            endsAt: noScheduledEnd
              ? null
              : new Date(`${date}T${endTime}:00+09:00`).toISOString(),
            accessMode,
            studentIds: isOpen ? [] : selected,
            ...(subjectsEnabled && subjects !== null && subjectChange !== undefined ? { subjectId: subjectChange } : {}),
          } satisfies LessonInput),
        },
      )
      onCreated?.(displayLesson(result))
    } catch (e) {
      setErrors({
        server: e instanceof Error ? e.message : "일정을 저장하지 못했어요.",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="page form-page">
      <div className="form-heading">
        <div>
          <p className="eyebrow">선생님 전용</p>
          <h1>{lesson ? "수업 일정 수정" : "새 수업 예약"}</h1>
          <p>함께 배울 내용과 수업 참여 방식을 정해 주세요.</p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        noValidate
      >
        <div className="form-grid">
          <section className="form-card">
            <h2>수업 정보</h2>
            <label className="field">
              <span>
                학습 제목 <b aria-hidden="true">*</b>
              </span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="예: 분수의 덧셈과 뺄셈"
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? "title-error" : undefined}
                required
              />
              {errors.title && <em id="title-error">{errors.title}</em>}
            </label>
            {subjectsEnabled && (
              <div className="field min-w-0">
                <label htmlFor="lesson-subject">{designContent.lessonSubjectOptional}</label>
                <select
                  id="lesson-subject"
                  value={selectedSubjectId ?? ""}
                  disabled={saving || subjects === null || (subjects.length === 0 && selectedSubjectId === null)}
                  aria-describedby={subjectsMessage ? "lesson-subject-status" : undefined}
                  onChange={(event) => {
                    const next = event.target.value || null
                    setSubjectChange(next === savedSubjectId ? undefined : next)
                  }}
                >
                  <option value="">{designContent.lessonSubjectNone}</option>
                  {lesson?.subject && !subjects?.some(({ id }) => id === lesson.subject?.id) && (
                    <option value={lesson.subject.id}>{lesson.subject.name}</option>
                  )}
                  {subjects?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
                {subjectsMessage && <p id="lesson-subject-status" role="status" className="text-[var(--muted)]">{subjectsMessage}</p>}
                {subjectsFailed && (
                  <button type="button" className="link-button" onClick={() => setSubjectRetry((attempt) => attempt + 1)}>
                    {designContent.lessonSubjectsRetry}
                  </button>
                )}
              </div>
            )}
            <label className="field">
              <span>학습 내용</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="함께 배울 내용을 간단히 적어 주세요."
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>
                  날짜 <b aria-hidden="true">*</b>
                </span>
                <input
                  type="date"
                  value={date}
                  min={dateInputValue(new Date())}
                  onChange={(event) => setDate(event.target.value)}
                  aria-invalid={Boolean(errors.date)}
                  required
                />
                {errors.date && <em>{errors.date}</em>}
              </label>
              <label className="field">
                <span>
                  시작 시간 <b aria-hidden="true">*</b>
                </span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  aria-invalid={Boolean(errors.start)}
                  required
                />
                {errors.start && <em>{errors.start}</em>}
              </label>
              <label className="field">
                <span>
                  종료 시간 <b aria-hidden="true">*</b>
                </span>
                <input
                  type="time"
                  value={endTime}
                  aria-label="종료 시간"
                  onChange={(event) => setEndTime(event.target.value)}
                  aria-invalid={Boolean(errors.end)}
                  disabled={noScheduledEnd}
                  required={!noScheduledEnd}
                />
                {errors.end && <em>{errors.end}</em>}
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={noScheduledEnd}
                onChange={(event) => {
                  setNoScheduledEnd(event.target.checked)
                  setErrors((current) => {
                    const next = { ...current }
                    delete next.end
                    return next
                  })
                }}
              />
              <span>종료 시간 없음</span>
            </label>
            {noScheduledEnd && (
              <p className="mt-2 text-sm text-[var(--muted)]">
                선생님이 수업 종료를 누를 때까지 계속 참여할 수 있어요.
              </p>
            )}
            {Object.keys(errors).length > 0 && (
              <div className="inline-error" role="alert">
                <Icon name="alert" />
                {errors.server || "입력한 내용을 확인한 뒤 다시 시도해 주세요."}
              </div>
            )}
          </section>
          <section className="form-card students-select">
            <div className="participation-heading">
              <h2>참여 설정</h2>
              <p>수업에 참여할 수 있는 대상을 정해 주세요.</p>
            </div>
            <fieldset className="access-options">
              <legend className="sr-only">수업 참여 방식</legend>
              {([
                {
                  value: "INVITE_ONLY",
                  icon: "lock",
                  title: "선택한 학생만",
                  copy: "초대한 학생끼리 집중하는 수업",
                },
                {
                  value: "OPEN",
                  icon: "globe",
                  title: "누구나 참여",
                  copy: "초대 없이 함께할 수 있는 공개 수업",
                },
              ] as const).map((option) => (
                <label
                  className={`access-option ${
                    accessMode === option.value ? "is-selected" : ""
                  }`}
                  key={option.value}
                >
                  <input
                    className="access-option-input"
                    type="radio"
                    name="accessMode"
                    value={option.value}
                    checked={accessMode === option.value}
                    aria-label={option.title}
                    onChange={() => {
                      setAccessMode(option.value)
                      setErrors((current) => {
                        const next = { ...current }
                        delete next.students
                        return next
                      })
                    }}
                  />
                  <span className="access-option-top">
                    <span className="access-option-icon">
                      <Icon name={option.icon} size={20} />
                    </span>
                    <span className="access-option-check">
                      {accessMode === option.value && (
                        <Icon name="check" size={12} />
                      )}
                    </span>
                  </span>
                  <strong>{option.title}</strong>
                  <span className="access-option-copy">{option.copy}</span>
                </label>
              ))}
            </fieldset>
            {lesson && accessMode !== lesson.accessMode && (
              <p className="access-change-note">
                <Icon name="alert" size={16} />
                {isOpen
                  ? "저장하면 초대받지 않은 사용자도 참여할 수 있어요."
                  : "저장하면 아래에서 선택한 학생만 참여할 수 있어요."}
              </p>
            )}
            {isOpen ? (
              <p className="open-access-login">
                로그인한 사용자만 참여할 수 있어요.
              </p>
            ) : (
              <div className="invite-access-panel">
                <div className="section-title">
                  <div>
                    <h3>초대할 학생</h3>
                    <p>선택한 학생만 이 수업에 참여할 수 있어요.</p>
                  </div>
                  <Badge tone="blue">{selected.length}명 선택</Badge>
                </div>
                <label className="search compact">
                  <Icon name="search" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="학생 이름 검색"
                    aria-label="학생 이름 검색"
                  />
                </label>
                <div className="selected-chips">
                  {selected.map((id) => (
                    <button
                      type="button"
                      key={id}
                      onClick={() => toggle(id)}
                      aria-label={`${students.find((student) => student.id === id)?.name || "학생"} 선택 해제`}
                    >
                      {students.find((student) => student.id === id)?.name ||
                        "학생"}
                      <Icon name="close" size={14} />
                    </button>
                  ))}
                </div>
                <div className="student-options">
                  {results.map((student) => (
                    <button
                      type="button"
                      className={
                        selected.includes(student.id) ? "selected" : ""
                      }
                      onClick={() => toggle(student.id)}
                      key={student.id}
                      aria-pressed={selected.includes(student.id)}
                    >
                      <Avatar
                        name={student.name}
                        color={colorFor(student.id)}
                      />
                      <span>
                        <strong>{student.name}</strong>
                        <small>초등 5학년</small>
                      </span>
                      <i>
                        {selected.includes(student.id) && (
                          <Icon name="check" size={16} />
                        )}
                      </i>
                    </button>
                  ))}
                </div>
                {results.length === 0 && (
                  <p className="field" role="status">
                    검색된 학생이 없습니다.
                  </p>
                )}
                {errors.students && (
                  <p className="field-error" role="alert">
                    {errors.students}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
        <div className="form-actions">
          <p className="form-save-summary">
            <Icon name={isOpen ? "globe" : "lock"} size={16} />
            {isOpen
              ? "누구나 참여할 수 있는 공개 수업"
              : selected.length
                ? `선택한 학생 ${selected.length}명만 참여`
                : "참여할 학생을 선택해 주세요"}
          </p>
          <div>
            <button
              type="button"
              className="secondary"
              onClick={() => setScreen("home")}
            >
              취소
            </button>
            <button type="submit" disabled={saving} className="primary">
              {saving ? "저장 중" : lesson ? "변경사항 저장" : "수업 예약"}
            </button>
          </div>
        </div>
      </form>
    </main>
  )
}

export function Created({
  setScreen,
  lesson,
}: {
  setScreen: (s: Screen) => void
  lesson: Lesson
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  )
  return (
    <main className="center-page">
      <div className="success-card">
        <div className="success-check">
          <Icon name="check" size={32} />
        </div>
        <p className="eyebrow">예약 완료</p>
        <h1>수업 일정이 저장되었어요</h1>
        <p>
          {lesson.accessMode === "OPEN"
            ? "함께 배우고 싶은 누구나 참여할 수 있어요."
            : `${lesson.people} 학생을 수업에 초대했어요.`}
        </p>
        <div className="created-summary">
          <Badge tone="blue">예정</Badge>
          <strong>{lesson.title}</strong>
          <span>
            {lesson.date} · {lesson.duration}
          </span>
          <span className="created-access-label">
            <Icon
              name={lesson.accessMode === "OPEN" ? "globe" : "lock"}
              size={15}
            />
            {lesson.accessMode === "OPEN"
              ? "공개 수업 · 누구나 참여 가능"
              : "선택한 학생만 참여"}
          </span>
        </div>
        <div className="copy-box">
          <div>
            <small>수업 참여 링크</small>
            <strong className="service-copy-link">{joinLink(lesson)}</strong>
          </div>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(joinLink(lesson))
                setCopyState("copied")
              } catch {
                setCopyState("failed")
              }
            }}
          >
            <Icon name={copyState === "copied" ? "check" : "copy"} />
            {copyState === "copied" ? "복사 완료" : "복사"}
          </button>
        </div>
        {copyState !== "idle" && (
          <div className="toast-inline" role="status">
            <Icon name={copyState === "copied" ? "check" : "alert"} />
            {copyState === "copied"
              ? "참여 링크를 복사했어요."
              : "링크를 복사하지 못했어요. 다시 시도해 주세요."}
          </div>
        )}
        <button className="primary full" onClick={() => setScreen("detail")}>
          일정 보기
        </button>
        <button className="ghost full" onClick={() => setScreen("home")}>
          홈으로 돌아가기
        </button>
      </div>
    </main>
  )
}
