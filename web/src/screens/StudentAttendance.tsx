import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { Avatar, Icon } from "../components/ui"
import type {
  StudentAttendanceInput, StudentAttendanceMonth, StudentAttendanceReason,
  StudentAttendanceRow, StudentAttendanceStatus, User,
} from "../generated/contracts"
import { designContent as copy } from "../generated/design-content"
import { api, ApiError, colorFor, koreaParts } from "../lib/api"
import "../student-attendance.css"

export const attendanceFeature = "classroom.attendance"
const statusLabels: Record<StudentAttendanceStatus, string> = {
  PRESENT: copy.attendancePresent, LATE: copy.attendanceLate, ABSENT: copy.attendanceAbsent,
}
const reasonLabels: Record<StudentAttendanceReason, string> = {
  DEVICE: copy.attendanceDevice, NETWORK: copy.attendanceNetwork, OTHER: copy.attendanceOther,
}
const statuses = Object.keys(statusLabels) as StudentAttendanceStatus[]
const reasons = Object.keys(reasonLabels) as StudentAttendanceReason[]
const day = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short",
})
const rangeLimit = { first: "2000-01", last: "9999-12" }

function shiftMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number)
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7)
}

function useAttendanceRequest<T>(load: (signal: AbortSignal) => Promise<T>, unauthorized: () => void) {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ load: typeof load; value?: T; error?: string }>()
  useEffect(() => {
    const request = new AbortController()
    setResult(undefined)
    load(request.signal).then(value => {
      if (!request.signal.aborted) setResult({ load, value })
    }).catch((error: unknown) => {
      if (request.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) unauthorized()
      setResult({ load, error: error instanceof Error ? error.message : copy.attendanceLoadError })
    })
    return () => request.abort()
  }, [load, retry, unauthorized])
  return {
    ...(result?.load === load ? result : undefined),
    retry: () => setRetry(value => value + 1),
    update: (value: T) => setResult({ load, value }),
  }
}

function LoadStatus({ error, loading, retry }: { error?: string; loading: string; retry: () => void }) {
  return <div className="attendance-message" role={error ? "alert" : "status"}>
    <p>{error || loading}</p>
    {error && <button type="button" className="secondary" onClick={retry}>{copy.attendanceRetry}</button>}
  </div>
}

export function AttendanceStudents({ unauthorized }: { unauthorized: () => void }) {
  const load = useCallback((signal: AbortSignal) => api<User[]>("/students", { signal }), [])
  const { value, error, retry } = useAttendanceRequest(load, unauthorized)
  return <main className="attendance-page attendance-roster">
    <h1>{copy.attendanceStudents}</h1>
    {!value ? <LoadStatus error={error} retry={retry} loading={copy.attendanceLoadingStudents} />
      : value.length === 0 ? <p className="attendance-message">{copy.attendanceEmptyStudents}</p>
      : <ul className="attendance-list">
        {value.map(student => <li key={student.id}>
          <Link className="attendance-student-link" to={`/students/${encodeURIComponent(student.id)}/attendance`}>
            <Avatar name={student.name} color={colorFor(student.id)} />
            <span>{student.name}</span>
            <Icon name="chevron" size={20} />
          </Link>
        </li>)}
      </ul>}
  </main>
}

export function StudentAttendance({ studentId, unauthorized }: { studentId: string; unauthorized: () => void }) {
  const [month, setMonth] = useState(() => koreaParts(new Date().toISOString()).dateISO.slice(0, 7))
  const [name, setName] = useState("")
  return <div className="attendance-screen">
    <header className="screen-appbar attendance-header">
      <div className="attendance-heading">
        <Link className="appbar-back" to="/students" aria-label={copy.attendanceStudents}><Icon name="back" size={24} /></Link>
        {name && <strong className="attendance-student-name">{name}</strong>}
      </div>
      <h1>{copy.attendanceTitle}</h1>
    </header>
    <AttendanceMonth studentId={studentId} month={month} onMonth={setMonth} onName={setName} unauthorized={unauthorized} />
  </div>
}

