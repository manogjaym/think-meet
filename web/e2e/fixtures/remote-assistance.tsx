import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Track, type Room } from "livekit-client"
import type { AssistanceGeometry, AssistancePointer, MeetingSnapshot, Stroke, User } from "../../src/generated/contracts"
import type { Panel } from "../../src/models"
import { SharedStage } from "../../src/components/meeting/SharedStage"
import { SidePanel } from "../../src/components/meeting/SidePanel"
import { RemoteAssistanceStatus } from "../../src/components/meeting/RemoteAssistanceStatus"
import { activeAssistance, REMOTE_POINTER_TTL_MS, type RemotePointer } from "../../src/lib/remoteAssistance"
import { loadCapabilities } from "../../src/lib/features"
import "../../src/index.css"
import "../../src/meeting.css"
import "../../src/components/meeting/live-meeting.css"

const teacher: User = { id: "teacher", name: "김선생", username: "teacher", role: "teacher" }
const student: User = { id: "student", name: "김학생", username: "student", role: "student" }
const now = new Date().toISOString()
const portrait: AssistanceGeometry = { width: 1080, height: 2400, rotation: 0, version: 1 }
const base: MeetingSnapshot = {
  lessonId: "assistance-fixture", lesson: { id: "assistance-fixture", title: "함께 공부해요", teacher, students: [student], description: "", startsAt: now, endsAt: null, status: "LIVE", code: "assistance", startedAt: now, endedAt: null },
  share: null, assistance: null, participants: [teacher, student].map(user => ({ user, online: true, raised: false })), messages: [], strokes: [], seq: 1, serverTime: now,
}
const poster = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="2400"><rect width="1080" height="2400" fill="#f6f9fc"/><rect x="60" y="150" width="960" height="2000" rx="24" fill="white"/><text x="120" y="300" font-family="sans-serif" font-size="60" fill="#0d253d">학생의 다른 앱 화면</text><text x="120" y="420" font-family="sans-serif" font-size="36" fill="#61718a">김학생 · Android 전체 화면 공유</text><rect x="140" y="1150" width="800" height="180" rx="20" fill="#533afd"/><text x="540" y="1260" font-family="sans-serif" text-anchor="middle" font-size="60" fill="white">학습 시작</text></svg>')}`
const track = (landscape: boolean) => ({ attach(video: HTMLVideoElement) {
  video.poster = poster
  Object.defineProperty(video, "videoWidth", { configurable: true, value: landscape ? 2400 : 1080 })
  Object.defineProperty(video, "videoHeight", { configurable: true, value: landscape ? 1080 : 2400 })
  video.dispatchEvent(new Event("loadedmetadata"))
}, detach() {} })
const portraitTrack = track(false), landscapeTrack = track(true)
const fixtureEvents = { on() { return this }, off() { return this } }
const participant = (user: User, landscape = false) => ({ ...fixtureEvents, identity: user.id, name: user.name, getTrackPublication: (source: Track.Source) => source === Track.Source.ScreenShare && user.id === student.id ? { track: landscape ? landscapeTrack : portraitTrack, isMuted: false } : undefined })

