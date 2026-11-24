import { enqueueRecording } from "./recordingUploads"

/** Same size targets as the apps' RecordingProfile: readable slides in small files. */
const PROFILE = { maxWidth: 1280, maxHeight: 720, frameRate: 15, videoBitsPerSecond: 700_000, audioBitsPerSecond: 64_000 }
/** H.264 MP4 only, so every client can play it. High profile first; AAC when the browser can encode it, otherwise Opus. */
const MIME_TYPES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1.640028,opus", "video/mp4;codecs=avc1,opus",
]

export type RecordingSnapshot = { active: boolean; startedAt: number; notice?: string }
type Capture = { lessonId: string; userId: string; stream: MediaStream }
type Session = Capture & {
  recorder: MediaRecorder; context: AudioContext; microphone?: { track: MediaStreamTrack; node: MediaStreamAudioSourceNode }
  destination: MediaStreamAudioDestinationNode; file: FileSystemFileHandle; writable: FileSystemWritableFileStream
  writes: Promise<void>; startedAt: number; width: number; height: number
}

let pending: Capture | undefined
let session: Session | undefined
let snapshot: RecordingSnapshot = { active: false, startedAt: 0 }
const listeners = new Set<() => void>()
function publish(next: RecordingSnapshot) { snapshot = next; listeners.forEach(listener => listener()) }
export const recordingSnapshot = () => snapshot
export function subscribeRecording(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function takeRecordingNotice() { const notice = snapshot.notice; if (notice) publish({ ...snapshot, notice: undefined }); return notice }

function mimeType() { return typeof MediaRecorder === "undefined" ? undefined : MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) }

/** PC Chrome/Edge: current-tab capture with tab sound, H.264 MP4 recording and private file storage. */
export function webRecordingSupported() {
  const mobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ?? /Android|iPhone|iPad/i.test(navigator.userAgent)
  return !mobile && window.isSecureContext && typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    typeof navigator.storage?.getDirectory === "function" && !!mimeType()
}

/**
 * Must run directly in the click handler: Chrome opens the share picker only with user activation.
 * Keeps the tab stream until the meeting connects; a declined picker means the lesson starts unrecorded.
 */
export async function requestRecordingCapture(lessonId: string, userId: string): Promise<boolean> {
  discardPendingCapture()
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: PROFILE.maxWidth }, height: { max: PROFILE.maxHeight }, frameRate: { max: PROFILE.frameRate } },
      audio: { suppressLocalAudioPlayback: false } as MediaTrackConstraints,
      preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude", systemAudio: "exclude", monitorTypeSurfaces: "exclude",
    } as DisplayMediaStreamOptions)
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface
    if (surface && surface !== "browser") {
      stream.getTracks().forEach(track => track.stop())
      publish({ ...snapshot, notice: "수업 탭만 녹화할 수 있어요. 녹화 없이 수업을 진행해요." })
      return false
    }
    pending = { lessonId, userId, stream }
    return true
  } catch {
    publish({ ...snapshot, notice: "화면 녹화를 허용하지 않아 녹화 없이 수업을 진행해요." })
    return false
  }
}

export function hasPendingCapture(lessonId: string) { return pending?.lessonId === lessonId }
export function discardPendingCapture() { pending?.stream.getTracks().forEach(track => track.stop()); pending = undefined }