function AttendanceMonth({ studentId, month, onMonth, onName, unauthorized }: {
  studentId: string; month: string; onMonth: (value: string) => void; onName: (name: string) => void; unauthorized: () => void
}) {
  const path = `/students/${encodeURIComponent(studentId)}/attendance`
  const load = useCallback((signal: AbortSignal) => api<StudentAttendanceMonth>(`${path}?month=${encodeURIComponent(month)}`, { signal }), [path, month])
  const { value, error, retry, update } = useAttendanceRequest(load, unauthorized)
  const [editing, setEditing] = useState<StudentAttendanceRow>()
  const studentName = value?.student.name
  useEffect(() => { if (studentName) onName(studentName) }, [onName, studentName])
  const [year, number] = month.split("-")
  const summary = value?.summary

  return <main className="attendance-page">
    {summary && <dl className="attendance-summary">
      <div><dt>{copy.attendanceRate}</dt><dd>{summary.rate === null ? "—" : `${summary.rate}%`}</dd></div>
      <div data-status="PRESENT"><dt>{copy.attendancePresent}</dt><dd>{summary.present}</dd></div>
      <div data-status="LATE"><dt>{copy.attendanceLate}</dt><dd>{summary.late}</dd></div>
      <div data-status="ABSENT"><dt>{copy.attendanceAbsent}</dt><dd>{summary.absent}</dd></div>
    </dl>}
    <div className="attendance-month">
      <button type="button" aria-label={copy.attendancePreviousMonth} disabled={month === rangeLimit.first} onClick={() => onMonth(shiftMonth(month, -1))}><Icon name="back" size={18} /></button>
      <h2>{year}년 {Number(number)}월</h2>
      <button type="button" aria-label={copy.attendanceNextMonth} disabled={month === rangeLimit.last} onClick={() => onMonth(shiftMonth(month, 1))}><Icon name="chevron" size={18} /></button>
    </div>
    {!value ? <LoadStatus error={error} retry={retry} loading={copy.attendanceLoading} />
      : value.rows.length === 0 ? <p className="attendance-message">{copy.attendanceEmpty}</p>
      : <ul className="attendance-list attendance-rows">
        {value.rows.map(row => <li className="attendance-row" key={row.lessonId}>
          <div className="attendance-lesson">
            <time dateTime={row.startsAt}>{day.format(new Date(row.startsAt))}</time>
            <span>{row.lessonTitle}</span>
          </div>
          <p className="attendance-times">
            <span>{row.firstJoinedAt ? koreaParts(row.firstJoinedAt).time : "—"} {copy.attendanceJoined}</span>
            <span>{row.lastLeftAt ? koreaParts(row.lastLeftAt).time : "—"} {copy.attendanceLeft}</span>
          </p>
          <p className="attendance-duration" aria-label={copy.attendanceDuration}>{row.firstJoinedAt ? `${Math.round(row.durationSeconds / 60)}분` : "—"}</p>
          <span className="attendance-badge" data-status={row.status}>{statusLabels[row.status]}</span>
          <button type="button" className="attendance-edit-button" aria-label={`${row.lessonTitle} ${copy.attendanceEdit}`} onClick={() => setEditing(row)}>{copy.attendanceEditAction}</button>
        </li>)}
      </ul>}
    {editing && <AttendanceEdit row={editing} path={`${path}/${encodeURIComponent(editing.lessonId)}`} unauthorized={unauthorized}
      onCancel={() => setEditing(undefined)} onSave={report => { update(report); setEditing(undefined) }} />}
  </main>
}

function AttendanceEdit({ row, path, unauthorized, onCancel, onSave }: {
  row: StudentAttendanceRow; path: string; unauthorized: () => void; onCancel: () => void; onSave: (value: StudentAttendanceMonth) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController>(null)
  const [status, setStatus] = useState(row.status)
  const [reason, setReason] = useState(row.reason)
  const [memo, setMemo] = useState(row.memo ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useLayoutEffect(() => {
    const element = dialog.current
    const opener = document.activeElement
    element?.showModal()
    element?.querySelector<HTMLInputElement>("input:checked")?.focus()
    return () => {
      request.current?.abort()
      element?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError("")
    const body: StudentAttendanceInput = { status, reason, memo }
    try {
      const value = await api<StudentAttendanceMonth>(path, {
        method: "PUT", body: JSON.stringify(body), signal: controller.signal,
      })
      if (!controller.signal.aborted) onSave(value)
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) unauthorized()
      setError(error instanceof Error ? error.message : copy.attendanceSaveError)
    } finally {
      if (!controller.signal.aborted) {
        request.current = null
        setBusy(false)
      }
    }
  }

  return <dialog className="attendance-dialog" ref={dialog} aria-labelledby="attendance-edit-title" onCancel={event => {
    event.preventDefault()
    if (!request.current) onCancel()
  }}>
    <form onSubmit={save} aria-busy={busy}>
      <header><h2 id="attendance-edit-title">{copy.attendanceEdit}</h2>
        <p>{day.format(new Date(row.startsAt))} · {row.lessonTitle}</p>
      </header>
      <fieldset className="attendance-status-field" disabled={busy}>
        <legend>{copy.attendanceTitle}</legend>
        <div>{statuses.map(item => <label key={item}>
          <input type="radio" name="attendance-status" value={item} checked={status === item} onChange={() => setStatus(item)} />
          <span>{statusLabels[item]}</span>
        </label>)}</div>
      </fieldset>
      <fieldset className="attendance-reason-field" disabled={busy}>
        <legend>{copy.attendanceReason}</legend>
        <div>{reasons.map(item => <button type="button" key={item} aria-pressed={reason === item} onClick={() => setReason(reason === item ? null : item)}>
          {reasonLabels[item]}
        </button>)}</div>
      </fieldset>
      <label className="attendance-memo">{copy.attendanceMemo}
        <textarea maxLength={500} rows={2} value={memo} disabled={busy} onChange={event => setMemo(event.target.value)} />
      </label>
      {error && <p className="attendance-save-error" role="alert">{error}</p>}
      <footer>
        <button className="secondary" type="button" disabled={busy} onClick={onCancel}>{copy.attendanceCancel}</button>
        <button className="primary" type="submit" disabled={busy}>{busy ? copy.attendanceSaving : copy.attendanceSave}</button>
      </footer>
    </form>
  </dialog>
}