function Harness() {
  const [snapshot, setSnapshot] = useState(base)
  const [user, setUser] = useState(teacher)
  const [panel, setPanel] = useState<Panel>("people")
  const [pointer, setPointer] = useState<RemotePointer | null>(null)
  const [landscape, setLandscape] = useState(false)
  const [connected, setConnected] = useState(true)
  const [pointingReady, setPointingReady] = useState(false)
  const [error, setError] = useState("")
  const [commands, setCommands] = useState<string[]>([])
  const [frames, setFrames] = useState<AssistancePointer[]>([])
  const [previewCount, setPreviewCount] = useState(0)
  // Android apps get `annotation: true`, iOS apps `false`; older servers omit it.
  const startShare = (annotation?: boolean) => setSnapshot(value => ({ ...value, share: { id: "student-screen", type: "screen", ownerId: student.id, page: 1, playing: false, position: 0, updatedAt: now, assistanceId: "session" }, assistance: { id: "session", teacherId: teacher.id, studentId: student.id, status: "active", expiresAt: null, shareId: "student-screen", geometry: portrait, ...(annotation === undefined ? {} : { annotation }) } }))
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const remoteUser = user.id === teacher.id ? student : teacher
  const room = { ...fixtureEvents, localParticipant: participant(user, landscape), remoteParticipants: new Map([[remoteUser.id, participant(remoteUser, landscape)]]) } as unknown as Room
  const command = async (type: string, payload: Record<string, unknown> = {}) => {
    setCommands(value => [...value, type])
    let next = snapshot
    if (type === "assistance.request") next = { ...snapshot, assistance: { id: "session", teacherId: teacher.id, studentId: String(payload.studentId), status: "pending", expiresAt: new Date(Date.now() + 60_000).toISOString() } }
    else if (type === "assistance.stop") next = { ...snapshot, assistance: null, share: null }
    else if (type === "stroke.add") next = { ...snapshot, strokes: [...snapshot.strokes, { ...(payload as Omit<Stroke, "authorId" | "deleted">), authorId: user.id, deleted: false }] }
    else if (type === "stroke.erase") next = { ...snapshot, strokes: snapshot.strokes.map(stroke => (payload.ids as string[]).includes(stroke.id) ? { ...stroke, deleted: true } : stroke) }
    else if (type === "annotation.clear") next = { ...snapshot, strokes: snapshot.strokes.map(stroke => ({ ...stroke, deleted: true })) }
    else throw new Error(`Unexpected persistent command: ${type}`)
    setSnapshot(next)
    return next
  }
  const sendPointer = (x: number, y: number) => {
    const session = activeAssistance(snapshot)
    if (!session?.geometry || user.id !== teacher.id || !connected) return
    const frame = { lessonId: snapshot.lessonId, sessionId: session.id, shareId: session.shareId!, geometryVersion: session.geometry.version, x, y, authorId: teacher.id }
    setFrames(value => [...value, frame])
    setPointer({ ...frame, receivedAt: Date.now() })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setPointer(null), REMOTE_POINTER_TTL_MS)
  }
  useEffect(() => { setPointer(null); clearTimeout(timer.current) }, [snapshot.assistance?.id, snapshot.assistance?.geometry?.version, connected])
  useEffect(() => () => clearTimeout(timer.current), [])
  return <main className={`meeting ${panel ? "has-panel" : ""}`}>
    <header className="meeting-head"><h1>원격 화면 안내 검증</h1><div className="fixture-controls">
      <button onClick={() => setSnapshot(value => ({ ...value, assistance: value.assistance ? { ...value.assistance, status: "approved", expiresAt: null } : null }))}>학생 승인</button>
      <button onClick={() => startShare()}>학생 공유 시작</button>
      <button onClick={() => startShare(true)}>Android 학생 공유 시작</button>
      <button onClick={() => startShare(false)}>iOS 학생 공유 시작</button>
      <button onClick={() => setPanel(value => value ? null : "people")}>참석자 전환</button>
      <button onClick={() => setPanel("more")}>더보기 열기</button>
      <button onClick={() => setUser(value => value.id === teacher.id ? student : teacher)}>역할 전환</button>
      <button onClick={() => setSnapshot(value => ({ ...value, assistance: value.assistance ? { ...value.assistance, geometry: { width: 2400, height: 1080, rotation: 90, version: 2 } } : null }))}>회전</button>
      <button onClick={() => setSnapshot(value => ({ ...value, assistance: value.assistance ? { ...value.assistance, geometry: { ...portrait, rotation: 180, version: 3 } } : null }))}>같은 비율 회전</button>
      <button onClick={() => setLandscape(true)}>영상 회전 반영</button>
      <button onClick={() => setConnected(value => !value)}>연결 전환</button>
      <button onClick={() => { void loadCapabilities({ force: true }) }}>지원 새로고침</button>
    </div></header>
    {error && <p role="alert">{error}</p>}
    <div className="meeting-body"><div className="meeting-main"><RemoteAssistanceStatus pointingReady={pointingReady} snapshot={snapshot} userId={user.id} command={command} onError={setError} />{snapshot.share && <><div className="share-status-bar">김학생 님의 화면 공유 중</div><section className="stage is-sharing"><SharedStage user={user} snapshot={snapshot} room={room} command={command} previews={{}} sendPreview={() => setPreviewCount(value => value + 1)} remotePointer={pointer} sendAssistancePointer={sendPointer} assistanceConnected={connected} onAssistanceReady={setPointingReady} serverOffset={0} outputDevice="muted" onError={setError} /></section></>}</div>{panel && <div className="meeting-panel-container"><SidePanel panel={panel} setPanel={setPanel} user={user} lesson={snapshot.lesson} room={room} snapshot={snapshot} command={command} onOutputChange={() => {}} /></div>}</div>
    <output hidden data-testid="commands">{JSON.stringify(commands)}</output><output hidden data-testid="frames">{JSON.stringify(frames)}</output><output hidden data-testid="previews">{previewCount}</output>
  </main>
}

createRoot(document.getElementById("root")!).render(<Harness />)
