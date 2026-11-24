import { useCallback, useEffect, useState } from "react"
import { API_BASE_PATH, CONTRACT_REVISION, type LessonRecording } from "../generated/contracts"
import { designContent as copy } from "../generated/design-content"
import { call, operationPath } from "../lib/api"
import { retryRecordingUploads, useRecordingUploads, type RecordingUpload } from "../lib/recordingUploads"
import { NoteDialog } from "../screens/ClassNotes"
import { Icon } from "./ui"

/** Browser video elements cannot send capability headers, so the same values travel in the query. */
export function recordingSource(id: string) {
  return API_BASE_PATH + operationPath("getLessonRecordingContent", { id }, { platform: "web", contractRevision: String(CONTRACT_REVISION) })
}

export function recordingDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = String(seconds % 60).padStart(2, "0")
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`
}

export function recordingSize(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))}MB`
}

/** Whole days until the server removes the recording, rounded up. */
export function recordingDaysLeft(expiresAt: string, now = Date.now()) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86_400_000))
}

function recordingTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

/** A recording finished in this browser: upload progress, failure with retry, or completion. */
export function RecordingUploadRow({ upload }: { upload: RecordingUpload }) {
  const percent = upload.size ? Math.min(100, Math.floor((upload.uploadedBytes / upload.size) * 100)) : 0
  if (upload.finished && !upload.error) return <p className="recording-upload done" role="status">녹화 영상을 올렸어요. 수업 상세에서 30일 동안 다시 볼 수 있어요.</p>
  if (upload.finished) return <p className="recording-upload" role="alert">{copy.recordingUploadFailed}: {upload.error}</p>
  return <div className="recording-upload" role="status">
    <div className="recording-upload-head"><span>녹화 영상 {copy.recordingUploading}</span><span>{percent}% · {recordingSize(upload.size)}</span></div>
    <progress max={100} value={percent} aria-label={`녹화 영상 ${copy.recordingUploading}`} />
    {upload.error && <div className="recording-upload-error"><p role="alert">{upload.error} 자동으로 다시 시도해요.</p><button className="secondary" onClick={retryRecordingUploads}>{copy.recordingUploadRetry}</button></div>}
  </div>
}

/** End screen: the recording just made keeps uploading while the teacher reads the summary. */
export function EndedRecordingUploads({ lessonId }: { lessonId: string }) {
  const uploads = useRecordingUploads(lessonId)
  if (!uploads.length) return null
  return <section className="note-card note-teacher recording-ended" aria-label={copy.recordingListTitle}>
    <h2><Icon name="video" size={20} />{copy.recordingListTitle}</h2>
    {uploads.map(upload => <RecordingUploadRow key={upload.requestId} upload={upload} />)}
  </section>
}

/** The owner's recordings of one lesson: uploads still in this browser, then the server list for replay. */
export function LessonRecordings({ lessonId }: { lessonId: string }) {
  const uploads = useRecordingUploads(lessonId)
  const finishedUploads = uploads.filter(upload => upload.finished && !upload.error).length
  const [rows, setRows] = useState<LessonRecording[]>()
  const [error, setError] = useState("")
  const [playing, setPlaying] = useState<LessonRecording>()
  const load = useCallback((signal?: AbortSignal) => {
    setError("")
    call("listLessonRecordings", { query: { lessonId }, signal })
      .then(setRows)
      .catch(e => { if (!signal?.aborted) setError(e instanceof Error ? e.message : "녹화 목록을 불러오지 못했어요.") })
  }, [lessonId])
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load, finishedUploads])
  return <section className="note-card note-teacher" aria-label={copy.recordingListTitle}>
    <div className="note-teacher-head">
      <h2><Icon name="video" size={20} />{copy.recordingListTitle}</h2>
    </div>
    {uploads.filter(upload => !upload.finished || upload.error).map(upload => <RecordingUploadRow key={upload.requestId} upload={upload} />)}
    {error ? <div className="note-empty" role="alert"><p>{error}</p><button className="secondary" onClick={() => load()}>다시 시도</button></div>
      : !rows ? <p className="note-empty" role="status">녹화 목록을 불러오는 중이에요.</p>
      : !rows.length ? <p className="note-empty">{copy.recordingEmpty}</p>
      : <div className="note-list">
        {rows.map(row => {
          const ready = row.status === "ready"
          const progress = Math.floor((row.uploadedBytes / row.size) * 100)
          return <button key={row.id} className="note-row recording-row" disabled={!ready} onClick={() => setPlaying(row)}>
            <Icon name="video" size={20} />
            <span className="note-row-label">{recordingTime(row.startedAt)} · {recordingDuration(row.durationMs)}</span>{" "}
            <span className="note-row-meta">{recordingSize(row.size)} · {recordingDaysLeft(row.expiresAt)}일 후 삭제</span>{" "}
            <span className={`note-status ${ready ? "done" : ""}`}>{ready ? copy.recordingPlay : `${copy.recordingUploading} ${progress}%`}</span>
          </button>
        })}
      </div>}
    {playing && <NoteDialog title={`${playing.lessonTitle} · ${copy.recordingListTitle}`} onClose={() => setPlaying(undefined)}>
      <video className="recording-video" src={recordingSource(playing.id)} controls autoPlay playsInline preload="metadata" />
    </NoteDialog>}
  </section>
}
