import { designContent } from "../generated/design-content"
import { useCallback, useEffect, useRef, useState } from "react"
import { ConnectionState, type AudioTrack, type Participant } from "livekit-client"
import { type ApiLesson, type JoinResult, type User } from "../lib/api"
import type { JoinDevices } from "./Join"
import { useMeeting } from "../lib/useMeeting"
import { formatDuration, friendlyError, readDevicePreferences } from "../lib/meeting"
import type { Panel } from "../models"
import { Confirm, Icon } from "../components/ui"
import { BrandSymbol } from "../components/BrandSymbol"
import { ScreenShareDialog } from "../components/ScreenShareDialog"
import { CallControls } from "../components/meeting/CallControls"
import { RemoteAssistanceStatus } from "../components/meeting/RemoteAssistanceStatus"
import { SharedStage } from "../components/meeting/SharedStage"
import { SidePanel } from "../components/meeting/SidePanel"
import { VideoTile } from "../components/meeting/VideoTile"
import { ParticipantGallery } from "../components/meeting/ParticipantGallery"
import { useMeetingLayout } from "../components/meeting/useMeetingLayout"
import { useChatNotifications } from "../components/meeting/useChatNotifications"
import { ChatNotification } from "../components/meeting/ChatNotification"
import { AnimatedPresence } from "../components/AnimatedPresence"
import "../components/meeting/live-meeting.css"
import "../components/meeting/chat-notifications.css"
import "../components/meeting/chat-notification-badges.css"

