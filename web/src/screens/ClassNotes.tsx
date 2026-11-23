import { useEffect, useRef, useState, type ReactNode } from "react"
import type { ClassNoteCapture, ClassNoteLesson, ClassNoteWorksheet } from "../generated/contracts"
import { designContent as copy } from "../generated/design-content"
import { ApiError } from "../lib/api"
import type { Role } from "../models"
import { currentNoteMonth, noteCaptures, noteDateLabel, noteDay, noteImage, notesImageTypes, noteTarget, noteWorksheets, shiftNoteMonth, uploadNote, validateNoteFile } from "../lib/classNotes"
import { Icon } from "../components/ui"
import "../class-notes.css"

export type NotesTab = "worksheets" | "records"
const message = (error: unknown) => error instanceof Error ? error.message : "요청을 처리하지 못했어요. 다시 시도해 주세요."
export type NoteDraft = { file: Blob; requestId: string }
const draftOf = (file: Blob): NoteDraft => ({ file, requestId: crypto.randomUUID() })
const lessonLabel = (lesson: ClassNoteLesson) => `${lesson.title} · ${lesson.teacherName} 선생님`

function useObjectUrl(blob: Blob | undefined) {
  const [value, setValue] = useState<{ blob: Blob; url: string }>()
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setValue({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return value?.blob === blob ? value?.url : undefined
}

export function NoteDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog className="note-dialog" ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="note-dialog-title"><h2>{title}</h2><button className="note-round" aria-label="닫기" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></div>
    {children}
  </dialog>
}

export function NotePreview({ draft, label }: { draft: NoteDraft; label: string }) {
  const url = useObjectUrl(draft.file)
  return url && <img className="note-image" src={url} alt={label} />
}

function StoredNoteImage({ id, label }: { id: string; label: string }) {
  const [result, setResult] = useState<{ id: string; blob?: Blob; error?: string }>()
  const [retry, setRetry] = useState(0)
  const current = result?.id === id ? result : undefined
  const url = useObjectUrl(current?.blob)
  useEffect(() => {
    const request = new AbortController()
    setResult(undefined)
    void noteImage(id, request.signal).then(blob => setResult({ id, blob })).catch(error => {
      if (!request.signal.aborted) setResult({ id, error: message(error) })
    })
    return () => request.abort()
  }, [id, retry])
  return url ? <img className="note-image" src={url} alt={label} />
    : current?.error ? <p className="note-image-status" role="alert">{current.error} <button className="secondary" onClick={() => setRetry(value => value + 1)}>다시 시도</button></p>
    : <p className="note-image-status" role="status">이미지를 불러오는 중이에요.</p>
}

function ImagePicker({ label, onImage, disabled }: { label: string; onImage: (file: File) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return <>
    <button className="secondary" disabled={disabled} onClick={() => input.current?.click()}>{label}</button>
    <input ref={input} type="file" hidden accept={notesImageTypes} aria-label={label} onChange={event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ""
      if (file) onImage(file)
    }} />
  </>
}

/** Student worksheet submission: the current target lesson and the confirm-and-upload dialog. */
function useWorksheetSubmission(enabled: boolean, refreshKey: string, onSubmitted: () => void) {
  const [lesson, setLesson] = useState<ClassNoteLesson | null>(null)
  const [targetError, setTargetError] = useState("")
  const [loading, setLoading] = useState(enabled)
  const [open, setOpen] = useState(false)
  const [confirmed, setConfirmed] = useState<ClassNoteLesson | null>(null)
  const [draft, setDraft] = useState<NoteDraft>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const upload = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!enabled) return
    const request = new AbortController()
    setLoading(true); setTargetError("")
    void noteTarget(request.signal).then(result => setLesson(result.lesson)).catch(error => {
      if (!request.signal.aborted) { setLesson(null); setTargetError(message(error)) }
    }).finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => request.abort()
  }, [enabled, refreshKey, refresh])
  useEffect(() => () => upload.current?.abort(), [])
  const close = () => { setOpen(false); setConfirmed(null); setDraft(undefined); setError("") }
  const targetChanged = confirmed?.id !== lesson?.id
  async function submit() {
    if (!draft || !confirmed || targetChanged || upload.current) return
    const request = new AbortController()
    upload.current = request
    setBusy(true); setError("")
    try {
      await uploadNote("submitClassNoteWorksheet", confirmed.id, draft.file, draft.requestId, {}, request.signal)
      close(); onSubmitted()
    } catch (failure) {
      if (request.signal.aborted) return
      if (failure instanceof ApiError && failure.code === "NOTE_TARGET_CHANGED") {
        setConfirmed(null); setError(copy.notesTargetChanged); setRefresh(value => value + 1)
      } else setError(message(failure))
    } finally { upload.current = null; if (!request.signal.aborted) setBusy(false) }
  }
  const dialog = open && <NoteDialog title={copy.notesSubmit} onClose={close} busy={busy}>
    <div className="note-target">
      <span className="note-target-icon"><Icon name="file" size={20} /></span>
      <span className="note-target-text">
        <span>제출할 수업</span>
        <strong>{confirmed ? lessonLabel(confirmed) : loading ? "제출할 수업을 확인하고 있어요." : targetError || copy.notesTargetEmpty}</strong>
      </span>
    </div>
    {targetChanged && !loading && lesson && <button className="secondary" disabled={busy} onClick={() => { setConfirmed(lesson); setError(""); if (draft) setDraft(draftOf(draft.file)) }}>{lessonLabel(lesson)} 선택</button>}
    {draft ? <NotePreview draft={draft} label="제출할 학습지" /> : confirmed && <p className="note-drop-hint"><Icon name="camera" size={28} /><span>학습지 전체가 잘 보이는 JPEG·PNG 이미지를 골라 주세요. (최대 10MiB)</span></p>}
    {(error || targetChanged && confirmed) && <p role="alert">{error || copy.notesTargetChanged}</p>}
    <div className="note-actions">
      <ImagePicker label={draft ? "다른 이미지 선택" : copy.notesUpload} disabled={busy || !confirmed} onImage={file => {
        const invalid = validateNoteFile(file)
        setError(invalid)
        if (!invalid) setDraft(draftOf(file))
      }} />
      <button className="primary" disabled={!draft || !confirmed || targetChanged || loading || busy} onClick={() => void submit()}>{busy ? "제출 중…" : "제출하기"}</button>
    </div>
  </NoteDialog>
  return { lesson, loading, targetError, dialog, retry: () => setRefresh(value => value + 1), start: () => { setConfirmed(lesson); setOpen(true) } }
}