/** Starts writing once the lesson media is connected, mixing tab sound (participants, shared videos) with the teacher microphone. */
export async function startRecording(lessonId: string, microphone?: MediaStreamTrack) {
  const capture = pending
  if (!capture || capture.lessonId !== lessonId || session) return
  pending = undefined
  const type = mimeType()
  const video = capture.stream.getVideoTracks()[0]
  // Screen text: ask the encoder to keep detail (resolution) rather than motion smoothness.
  if (video) video.contentHint = "detail"
  if (!type || !video || video.readyState === "ended") { capture.stream.getTracks().forEach(track => track.stop()); return }
  let created: FileSystemFileHandle | undefined
  try {
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle("recordings", { create: true })
    const name = `lesson-${crypto.randomUUID()}.mp4`
    created = await folder.getFileHandle(name, { create: true })
    const writable = await created.createWritable()
    const context = new AudioContext({ sampleRate: 48_000 })
    const destination = context.createMediaStreamDestination()
    const tabAudio = capture.stream.getAudioTracks()
    if (tabAudio.length) context.createMediaStreamSource(new MediaStream(tabAudio)).connect(destination)
    const recorder = new MediaRecorder(new MediaStream([video, ...destination.stream.getAudioTracks()]), {
      mimeType: type, videoBitsPerSecond: PROFILE.videoBitsPerSecond, audioBitsPerSecond: PROFILE.audioBitsPerSecond,
    })
    const settings = video.getSettings()
    const current: Session = {
      ...capture, recorder, context, destination, file: created, writable, writes: Promise.resolve(), startedAt: Date.now(),
      width: settings.width || PROFILE.maxWidth, height: settings.height || PROFILE.maxHeight,
    }
    recorder.ondataavailable = event => {
      if (event.data.size) current.writes = current.writes.then(() => writable.write(event.data))
    }
    // Chrome's "Stop sharing" bar ends the capture; finish and upload what was recorded.
    video.addEventListener("ended", () => { if (session === current) void stopRecording("화면 공유를 멈춰 녹화를 마쳤어요. 수업이 끝나면 녹화 영상을 올려요.") })
    session = current
    setRecordingMicrophone(microphone)
    recorder.start(1000)
    if (context.state === "suspended") void context.resume().catch(() => undefined)
    publish({ active: true, startedAt: current.startedAt })
  } catch {
    capture.stream.getTracks().forEach(track => track.stop())
    if (created) void navigator.storage.getDirectory().then(root => root.getDirectoryHandle("recordings")).then(folder => folder.removeEntry(created!.name)).catch(() => undefined)
    publish({ active: false, startedAt: 0, notice: "화면 녹화를 시작하지 못했어요. 녹화 없이 수업을 진행해요." })
  }
}

/** Follows the published microphone; a muted LiveKit track records silence, as in the apps. */
export function setRecordingMicrophone(track?: MediaStreamTrack) {
  const current = session
  if (!current || current.microphone?.track === track) return
  current.microphone?.node.disconnect()
  current.microphone = undefined
  if (!track || track.readyState === "ended") return
  const node = current.context.createMediaStreamSource(new MediaStream([track]))
  node.connect(current.destination)
  current.microphone = { track, node }
}

/** Finalizes the file and queues it for upload. Safe to call repeatedly. */
export async function stopRecording(notice?: string) {
  discardPendingCapture()
  const current = session
  if (!current) return
  session = undefined
  const stoppedAt = Date.now()
  publish({ active: false, startedAt: 0, notice })
  const stopped = new Promise<void>(resolve => { current.recorder.onstop = () => resolve() })
  if (current.recorder.state !== "inactive") current.recorder.stop()
  else current.recorder.onstop?.(new Event("stop"))
  await stopped
  current.stream.getTracks().forEach(track => track.stop())
  current.microphone?.node.disconnect()
  void current.context.close().catch(() => undefined)
  try {
    await current.writes
    await current.writable.close()
    const file = await current.file.getFile()
    if (!file.size) throw new Error("empty recording")
    enqueueRecording({
      userId: current.userId, lessonId: current.lessonId, file: current.file.name, size: file.size,
      durationMs: stoppedAt - current.startedAt, width: current.width, height: current.height,
      startedAt: new Date(current.startedAt).toISOString(),
    })
  } catch {
    await navigator.storage.getDirectory().then(root => root.getDirectoryHandle("recordings")).then(folder => folder.removeEntry(current.file.name)).catch(() => undefined)
  }
}

/** The browser cannot finish an MP4 after the tab closes, so warn before leaving mid-recording. */
export const isRecording = () => !!session

let owners = 0
let releaseTimer: number | undefined
/** The meeting screen owns the recording; React StrictMode remounts must not stop it. */
export function retainRecording() { owners++; window.clearTimeout(releaseTimer) }
export function releaseRecording() {
  owners = Math.max(0, owners - 1)
  if (owners) return
  window.clearTimeout(releaseTimer)
  releaseTimer = window.setTimeout(() => { if (!owners) void stopRecording() }, 0)
}
