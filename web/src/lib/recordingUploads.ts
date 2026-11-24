import { useSyncExternalStore } from "react"
import type { LessonRecording } from "../generated/contracts"
import { ApiError, apiResponse, call, operationPath } from "./api"

/** A finished recording in this browser's private storage (OPFS), waiting for upload. */
export type PendingRecording = {
  requestId: string; userId: string; lessonId: string; file: string; size: number
  durationMs: number; width: number; height: number; startedAt: string; recordingId?: string
}
export type RecordingUpload = { requestId: string; lessonId: string; uploadedBytes: number; size: number; error?: string; finished?: boolean }

const KEY = "think-meet.recordings.pending"
let uploads: RecordingUpload[] = []
const listeners = new Set<() => void>()
let userId: string | undefined
let running = false
let wake: (() => void) | undefined

function pending(): PendingRecording[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") as PendingRecording[] } catch { return [] }
}
function persist(items: PendingRecording[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)) } catch { /* The upload continues in this tab. */ }
}
function update(requestId: string, change: (row?: RecordingUpload) => RecordingUpload | undefined) {
  const current = uploads.find(row => row.requestId === requestId)
  const next = change(current)
  uploads = !next ? uploads.filter(row => row.requestId !== requestId)
    : current ? uploads.map(row => row.requestId === requestId ? next : row) : [...uploads, next]
  listeners.forEach(listener => listener())
}
export const recordingUploads = () => uploads
export function subscribeRecordingUploads(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }

async function folder() { return (await navigator.storage.getDirectory()).getDirectoryHandle("recordings", { create: true }) }
async function readFile(name: string) { return (await (await folder()).getFileHandle(name)).getFile() }
async function removeFile(name: string) { await (await folder()).removeEntry(name).catch(() => undefined) }

/** Starts uploading the signed-in teacher's recordings; undefined pauses (logout or another account). */
export function attachRecordingUploads(user?: string) {
  if (user === userId) { wake?.(); return }
  userId = user
  uploads = pending().filter(item => item.userId === user).map(item => ({ requestId: item.requestId, lessonId: item.lessonId, uploadedBytes: 0, size: item.size }))
  listeners.forEach(listener => listener())
  // Wakes a waiting loop so it switches account or stops.
  wake?.()
  if (user && !running) void run()
}

export function enqueueRecording(item: Omit<PendingRecording, "requestId">) {
  const queued = { ...item, requestId: crypto.randomUUID() }
  persist([...pending(), queued])
  if (queued.userId === userId) update(queued.requestId, () => ({ requestId: queued.requestId, lessonId: queued.lessonId, uploadedBytes: 0, size: queued.size }))
  wake?.()
}

export function retryRecordingUploads() {
  uploads = uploads.map(row => row.finished ? row : { ...row, error: undefined })
  listeners.forEach(listener => listener())
  wake?.()
}

const permanent = (error: unknown) => error instanceof ApiError && [400, 403, 404, 409, 413].includes(error.status) && error.code !== "RECORDING_OFFSET"

async function run() {
  running = true
  let failures = 0
  try {
    while (userId) {
      const user = userId
      const item = pending().find(entry => entry.userId === user)
      if (!item) { await new Promise<void>(resolve => { wake = resolve }); continue }
      try {
        await upload(item)
        failures = 0
      } catch (error) {
        const message = error instanceof Error ? error.message : "녹화 영상을 올리지 못했어요."
        if (permanent(error)) await abandon(item, message)
        else {
          update(item.requestId, row => row && { ...row, error: message })
          failures++
          const wait = Math.min(300_000, 30_000 * 2 ** Math.min(failures - 1, 4))
          await new Promise<void>(resolve => { wake = resolve; setTimeout(resolve, wait) })
        }
      }
    }
  } finally { running = false; wake = undefined }
}

async function abandon(item: PendingRecording, message: string) {
  persist(pending().filter(entry => entry.requestId !== item.requestId))
  await removeFile(item.file)
  update(item.requestId, () => ({ requestId: item.requestId, lessonId: item.lessonId, uploadedBytes: 0, size: item.size, error: message, finished: true }))
}

/** Same protocol as the apps: idempotent create by request ID, then fixed-size chunks from the stored offset. */
async function upload(item: PendingRecording) {
  let file: File
  try { file = await readFile(item.file) } catch { await abandon(item, "브라우저에서 녹화 파일을 찾을 수 없어요."); return }
  if (file.size !== item.size) { await abandon(item, "브라우저에서 녹화 파일을 찾을 수 없어요."); return }
  const start = () => call("createLessonRecording", { params: { id: item.lessonId }, body: {
    requestId: item.requestId, size: item.size, durationMs: item.durationMs, width: item.width, height: item.height, startedAt: item.startedAt,
  } })
  let recording: LessonRecording = await start()
  if (item.recordingId !== recording.id) persist(pending().map(entry => entry.requestId === item.requestId ? { ...entry, recordingId: recording.id } : entry))
  while (recording.status !== "ready") {
    const offset = recording.uploadedBytes
    update(item.requestId, row => row && { ...row, uploadedBytes: offset, size: recording.size, error: undefined })
    const chunk = file.slice(offset, Math.min(recording.size, offset + recording.chunkSize))
    try {
      const response = await apiResponse(operationPath("uploadLessonRecordingChunk", { id: recording.id }, { offset: String(offset) }), {
        method: "PUT", body: chunk, headers: { "Content-Type": "application/octet-stream" },
      })
      recording = await response.json() as LessonRecording
    } catch (error) {
      // Another attempt already stored more; continue from the server's offset.
      if (!(error instanceof ApiError) || error.code !== "RECORDING_OFFSET") throw error
      recording = await start()
    }
  }
  persist(pending().filter(entry => entry.requestId !== item.requestId))
  await removeFile(item.file)
  update(item.requestId, () => ({ requestId: item.requestId, lessonId: item.lessonId, uploadedBytes: item.size, size: item.size, finished: true }))
}

/** Rows for one lesson, including finished ones so the end screen can confirm the upload. */
export function useRecordingUploads(lessonId: string) {
  const rows = useSyncExternalStore(subscribeRecordingUploads, recordingUploads)
  return rows.filter(row => row.lessonId === lessonId)
}