export function ClassNotesHome({ refreshKey, onOpen }: { refreshKey: string; onOpen: (tab: NotesTab) => void }) {
  const submission = useWorksheetSubmission(true, refreshKey, () => onOpen("worksheets"))
  const { lesson, loading, targetError } = submission
  return <section className="note-card note-home" aria-label={copy.notesTitle}>
    <h2><Icon name="file" size={20} /> {copy.notesTitle}</h2>
    <div className="note-home-group">
      <h3>{copy.notesSubmit}</h3>
      <p>{loading ? "제출할 수업을 확인하고 있어요." : lesson ? lessonLabel(lesson) : targetError || copy.notesTargetEmpty}</p>
      <div className="note-actions">
        <button className="primary" disabled={!lesson || loading} onClick={submission.start}>{copy.notesUpload}</button>
        <button className="secondary" onClick={() => onOpen("worksheets")}>{copy.notesArchive}</button>
        {targetError && <button className="secondary" onClick={submission.retry}>다시 시도</button>}
      </div>
    </div>
    <div className="note-home-group"><h3>{copy.notesRecords}</h3><button className="secondary" onClick={() => onOpen("records")}>{copy.notesRecordArchive}</button></div>
    {submission.dialog}
  </section>
}

function useNotesList<T>(load: (signal: AbortSignal) => Promise<T>, key: string) {
  const [data, setData] = useState<{ key: string; value?: T; error?: string }>()
  const [retry, setRetry] = useState(0)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    const request = new AbortController()
    void loader.current(request.signal).then(value => { if (!request.signal.aborted) setData({ key, value }) }).catch(error => {
      if (!request.signal.aborted) setData({ key, error: message(error) })
    })
    return () => request.abort()
  }, [key, retry])
  return { ...(data?.key === key ? data : undefined), reload: () => setRetry(value => value + 1) }
}

function ListStatus({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <div className="note-empty" role="alert"><p>{error}</p><button className="secondary" onClick={retry}>다시 시도</button></div>
    : <p className="note-empty" role="status">기록을 불러오는 중이에요.</p>
}

function Empty({ icon, children }: { icon: "file" | "camera"; children: ReactNode }) {
  return <div className="note-empty"><span className="note-empty-icon"><Icon name={icon} size={26} /></span><p>{children}</p></div>
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const id = key(item)
    const group = groups.get(id)
    if (group) group.push(item)
    else groups.set(id, [item])
  }
  return [...groups]
}

