import { useEffect, useRef, useState, type ReactNode } from "react"
import type { ClassNoteCapture, ClassNoteLesson, ClassNoteWorksheet } from "../generated/contracts"
import { designContent as copy } from "../generated/design-content"
import { ApiError } from "../lib/api"
import { currentNoteMonth, noteCaptures, noteDateLabel, noteDay, noteImage, notesImageTypes, noteTarget, noteWorksheets, shiftNoteMonth, uploadNote, validateNoteFile } from "../lib/classNotes"
import { Icon } from "../components/ui"
import "../class-notes.css"

export type NotesTab = "worksheets" | "records"
const message = (error: unknown) => error instanceof Error ? error.message : "요청을 처리하지 못했어요. 다시 시도해 주세요."
export type NoteDraft = { file: Blob; requestId: string }
const draftOf = (file: Blob): NoteDraft => ({ file, requestId: crypto.randomUUID() })

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
    <div className="note-dialog-title"><h2>{title}</h2><button className="secondary" aria-label="닫기" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></div>
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
  return url ? <img className="note-image" src={url} alt={label} /> : current?.error ? <p role="alert">{current.error} <button className="secondary" onClick={() => setRetry(value => value + 1)}>다시 시도</button></p> : <p role="status">이미지를 불러오는 중이에요.</p>
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

export function ClassNotesHome({ refreshKey, onOpen }: { refreshKey: string; onOpen: (tab: NotesTab) => void }) {
  const [lesson, setLesson] = useState<ClassNoteLesson | null>(null)
  const [targetError, setTargetError] = useState("")
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [confirmed, setConfirmed] = useState<ClassNoteLesson | null>(null)
  const [draft, setDraft] = useState<NoteDraft>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const upload = useRef<AbortController | null>(null)
  useEffect(() => {
    const request = new AbortController()
    setLoading(true); setTargetError("")
    void noteTarget(request.signal).then(result => setLesson(result.lesson)).catch(error => {
      if (!request.signal.aborted) { setLesson(null); setTargetError(message(error)) }
    }).finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => request.abort()
  }, [refreshKey, refresh])
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
      close(); onOpen("worksheets")
    } catch (failure) {
      if (request.signal.aborted) return
      if (failure instanceof ApiError && failure.code === "NOTE_TARGET_CHANGED") {
        setConfirmed(null); setError(copy.notesTargetChanged); setRefresh(value => value + 1)
      } else setError(message(failure))
    } finally { upload.current = null; if (!request.signal.aborted) setBusy(false) }
  }
  return <section className="note-card note-home" aria-label={copy.notesTitle}>
    <h2><Icon name="file" size={20} /> {copy.notesTitle}</h2>
    <div className="note-home-group">
      <h3>{copy.notesSubmit}</h3>
      <p>{loading ? "제출할 수업을 확인하고 있어요." : lesson ? `${lesson.title} · ${lesson.teacherName} 선생님` : targetError || copy.notesTargetEmpty}</p>
      <div className="note-actions">
        <button className="primary" disabled={!lesson || loading} onClick={() => { setConfirmed(lesson); setOpen(true) }}>{copy.notesUpload}</button>
        <button className="secondary" onClick={() => onOpen("worksheets")}>{copy.notesArchive}</button>
        {targetError && <button className="secondary" onClick={() => setRefresh(value => value + 1)}>다시 시도</button>}
      </div>
    </div>
    <div className="note-home-group"><h3>{copy.notesRecords}</h3><button className="secondary" onClick={() => onOpen("records")}>{copy.notesRecordArchive}</button></div>
    {open && <NoteDialog title={copy.notesSubmit} onClose={close} busy={busy}>
      <p>{confirmed ? `${confirmed.title} · ${confirmed.teacherName} 선생님` : loading ? "제출할 수업을 확인하고 있어요." : copy.notesTargetEmpty}</p>
      {targetChanged && !loading && lesson && <button className="secondary" disabled={busy} onClick={() => { setConfirmed(lesson); setError(""); if (draft) setDraft(draftOf(draft.file)) }}>{lesson.title} · {lesson.teacherName} 선생님 선택</button>}
      {draft && <NotePreview draft={draft} label="제출할 학습지" />}
      {(error || targetChanged && confirmed) && <p role="alert">{error || copy.notesTargetChanged}</p>}
      <div className="note-actions">
        <ImagePicker label={draft ? "다른 이미지 선택" : copy.notesUpload} disabled={busy} onImage={file => {
          const invalid = validateNoteFile(file)
          setError(invalid)
          if (!invalid) setDraft(draftOf(file))
        }} />
        <button className="primary" disabled={!draft || !confirmed || targetChanged || loading || busy} onClick={() => void submit()}>{busy ? "제출 중…" : "제출하기"}</button>
      </div>
    </NoteDialog>}
  </section>
}