export function Meeting(props: { lesson: ApiLesson; user: User; initialDevices: JoinDevices; admission?: JoinResult; onEnded: (reason?: string) => void; onWaiting?: () => void }) {
  const { lesson, user } = props
  const live = useMeeting(props)
  const [panel, setPanel] = useState<Panel>(null)
  const [lastPanel, setLastPanel] = useState<Panel>(null)
  const [end, setEnd] = useState(false)
  const [shareConfirm, setShareConfirm] = useState(false)
  const [layout, setLayout] = useState<"grid" | "speaker">("grid")
  const [now, setNow] = useState(Date.now())
  const [outputDevice, setOutputDevice] = useState(() => props.initialDevices.speakerId || readDevicePreferences().speakerId || "default")
  const [audioUnlock, setAudioUnlock] = useState(false)
  const [assistanceReady, setAssistanceReady] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const { gridRef, captureLayout } = useMeetingLayout()
  const { room, snapshot, command, setError, revision } = live
  const { unreadCount, notification, dismissNotification } = useChatNotifications({ lessonId: lesson.id, userId: user.id, messages: snapshot?.messages, chatOpen: panel === "chat" })
  const activeLesson = snapshot?.lesson || lesson
  const isHost = activeLesson.teacher.id === user.id
  const share = snapshot?.share
  const raised = snapshot?.participants.find(person => person.user.id === user.id)?.raised || false
  const changePanel = useCallback((next: Panel) => {
    if (!next && panelRef.current?.contains(document.activeElement)) {
      const trigger = document.querySelector<HTMLButtonElement>('.call-controls [aria-controls="meeting-side-panel"][aria-expanded="true"]') || document.querySelector<HTMLButtonElement>('.call-controls [data-panel-trigger="more"]')
      trigger?.focus()
    }
    setPanel(next)
  }, [])
  useEffect(() => { if (panel) setLastPanel(panel) }, [panel])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") { changePanel(null); setShareConfirm(false); setEnd(false) } }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close) }, [changePanel])
  const participants: Participant[] = room ? [room.localParticipant, ...room.remoteParticipants.values()] : []
  const ordered = [...participants]
  if (layout === "speaker") {
    const speaker = room?.activeSpeakers.find(person => person.identity !== user.id) || participants.find(person => person.identity === lesson.teacher.id) || room?.localParticipant
    ordered.sort((a, b) => a === speaker ? -1 : b === speaker ? 1 : 0)
  }
  const roster = [activeLesson.teacher, ...activeLesson.students]
  const audioTracks = room ? [...room.remoteParticipants.values()].flatMap(participant => [...participant.audioTrackPublications.values()].flatMap(publication => publication.track ? [{ track: publication.track as AudioTrack, id: publication.trackSid }] : [])) : []
  const startedAt = activeLesson.startedAt ? Date.parse(activeLesson.startedAt) : now + live.serverOffset
  const elapsed = formatDuration((now + live.serverOffset - startedAt) / 1000)
  const connectionText = live.connection === ConnectionState.Connected ? live.appConnected ? designContent.meetingConnected : "수업 상태 재연결 중" : live.connection === ConnectionState.Reconnecting || live.connection === ConnectionState.SignalReconnecting ? "재연결 중" : live.connection === ConnectionState.Disconnected ? "연결 끊김" : "연결 중"
  const ownScreen = Boolean(room?.localParticipant.isScreenShareEnabled && share?.ownerId === user.id && share.type === "screen")
  return <main className={`meeting ${panel ? "has-panel" : ""}`} data-testid="meeting">
    <header className="meeting-head"><div className="meeting-title-group"><span className="meeting-brand" aria-label="웅진 씽크빅"><BrandSymbol /></span><div><h1>{activeLesson.title}</h1><span className="meeting-subtitle">{activeLesson.teacher.name} 선생님과 함께하는 화상 수업</span></div></div><div className="meeting-head-actions"><span className="call-connected" data-state={live.connection}><i />{connectionText}</span><span className="meeting-timer"><Icon name="clock" size={16} />{elapsed}</span><button className="layout-toggle" onClick={() => { captureLayout(); setLayout(layout === "grid" ? "speaker" : "grid") }} aria-label={layout === "grid" ? "발표자 보기로 전환" : "바둑판 보기로 전환"}><Icon name={layout === "grid" ? "screen" : "users"} size={18} /><span>{layout === "grid" ? "발표자 보기" : "바둑판 보기"}</span></button></div></header>
    {live.error && <div className="live-error" role="alert"><span>{live.error}</span><button aria-label="알림 닫기" onClick={() => setError("")}>닫기</button></div>}
    {(live.audioBlocked || audioUnlock) && <button className="audio-unlock" onClick={() => { void room?.startAudio().then(() => setAudioUnlock(false)).catch(e => setError(friendlyError(e))) }}>수업 소리 켜기</button>}
    <div className="meeting-body"><div className="meeting-main">
      <RemoteAssistanceStatus pointingReady={assistanceReady} snapshot={snapshot} userId={user.id} command={command} onError={setError} />
      {share && <div className="share-status-bar"><Icon name="screen" size={17} /><span>{share.type === "screen" ? `${roster.find(person => person.id === share.ownerId)?.name || "참여자"} 님의 화면 공유 중` : `${share.material?.name || "수업 자료"} 공유 중`}</span>{(isHost || share.ownerId === user.id) && <button onClick={() => void live.stopShare()}>공유 중지</button>}</div>}
      <section className={`stage ${share ? "is-sharing" : ""}`} aria-label="수업 화면">
        {share && snapshot ? <div className="stage-view" key={share.id}><SharedStage user={user} snapshot={snapshot} room={room} command={command} previews={live.previews} sendPreview={live.sendPreview} remotePointer={live.remotePointer} sendAssistancePointer={live.sendAssistancePointer} assistanceConnected={live.appConnected && live.connection === ConnectionState.Connected} onAssistanceReady={setAssistanceReady} serverOffset={live.serverOffset} outputDevice={outputDevice} revision={revision} onError={setError} /></div> : <ParticipantGallery participants={ordered} layout={layout} gridRef={gridRef} renderParticipant={participant => { const person = roster.find(item => item.id === participant.identity); const entry = snapshot?.participants.find(item => item.user.id === participant.identity); return <VideoTile key={participant.identity} person={person?.name || participant.name || "참여자"} participant={participant} teacher={participant.identity === activeLesson.teacher.id} self={participant.identity === user.id} cameraOn={participant.isCameraEnabled} muted={!participant.isMicrophoneEnabled} hand={entry?.raised} speaking={participant.isSpeaking} /> }} />}
      </section>
    </div><button className="panel-backdrop" aria-hidden={!panel} tabIndex={panel ? 0 : -1} aria-label="패널 닫기" onClick={() => changePanel(null)} /><div ref={panelRef} id="meeting-side-panel" className="meeting-panel-container" inert={!panel} aria-hidden={!panel}><SidePanel panel={panel || lastPanel} setPanel={changePanel} user={user} lesson={activeLesson} room={room} snapshot={snapshot} command={command} onOutputChange={setOutputDevice} revision={revision} unreadChatCount={unreadCount} /></div></div>
    {notification && <ChatNotification message={notification} onOpen={() => changePanel("chat")} onDismiss={dismissNotification} />}
    <CallControls role={isHost ? "teacher" : "student"} raised={raised} setRaised={value => { void command("hand.set", { raised: value }).catch(e => setError(friendlyError(e))) }} panel={panel} setPanel={changePanel} mic={Boolean(room?.localParticipant.isMicrophoneEnabled)} cam={Boolean(room?.localParticipant.isCameraEnabled)} setMic={value => void live.setMic(value)} setCam={value => void live.setCam(value)} participantCount={participants.length} screenSharing={ownScreen} onShareScreen={() => { if (ownScreen) void live.stopShare(); else { changePanel(null); setShareConfirm(true) } }} onEnd={() => setEnd(true)} unreadChatCount={unreadCount} />
    <div hidden aria-hidden="true">{audioTracks.map(({ track, id }) => <RemoteAudio key={id} track={track} muted={outputDevice === "muted"} onBlocked={() => setAudioUnlock(true)} />)}</div>
    <AnimatedPresence show={end}><Confirm title={isHost ? "모두의 수업을 종료할까요?" : "수업에서 나갈까요?"} copy={isHost ? "참여 중인 모든 사람의 수업이 함께 종료됩니다." : "다른 참여자는 수업을 계속할 수 있어요."} cancel={() => setEnd(false)} confirm={() => { setEnd(false); void live.leave() }} confirmText={isHost ? "모두 종료" : "수업 나가기"} /></AnimatedPresence>
    <AnimatedPresence show={shareConfirm}><ScreenShareDialog cancel={() => setShareConfirm(false)} confirm={target => { setShareConfirm(false); void live.startScreen(target) }} /></AnimatedPresence>
  </main>
}
function RemoteAudio({ track, muted, onBlocked }: { track: AudioTrack; muted: boolean; onBlocked: () => void }) {
  const audio = useRef<HTMLAudioElement>(null)
  const blocked = useRef(onBlocked); blocked.current = onBlocked
  useEffect(() => { const element = audio.current; if (!element) return; track.attach(element); void element.play().catch(() => blocked.current()); return () => { track.detach(element) } }, [track])
  return <audio ref={audio} autoPlay muted={muted} data-testid="remote-audio" />
}