function LessonChips({ lessons, title, onChange }: { lessons: ClassNoteLesson[]; title: string; onChange: (value: string) => void }) {
  const titles = [...new Set(lessons.map(lesson => lesson.title))].sort((a, b) => a.localeCompare(b, "ko"))
  return <div className="note-chips" role="group" aria-label="수업명 필터">
    <button aria-pressed={!title} onClick={() => onChange("")}>전체</button>
    {titles.map(value => <button key={value} aria-pressed={value === title} onClick={() => onChange(value)}>{value}</button>)}
  </div>
}

export function ClassNotes({ role, tab, onTab }: { role: Role; tab: NotesTab; onTab: (tab: NotesTab) => void }) {
  const [submitted, setSubmitted] = useState(0)
  const submission = useWorksheetSubmission(role === "student", "notes", () => { onTab("worksheets"); setSubmitted(value => value + 1) })
  return <main className="page notes-page" aria-label={copy.notesTitle}>
    <div className="notes-toolbar">
      <div className="notes-segment" role="group" aria-label={copy.notesTitle}>
        <button aria-pressed={tab === "worksheets"} onClick={() => onTab("worksheets")}>{copy.notesWorksheet}</button>
        <button aria-pressed={tab === "records"} onClick={() => onTab("records")}>{copy.notesRecords}</button>
      </div>
      {role === "student" && tab === "worksheets" && <button className="primary notes-submit" onClick={submission.start}><Icon name="camera" size={20} />{copy.notesUploadPhoto}</button>}
    </div>
    {tab === "worksheets" ? <WorksheetArchive key={submitted} role={role} /> : <CaptureArchive role={role} />}
    {submission.dialog}
  </main>
}

function WorksheetArchive({ role }: { role: Role }) {
  const [month, setMonth] = useState(currentNoteMonth)
  const [title, setTitle] = useState("")
  const [openKey, setOpenKey] = useState<string>()
  const list = useNotesList(signal => noteWorksheets({ month }, signal), month)
  const groups = groupBy(list.value?.filter(row => !title || row.lesson.title === title) ?? [], row => `${noteDay(row.original.createdAt)}/${row.lesson.id}`)
  const opened = groups.find(([key]) => key === openKey)?.[1]
  const [year, number] = month.split("-")
  const teacher = role === "teacher"
  function changeMonth(delta: number) { setMonth(value => shiftNoteMonth(value, delta)); setTitle(""); setOpenKey(undefined) }
  return <>
    <LessonChips lessons={list.value?.map(row => row.lesson) ?? []} title={title} onChange={setTitle} />
    <div className="note-month">
      <button className="note-round" aria-label="이전 달" onClick={() => changeMonth(-1)}><Icon name="back" size={18} /></button>
      <strong>{year}년 {Number(number)}월 제출</strong>
      <button className="note-round" aria-label="다음 달" disabled={month >= currentNoteMonth()} onClick={() => changeMonth(1)}><Icon name="chevron" size={18} /></button>
    </div>
    {!list.value ? <ListStatus error={list.error} retry={list.reload} /> : !groups.length ? <Empty icon="file">{copy.notesWorksheetsEmpty}</Empty> : <div className="note-grid">
      {groups.map(([key, rows]) => <button key={key} className="note-card note-worksheet-card" onClick={() => setOpenKey(key)}>
        <span className="note-card-head">
          <strong>{noteDateLabel(rows[0].original.createdAt)}</strong>
          <span className="note-tag">{rows[0].lesson.title}</span>
          <span className="note-card-chevron"><Icon name="chevron" size={18} /></span>
        </span>
        <span className="note-tiles">
          <span className="note-tile">
            <span className="note-tile-label"><Icon name="file" size={18} />{teacher ? copy.notesStudentSubmitted : copy.notesSubmitted}</span>{" "}
            <strong>{rows.length}장</strong>
          </span>{" "}
          <span className="note-tile accent">
            <span className="note-tile-label"><Icon name="checkSquare" size={18} />{teacher ? copy.notesTeacherCorrected : copy.notesCorrected}</span>{" "}
            <strong>{rows.filter(row => row.correction).length}장</strong>
          </span>
        </span>
      </button>)}
    </div>}
    {opened && <NoteDialog title={`${opened[0].lesson.title} · ${noteDateLabel(opened[0].original.createdAt)}`} onClose={() => setOpenKey(undefined)}>
      {teacher ? <TeacherWorksheetPicker rows={opened} onSaved={list.reload} /> : <StudentWorksheetPicker rows={opened} />}
    </NoteDialog>}
  </>
}