function useNotesList<T>(load: (signal: AbortSignal) => Promise<T>, key: string) {
  const [data, setData] = useState<{ key: string; value?: T; error?: string }>()
  const [retry, setRetry] = useState(0)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    const request = new AbortController()
    setData(undefined)
    void loader.current(request.signal).then(value => { if (!request.signal.aborted) setData({ key, value }) }).catch(error => {
      if (!request.signal.aborted) setData({ key, error: message(error) })
    })
    return () => request.abort()
  }, [key, retry])
  return { ...(data?.key === key ? data : undefined), reload: () => setRetry(value => value + 1) }
}

function ListStatus({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <div className="note-card" role="alert">{error} <button className="secondary" onClick={retry}>다시 시도</button></div> : <p role="status">기록을 불러오는 중이에요.</p>
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

function ClassNotesFilter({ lessons, title, onChange }: { lessons: ClassNoteLesson[]; title: string; onChange: (value: string) => void }) {
  const titles = [...new Set(lessons.map(lesson => lesson.title))].sort((a, b) => a.localeCompare(b, "ko"))
  return <div className="note-tabs" aria-label="수업명 필터">
    <button className="secondary" aria-pressed={!title} onClick={() => onChange("")}>전체</button>
    {titles.map(value => <button key={value} className="secondary" aria-pressed={value === title} onClick={() => onChange(value)}>{value}</button>)}
  </div>
}

export function ClassNotes({ tab, onTab }: { tab: NotesTab; onTab: (tab: NotesTab) => void }) {
  return <main className="page notes-page" aria-label={copy.notesTitle}>
    <nav className="note-tabs" aria-label={copy.notesTitle}>
      <button className="secondary" aria-pressed={tab === "worksheets"} onClick={() => onTab("worksheets")}>{copy.notesWorksheet}</button>
      <button className="secondary" aria-pressed={tab === "records"} onClick={() => onTab("records")}>{copy.notesRecords}</button>
    </nav>
    {tab === "worksheets" ? <WorksheetArchive /> : <CaptureArchive />}
  </main>
}

function WorksheetArchive() {
  const [month, setMonth] = useState(currentNoteMonth)
  const [title, setTitle] = useState("")
  const [selected, setSelected] = useState<ClassNoteWorksheet[]>()
  const [sheet, setSheet] = useState<ClassNoteWorksheet>()
  const list = useNotesList(signal => noteWorksheets({ month }, signal), month)
  const groups = groupBy(list.value?.filter(row => !title || row.lesson.title === title) ?? [], row => `${noteDay(row.original.createdAt)}/${row.lesson.id}`)
  const [year, number] = month.split("-")
  function changeMonth(delta: number) { setMonth(value => shiftNoteMonth(value, delta)); setTitle("") }
  return <>
    <ClassNotesFilter lessons={list.value?.map(row => row.lesson) ?? []} title={title} onChange={setTitle} />
    <div className="note-card note-month"><button className="secondary" aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><strong>{year}년 {Number(number)}월 제출</strong><button className="secondary" aria-label="다음 달" disabled={month >= currentNoteMonth()} onClick={() => changeMonth(1)}>›</button></div>
    {!list.value ? <ListStatus error={list.error} retry={list.reload} /> : !groups.length ? <p className="note-card">이 달에 제출한 학습지가 없어요.</p> : <div className="note-grid">
      {groups.map(([key, rows]) => <button key={key} className="note-card note-group" onClick={() => { setSheet(undefined); setSelected(rows) }}>
        <strong>{noteDateLabel(rows[0].original.createdAt)} · {rows[0].lesson.title}</strong>
        <span>{copy.notesSubmitted} {rows.length}장</span><span>{copy.notesCorrected} {rows.filter(row => row.correction).length}장</span>
      </button>)}
    </div>}
    {selected && <NoteDialog title={`${selected[0].lesson.title} · ${noteDateLabel(selected[0].original.createdAt)}`} onClose={() => setSelected(undefined)}>
      <div className="note-tabs">{selected.map((row, index) => <button key={row.original.id} className="secondary" aria-pressed={(sheet || selected[0]).original.id === row.original.id} onClick={() => setSheet(row)}>학습지 {index + 1}</button>)}</div>
      <WorksheetImages row={sheet || selected[0]} />
    </NoteDialog>}
  </>
}

function WorksheetImages({ row }: { row: ClassNoteWorksheet }) {
  return <div className="note-grid"><section><h3>{copy.notesSubmitted}</h3><StoredNoteImage id={row.original.id} label={copy.notesSubmitted} /></section>
    <section><h3>{copy.notesCorrected}</h3>{row.correction ? <StoredNoteImage id={row.correction.id} label={copy.notesCorrected} /> : <p>아직 첨삭 이미지가 없어요.</p>}</section></div>
}

function CaptureArchive() {
  const [title, setTitle] = useState("")
  const [group, setGroup] = useState<ClassNoteCapture[]>()
  const [index, setIndex] = useState(0)
  const list = useNotesList(noteCaptures, "captures")
  const groups = groupBy(list.value?.filter(row => !title || row.lesson.title === title) ?? [], row => row.lesson.id)
  return <>
    <ClassNotesFilter lessons={list.value?.map(row => row.lesson) ?? []} title={title} onChange={setTitle} />
    {!list.value ? <ListStatus error={list.error} retry={list.reload} /> : !groups.length ? <p className="note-card">저장된 수업 화면이 없어요.</p> : <div className="note-grid">
      {groups.map(([key, rows]) => <article key={key} className="note-card note-group">
        <h3>{noteDateLabel(rows[0].lesson.startsAt)} · {rows[0].lesson.title}</h3>
        {(["self", "teacher"] as const).map(source => {
          const images = rows.filter(row => row.source === source)
          return <button key={source} className="secondary note-count" disabled={!images.length} onClick={() => { setIndex(0); setGroup(images) }}><span>{source === "self" ? copy.notesOwnCapture : copy.notesTeacherCapture}</span><strong>{images.length}장</strong></button>
        })}
      </article>)}
    </div>}
    {group && <NoteDialog title={group[0].source === "self" ? copy.notesOwnCapture : copy.notesTeacherCapture} onClose={() => setGroup(undefined)}>
      <div className="note-month"><button className="secondary" aria-label="이전 화면" disabled={!index} onClick={() => setIndex(value => value - 1)}>‹</button><span>{index + 1} / {group.length}</span><button className="secondary" aria-label="다음 화면" disabled={index + 1 >= group.length} onClick={() => setIndex(value => value + 1)}>›</button></div>
      <StoredNoteImage id={group[index].image.id} label={`수업 화면 ${index + 1}`} />
    </NoteDialog>}
  </>
}

export function TeacherWorksheets({ lessonId }: { lessonId: string }) {
  const [expanded, setExpanded] = useState(false)
  return <section className="note-card note-teacher" aria-label={copy.notesTeacherList}>
    <h2>{copy.notesTeacherList}</h2>
    <button className="secondary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "목록 닫기" : "목록 보기"}</button>
    {expanded && <TeacherWorksheetList lessonId={lessonId} />}
  </section>
}

function TeacherWorksheetList({ lessonId }: { lessonId: string }) {
  const list = useNotesList(signal => noteWorksheets({ lessonId }, signal), lessonId)
  const [selected, setSelected] = useState<ClassNoteWorksheet>()
  const [draft, setDraft] = useState<NoteDraft>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const upload = useRef<AbortController | null>(null)
  useEffect(() => () => upload.current?.abort(), [])
  const close = () => { setSelected(undefined); setDraft(undefined); setError("") }
  async function save() {
    if (!selected || !draft || upload.current) return
    const request = new AbortController()
    upload.current = request
    setBusy(true); setError("")
    try {
      await uploadNote("submitClassNoteCorrection", selected.original.id, draft.file, draft.requestId, {}, request.signal)
      close(); list.reload()
    } catch (failure) { if (!request.signal.aborted) setError(message(failure)) }
    finally { upload.current = null; if (!request.signal.aborted) setBusy(false) }
  }
  return <>
    {!list.value ? <ListStatus error={list.error} retry={list.reload} /> : !list.value.length ? <p>제출한 학생이 없어요.</p> : <div className="note-grid">
      {list.value.map(row => <button key={row.original.id} className="note-card note-group" onClick={() => setSelected(row)}>
        <strong>{row.studentName}</strong><span>{noteDateLabel(row.original.createdAt)} · {row.correction ? "첨삭 완료" : "첨삭 대기"}</span>
      </button>)}
    </div>}
    {selected && <NoteDialog title={`${selected.studentName} · ${copy.notesWorksheet}`} onClose={close} busy={busy}>
      <WorksheetImages row={selected} />
      {!selected.correction && <>
        {draft && <NotePreview draft={draft} label="첨삭 이미지 미리보기" />}
        {error && <p role="alert">{error}</p>}
        <div className="note-actions">
          <ImagePicker label={copy.notesCorrection} disabled={busy} onImage={file => { const invalid = validateNoteFile(file); setError(invalid); if (!invalid) setDraft(draftOf(file)) }} />
          <button className="primary" disabled={!draft || busy} onClick={() => void save()}>{busy ? "저장 중…" : "첨삭 저장"}</button>
        </div>
      </>}
    </NoteDialog>}
  </>
}