function StudentWorksheetPicker({ rows }: { rows: ClassNoteWorksheet[] }) {
  const [id, setId] = useState(rows[0].original.id)
  const row = rows.find(item => item.original.id === id) ?? rows[0]
  return <>
    {rows.length > 1 && <div className="note-chips" role="group" aria-label="학습지 선택">
      {rows.map((item, index) => <button key={item.original.id} aria-pressed={item === row} onClick={() => setId(item.original.id)}>학습지 {index + 1}</button>)}
    </div>}
    <WorksheetImages row={row} />
  </>
}

/** Teacher view of one date and lesson: pick a student's sheet, then attach a correction. */
function TeacherWorksheetPicker({ rows, onSaved }: { rows: ClassNoteWorksheet[]; onSaved: () => void }) {
  const [id, setId] = useState(rows[0].original.id)
  const row = rows.find(item => item.original.id === id) ?? rows[0]
  const counts = new Map<string, number>()
  const labels = rows.map(item => {
    const count = (counts.get(item.studentName) ?? 0) + 1
    counts.set(item.studentName, count)
    return rows.filter(other => other.studentName === item.studentName).length > 1 ? `${item.studentName} ${count}` : item.studentName
  })
  return <>
    <div className="note-chips" role="group" aria-label="학생 학습지 선택">
      {rows.map((item, index) => <button key={item.original.id} aria-pressed={item === row} onClick={() => setId(item.original.id)}>
        <span className={`note-status-dot ${item.correction ? "done" : ""}`} aria-hidden />{labels[index]}
        <span className="sr-only"> · {item.correction ? "첨삭 완료" : "첨삭 대기"}</span>
      </button>)}
    </div>
    <WorksheetCorrection key={row.original.id} row={row} onSaved={onSaved} />
  </>
}

function WorksheetImages({ row, teacher = false }: { row: ClassNoteWorksheet; teacher?: boolean }) {
  const corrected = teacher ? copy.notesTeacherCorrected : copy.notesCorrected
  return <div className="note-image-grid">
    <section><h3><Icon name="file" size={18} />{copy.notesSubmitted}</h3><StoredNoteImage id={row.original.id} label={copy.notesSubmitted} /></section>
    <section className="accent"><h3><Icon name="checkSquare" size={18} />{corrected}</h3>
      {row.correction ? <StoredNoteImage id={row.correction.id} label={corrected} /> : <p className="note-image-status">{copy.notesCorrectionPending}</p>}
    </section>
  </div>
}

function WorksheetCorrection({ row, onSaved }: { row: ClassNoteWorksheet; onSaved: () => void }) {
  const [draft, setDraft] = useState<NoteDraft>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const upload = useRef<AbortController | null>(null)
  useEffect(() => () => upload.current?.abort(), [])
  async function save() {
    if (!draft || upload.current) return
    const request = new AbortController()
    upload.current = request
    setBusy(true); setError("")
    try {
      await uploadNote("submitClassNoteCorrection", row.original.id, draft.file, draft.requestId, {}, request.signal)
      setDraft(undefined); onSaved()
    } catch (failure) { if (!request.signal.aborted) setError(message(failure)) }
    finally { upload.current = null; if (!request.signal.aborted) setBusy(false) }
  }
  return <>
    <p className="note-dialog-meta">{row.studentName} · {noteDateLabel(row.original.createdAt)} · {row.correction ? "첨삭 완료" : "첨삭 대기"}</p>
    <WorksheetImages row={row} teacher />
    {!row.correction && <div className="note-correction">
      {draft && <NotePreview draft={draft} label="첨삭 이미지 미리보기" />}
      {error && <p role="alert">{error}</p>}
      <div className="note-actions">
        <ImagePicker label={draft ? "다른 이미지 선택" : copy.notesCorrection} disabled={busy} onImage={file => { const invalid = validateNoteFile(file); setError(invalid); if (!invalid) setDraft(draftOf(file)) }} />
        <button className="primary" disabled={!draft || busy} onClick={() => void save()}>{busy ? "저장 중…" : "첨삭 저장"}</button>
      </div>
    </div>}
  </>
}

function CaptureArchive({ role }: { role: Role }) {
  const [title, setTitle] = useState("")
  const [group, setGroup] = useState<ClassNoteCapture[]>()
  const [index, setIndex] = useState(0)
  const list = useNotesList(noteCaptures, "captures")
  const groups = groupBy(list.value?.filter(row => !title || row.lesson.title === title) ?? [], row => row.lesson.id)
  const sources = role === "teacher" ? ["self"] as const : ["self", "teacher"] as const
  return <>
    <LessonChips lessons={list.value?.map(row => row.lesson) ?? []} title={title} onChange={setTitle} />
    {!list.value ? <ListStatus error={list.error} retry={list.reload} /> : !groups.length ? <Empty icon="camera">{copy.notesCapturesEmpty}</Empty> : <div className="note-grid">
      {groups.map(([key, rows]) => <article key={key} className="note-card note-capture-card">
        <h3>{noteDateLabel(rows[0].lesson.startsAt)} · {rows[0].lesson.title}</h3>
        {sources.map(source => {
          const images = rows.filter(row => row.source === source)
          return <button key={source} className={`note-row ${source === "teacher" ? "accent" : ""}`} disabled={!images.length} onClick={() => { setIndex(0); setGroup(images) }}>
            <Icon name={source === "self" ? "camera" : "user"} size={20} />
            <span className="note-row-label">{source === "self" ? copy.notesOwnCapture : copy.notesTeacherCapture}</span>{" "}
            <strong>{images.length}장</strong>
            <Icon name="chevron" size={18} />
          </button>
        })}
      </article>)}
    </div>}
    {group && <NoteDialog title={`${group[0].source === "self" ? copy.notesOwnCapture : copy.notesTeacherCapture} · ${group[0].lesson.title}`} onClose={() => setGroup(undefined)}>
      <div className="note-month note-pager">
        <button className="note-round" aria-label="이전 화면" disabled={!index} onClick={() => setIndex(value => value - 1)}><Icon name="back" size={18} /></button>
        <span>{index + 1} / {group.length}</span>
        <button className="note-round" aria-label="다음 화면" disabled={index + 1 >= group.length} onClick={() => setIndex(value => value + 1)}><Icon name="chevron" size={18} /></button>
      </div>
      <StoredNoteImage id={group[index].image.id} label={`수업 화면 ${index + 1}`} />
    </NoteDialog>}
  </>
}

export function TeacherWorksheets({ lessonId }: { lessonId: string }) {
  const [expanded, setExpanded] = useState(false)
  return <section className="note-card note-teacher" aria-label={copy.notesTeacherList}>
    <div className="note-teacher-head">
      <h2><Icon name="file" size={20} />{copy.notesTeacherList}</h2>
      <button className="secondary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "목록 닫기" : "목록 보기"}</button>
    </div>
    {expanded && <TeacherWorksheetList lessonId={lessonId} />}
  </section>
}

function TeacherWorksheetList({ lessonId }: { lessonId: string }) {
  const list = useNotesList(signal => noteWorksheets({ lessonId }, signal), lessonId)
  const [selectedId, setSelectedId] = useState<string>()
  const selected = list.value?.find(row => row.original.id === selectedId)
  return <>
    {!list.value ? <ListStatus error={list.error} retry={list.reload} /> : !list.value.length ? <p className="note-empty">제출한 학생이 없어요.</p> : <div className="note-list">
      {list.value.map(row => <button key={row.original.id} className="note-row" onClick={() => setSelectedId(row.original.id)}>
        <Icon name="user" size={20} />
        <span className="note-row-label">{row.studentName}</span>{" "}
        <span className="note-row-meta">{noteDateLabel(row.original.createdAt)}</span>{" "}
        <span className={`note-status ${row.correction ? "done" : ""}`}>{row.correction ? "첨삭 완료" : "첨삭 대기"}</span>
        <Icon name="chevron" size={18} />
      </button>)}
    </div>}
    {selected && <NoteDialog title={`${selected.studentName} · ${copy.notesWorksheet}`} onClose={() => setSelectedId(undefined)}>
      <WorksheetCorrection key={selected.original.id} row={selected} onSaved={list.reload} />
    </NoteDialog>}
  </>
}
