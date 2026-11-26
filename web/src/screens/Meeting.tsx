import { designContent } from "../generated/design-content"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { ConnectionState, RoomEvent, Track, type AudioTrack, type Room } from "livekit-client"
import { type ApiLesson, type JoinResult, type User } from "../lib/api"
import type { JoinDevices } from "./Join"
import { useMeeting } from "../lib/useMeeting"
import { useAudioPlaybackBlocked, useParticipantTrack, useRemoteAudioTracks, useRemoteSpeaker, useRoomParticipants } from "../lib/livekitMedia"
import { formatDuration, friendlyError, readDevicePreferences } from "../lib/meeting"
import type { Panel } from "../models"
import { Confirm, Icon } from "../components/ui"
import { BrandSymbol } from "../components/BrandSymbol"
import { ScreenShareDialog } from "../components/ScreenShareDialog"
import { CallControls } from "../components/meeting/CallControls"
import { MirroringStudentDialog } from "../components/meeting/MirroringStudentDialog"
import { RemoteAssistanceStatus } from "../components/meeting/RemoteAssistanceStatus"
import { SharedParticipants, SharedStage, type SharedFrame } from "../components/meeting/SharedStage"
import designLayout from "../generated/design-layout.json"
import { SidePanel } from "../components/meeting/SidePanel"
import { MaterialsCard, TeacherStageGuide } from "../components/meeting/TeacherRail"
import { fillSubject, SubjectSwitch } from "../components/meeting/SubjectSwitch"
import { VideoTile } from "../components/meeting/VideoTile"
import { ParticipantControlsContext, type ParticipantControlState } from "../components/meeting/ParticipantControls"
import { ParticipantGallery } from "../components/meeting/ParticipantGallery"
import { useMeetingLayout } from "../components/meeting/useMeetingLayout"
import { useChatNotifications } from "../components/meeting/useChatNotifications"
import { ChatNotification } from "../components/meeting/ChatNotification"
import { AnimatedPresence } from "../components/AnimatedPresence"
import { useFeature } from "../lib/useFeature"
import { notesFeature, uploadNote } from "../lib/classNotes"
import { NoteDialog, NotePreview, type NoteDraft } from "./ClassNotes"
import type { LessonModeSetPayload } from "../generated/contracts"
import { activeAssistance as mirroringOnStage, currentAssistance } from "../lib/remoteAssistance"
import "../components/meeting/live-meeting.css"
import "../components/meeting/chat-notifications.css"
import "../components/meeting/chat-notification-badges.css"
import { FEATURE_IDS } from "../generated/feature-policy"
import { handoffRecording, recordingSnapshot, releaseRecording, retainRecording, setRecordingMicrophone, startRecording, subscribeRecording, takeRecordingNotice } from "../lib/lessonRecording"

export type FollowMedia = { mic: boolean; cam: boolean }

export function Meeting(props: {
  lesson: ApiLesson; user: User; initialDevices: JoinDevices; admission?: JoinResult; onEnded: (reason?: string) => void; onWaiting?: () => void
  /** classroom.subject-switch: open `nextLessonId` with the current microphone and camera state. */
  onFollow?: (nextLessonId: string, media: FollowMedia) => void
  /** classroom.subject-switch: the same room now belongs to `next`; update the address without remounting. */
  onContinued?: (next: ApiLesson) => void
  /** This admission continues a lesson whose subject the teacher just changed. */
  switched?: boolean
}) {
  const { lesson, user } = props
  const media = useRef<FollowMedia>({ mic: props.initialDevices.mic, cam: props.initialDevices.cam })
  const onEnded = useCallback((reason?: string, nextLessonId?: string) => {
    if (!nextLessonId || !props.onFollow) { props.onEnded(reason === "switched" ? "ended" : reason); return }
    // The tab capture moves on; the finished file uploads for this lesson.
    handoffRecording(nextLessonId)
    props.onFollow(nextLessonId, media.current)
  }, [props.onEnded, props.onFollow])
  const notify = useRef<(message: string) => void>(() => {})
  const onContinued = useCallback((next: ApiLesson) => {
    // Before the lesson id changes: the running tab capture continues as the next lesson's file.
    handoffRecording(next.id)
    props.onContinued?.(next)
    if (next.subject) notify.current(fillSubject(designContent.meetingSubjectSwitched, next.subject.name))
  }, [props.onContinued])
  const live = useMeeting({ ...props, onEnded, onContinued })
  const [panel, setPanel] = useState<Panel>(null)
  const [lastPanel, setLastPanel] = useState<Panel>(null)
  const [end, setEnd] = useState(false)
  const [shareConfirm, setShareConfirm] = useState(false)
  const [showMirroringStudents, setShowMirroringStudents] = useState(false)
  const [modeConfirm, setModeConfirm] = useState<{ change: LessonModeSetPayload; materials: boolean } | null>(null)
  const [modeBusy, setModeBusy] = useState(false)
  const [layout, setLayout] = useState<"grid" | "speaker">("grid")
  const [now, setNow] = useState(Date.now())
  const [outputDevice, setOutputDevice] = useState(() => props.initialDevices.speakerId || readDevicePreferences().speakerId || "default")
  const [audioUnlock, setAudioUnlock] = useState(false)
  const [assistanceReady, setAssistanceReady] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const { gridRef, captureLayout } = useMeetingLayout()
  const { room, snapshot, command, setError } = live
  const mic = useParticipantTrack(room?.localParticipant, Track.Source.Microphone).enabled
  const cam = useParticipantTrack(room?.localParticipant, Track.Source.Camera).enabled
  // Before the first publish the tracks report off; keep the prejoin choice until media is connected.
  useEffect(() => { if (live.connection === ConnectionState.Connected) media.current = { mic, cam } }, [mic, cam, live.connection])
  const audioBlocked = useAudioPlaybackBlocked(room)
  // When the browser blocks autoplay, the lesson sound starts on the next tap or key press instead of a separate button.
  useEffect(() => {
    if (!room || !(audioBlocked || audioUnlock)) return
    const unlock = () => { void room.startAudio().then(() => setAudioUnlock(false)).catch(() => {}) }
    window.addEventListener("pointerdown", unlock, true)
    window.addEventListener("keydown", unlock, true)
    return () => { window.removeEventListener("pointerdown", unlock, true); window.removeEventListener("keydown", unlock, true) }
  }, [room, audioBlocked, audioUnlock])
  const { unreadCount, notification, dismissNotification } = useChatNotifications({ lessonId: live.lessonId, userId: user.id, messages: snapshot?.messages, chatOpen: panel === "chat" })
  const activeLesson = snapshot?.lesson || lesson
  const subjectsEnabled = useFeature(FEATURE_IDS.ClassroomSubjects)
  const subjectName = subjectsEnabled ? activeLesson.subject?.name : undefined
  const meetingSubtitle = subjectName
    ? `${subjectName} · ${activeLesson.teacher.name} 선생님`
    : `${activeLesson.teacher.name} 선생님과 함께하는 화상 수업`
  const isHost = activeLesson.teacher.id === user.id
  const share = snapshot?.share
  const ownScreen = share?.ownerId === user.id && share.type === "screen" && !share.assistanceId
  const assistance = snapshot?.assistance
  const activeAssistance = currentAssistance(assistance) ? assistance : null
  // The student's screen is on stage (session active and its share showing).
  const mirroredShare = mirroringOnStage(snapshot)
  const instruction = snapshot?.instruction
  const phase = instruction?.phase
  // The server enters a mode before its popup opens; only highlight a mode once its share or request actually exists.
  const activeMode = phase === "classroom" && share && !share.assistanceId ? "classroom"
    : phase === "mirroring" && (activeAssistance || share?.assistanceId) ? "mirroring" : null
  const lessonModes = useFeature(FEATURE_IDS.ClassroomLessonModes)
  const assistanceSupported = useFeature(FEATURE_IDS.MeetingRemoteAssistance)
  const modeReady = live.appConnected && live.connection === ConnectionState.Connected &&
    snapshot?.participants.some(member => member.user.id === user.id && member.online)
  const canShare = !!snapshot && (phase === undefined || (isHost && phase === "classroom"))
  const showMaterials = isHost && canShare
  const subjectSwitchSupported = useFeature(FEATURE_IDS.ClassroomSubjectSwitch) && subjectsEnabled
  const [subjectPicker, setSubjectPicker] = useState(false)
  const { followLesson } = live
  const switchedNotice = useRef(props.switched)
  const textbookSupported = useFeature(FEATURE_IDS.ClassroomTextbookPicker)
  const textbookEnabled = showMaterials && textbookSupported
  const textbookLayout = textbookEnabled && share?.type === "document"
  const overlayQuery = `(max-width:${designLayout.meetingOverlayBreakpoint}px)`
  const [overlayPanel, setOverlayPanel] = useState(() => window.matchMedia(overlayQuery).matches)
  useEffect(() => {
    const media = window.matchMedia(overlayQuery)
    const update = () => setOverlayPanel(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [overlayQuery])
  const dockedTextbook = textbookLayout && panel === "content" && !overlayPanel
  // Wide owner screens keep participant videos and the materials card in a right rail; a panel replaces the card.
  const teacherRail = isHost && lessonModes && !!instruction && !overlayPanel
  const notesSupported = useFeature(notesFeature)
  const notesEnabled = notesSupported && (isHost || user.role === "student")
  const frame = useRef<SharedFrame>(null)
  const [frameReady, setFrameReady] = useState(false)
  const [capture, setCapture] = useState<{ shareId: string; page: number; draft: NoteDraft }>()
  const [captureBusy, setCaptureBusy] = useState(false)
  const [captureError, setCaptureError] = useState("")
  const [captureNotice, setCaptureNotice] = useState("")
  const captureUpload = useRef<AbortController | null>(null)
  useEffect(() => () => captureUpload.current?.abort(), [])
  const captureReady = !!(notesEnabled && live.admissionId && live.appConnected && live.connection === ConnectionState.Connected && share && !share.assistanceId && frameReady)
  const captureChanged = capture && (capture.shareId !== share?.id || capture.page !== share?.page || !!share.assistanceId)
  async function previewCapture() {
    if (!share || !captureReady || !frame.current || captureBusy) return
    setCaptureBusy(true); setCaptureError(""); setCaptureNotice("")
    try {
      const file = await frame.current.capture()
      setCapture({ shareId: share.id, page: share.page, draft: { file, requestId: crypto.randomUUID() } })
    } catch (error) { setError(friendlyError(error)) }
    finally { setCaptureBusy(false) }
  }
  async function saveCapture() {
    if (!capture || !live.admissionId || captureChanged || captureUpload.current) return
    const request = new AbortController()
    captureUpload.current = request
    setCaptureBusy(true); setCaptureError("")
    try {
      await uploadNote("saveClassNoteCapture", live.lessonId, capture.draft.file, capture.draft.requestId, {
        shareId: capture.shareId, page: String(capture.page), admissionId: live.admissionId,
      }, request.signal)
      setCapture(undefined); setCaptureNotice("화면을 저장했어요.")
    } catch (error) { if (!request.signal.aborted) setCaptureError(friendlyError(error)) }
    finally { captureUpload.current = null; if (!request.signal.aborted) setCaptureBusy(false) }
  }
  const raised = snapshot?.participants.find(person => person.user.id === user.id)?.raised || false
  const changePanel = useCallback((next: Panel) => {
    if (!next && panelRef.current?.contains(document.activeElement)) {
      const trigger = document.querySelector<HTMLButtonElement>('.call-controls [aria-controls="meeting-side-panel"][aria-expanded="true"]') || document.querySelector<HTMLButtonElement>('.call-controls [data-panel-trigger="more"]')
      trigger?.focus()
    }
    setPanel(next)
  }, [])
  useEffect(() => { if (panel) setLastPanel(panel) }, [panel])
  useEffect(() => {
    if (!showMaterials && panel === "content") changePanel(null)
  }, [changePanel, panel, showMaterials])
  useEffect(() => {
    if (!canShare) setShareConfirm(false)
  }, [canShare])
  useEffect(() => {
    if (phase !== "mirroring") setShowMirroringStudents(false)
  }, [phase])

  const openMode = (mode: LessonModeSetPayload["mode"], materials = false) => {
    if (materials) { changePanel("content"); return }
    changePanel(null)
    if (mode === "mirroring") setShowMirroringStudents(true)
    else if (!ownScreen || phase !== "classroom") setShareConfirm(true)
  }

  const updateInstruction = async (mode: LessonModeSetPayload["mode"], change?: LessonModeSetPayload, materials = false) => {
    if (!modeReady || modeBusy) return
    setModeBusy(true)
    try {
      let updated = change ? await command("lesson.mode.set", change) : await command("lesson.start")
      if (!change && mode === "mirroring" && updated.instruction?.phase === "classroom") {
        updated = await command("lesson.mode.set", { mode, expectedMode: "classroom", expectedShareId: null, expectedAssistanceId: null })
      }
      if (updated.instruction?.phase === mode) openMode(mode, materials)
    } catch (error) {
      setError(friendlyError(error))
    } finally { setModeBusy(false) }
  }

  /** `materials` opens the textbook panel instead of the mode's own popup once the mode is entered. */
  const selectMode = (mode: LessonModeSetPayload["mode"], materials = false) => {
    if (!modeReady || modeBusy) return
    if (phase === mode) {
      openMode(mode, materials)
      return
    }
    if (phase === "preparing") {
      void updateInstruction(mode, undefined, materials)
      return
    }
    if (phase !== "classroom" && phase !== "mirroring") return
    const change = { mode, expectedMode: phase, expectedShareId: share?.id ?? null,
      expectedAssistanceId: activeAssistance?.id ?? null }
    if (change.expectedShareId || change.expectedAssistanceId) setModeConfirm({ change, materials })
    else void updateInstruction(mode, change, materials)
  }
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") { changePanel(null); setShareConfirm(false); setEnd(false) } }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close) }, [changePanel])
  const participantControlsSupported = useFeature(FEATURE_IDS.MeetingParticipantControls)
  const snapshotParticipants = snapshot?.participants
  const participantControls = useMemo<ParticipantControlState | null>(() => participantControlsSupported && snapshotParticipants ? {
    viewerId: user.id, teacherId: activeLesson.teacher.id, lessonModes: phase !== undefined,
    annotationAllowed: id => snapshotParticipants.find(entry => entry.user.id === id)?.annotationAllowed ?? true,
    online: id => Boolean(snapshotParticipants.find(entry => entry.user.id === id)?.online),
    command, setMic: live.setMic, setCam: live.setCam, onError: setError,
  } : null, [participantControlsSupported, snapshotParticipants, user.id, activeLesson.teacher.id, phase, command, live.setMic, live.setCam, setError])
  // Students learn about annotation permission changes from the snapshot.
  const ownAnnotation = snapshotParticipants?.find(entry => entry.user.id === user.id)?.annotationAllowed
  const previousAnnotation = useRef(ownAnnotation)
  const { showNotice } = live
  notify.current = showNotice
  useEffect(() => {
    const previous = previousAnnotation.current
    previousAnnotation.current = ownAnnotation
    if (isHost || phase === undefined || previous === undefined || ownAnnotation === undefined || previous === ownAnnotation) return
    showNotice(ownAnnotation ? designContent.participantAnnotationAllowed : designContent.participantAnnotationRevoked)
  }, [ownAnnotation, isHost, phase, showNotice])
  // The owner's tab recording: the share picker ran in prejoin; writing starts once media is connected.
  const recording = useSyncExternalStore(subscribeRecording, recordingSnapshot)
  useEffect(() => { retainRecording(); return releaseRecording }, [])
  useEffect(() => {
    if (!room || !isHost) return
    const microphone = () => room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
    const sync = () => setRecordingMicrophone(microphone())
    if (live.connection === ConnectionState.Connected) void startRecording(live.lessonId, microphone())
    room.on(RoomEvent.LocalTrackPublished, sync).on(RoomEvent.LocalTrackUnpublished, sync)
    return () => { room.off(RoomEvent.LocalTrackPublished, sync).off(RoomEvent.LocalTrackUnpublished, sync) }
  }, [room, isHost, live.connection, live.lessonId])
  useEffect(() => { const notice = takeRecordingNotice(); if (notice) showNotice(notice) }, [recording.notice, showNotice])
  useEffect(() => {
    if (!switchedNotice.current || !activeLesson.subject) return
    switchedNotice.current = false
    showNotice(fillSubject(designContent.meetingSubjectSwitched, activeLesson.subject.name))
  }, [activeLesson.subject, showNotice])
  useEffect(() => {
    if (!recording.active) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [recording.active])
  const participants = useRoomParticipants(room)
  const speaking = useRemoteSpeaker(layout === "speaker" ? room : null, user.id)
  const featured = layout === "speaker" ? speaking || participants.find(person => person.identity === lesson.teacher.id) || room?.localParticipant : undefined
  const ordered = featured ? [featured, ...participants.filter(person => person !== featured)] : participants
  const roster = [activeLesson.teacher, ...activeLesson.students]
  const timerStart = instruction ? instruction.startedAt : activeLesson.startedAt
  const startedAt = timerStart ? Date.parse(timerStart) : now + live.serverOffset
  const elapsed = formatDuration((now + live.serverOffset - startedAt) / 1000)
  const connectionText = live.connection === ConnectionState.Connected ? live.appConnected ? designContent.meetingConnected : "수업 상태 재연결 중" : live.connection === ConnectionState.Reconnecting || live.connection === ConnectionState.SignalReconnecting ? "재연결 중" : live.connection === ConnectionState.Disconnected ? "연결 끊김" : "연결 중"
  const captureControl = notesEnabled && <button className="share-save" disabled={!captureReady || captureBusy} onClick={() => void previewCapture()}>{designContent.notesCapture}</button>
  return <main className={`meeting ${panel || teacherRail ? "has-panel" : ""} ${teacherRail ? "has-teacher-rail" : ""}`} data-testid="meeting">
    <header className="meeting-head"><div className="meeting-title-group"><span className="meeting-brand" aria-label="웅진 씽크빅"><BrandSymbol /></span><div><h1>{activeLesson.title}</h1><span className="meeting-subtitle">{meetingSubtitle}</span></div></div><div className="meeting-head-actions"><span className="call-connected" data-state={live.connection}><i />{connectionText}</span>{recording.active && <span className="recording-indicator" aria-label={designContent.recordingActive}><i /><span>{designContent.recordingActive}</span></span>}{phase !== "preparing" && <span className="meeting-timer"><Icon name="clock" size={16} />{elapsed}</span>}{!teacherRail && !share && <button className="layout-toggle" onClick={() => { captureLayout(); setLayout(layout === "grid" ? "speaker" : "grid") }} aria-label={layout === "grid" ? "발표자 보기로 전환" : "바둑판 보기로 전환"}><Icon name={layout === "grid" ? "screen" : "users"} size={18} /><span>{layout === "grid" ? "발표자 보기" : "바둑판 보기"}</span></button>}</div></header>
    {isHost && lessonModes && instruction && <div className="meeting-lesson-modes" role="group" aria-label={designContent.meetingLessonModesLabel}>
      <button aria-pressed={activeMode === "classroom"} aria-haspopup="dialog" disabled={!modeReady || modeBusy} onClick={() => selectMode("classroom")}>{designContent.meetingLessonClassroom}</button>
      <button aria-pressed={activeMode === "mirroring"} aria-haspopup="dialog" disabled={!modeReady || modeBusy || !assistanceSupported} onClick={() => selectMode("mirroring")}>{designContent.meetingLessonMirroring}</button>
    </div>}
    {live.notice && <div className="live-notice" role="status">{live.notice}</div>}
    {live.error && <div className="live-error" role="alert"><span>{live.error}</span><button aria-label="알림 닫기" onClick={() => setError("")}>닫기</button></div>}
    <ParticipantControlsContext.Provider value={participantControls}><div className="meeting-body"><div className="meeting-main">
      {/* The owner rail's stage guide shows a pending/preparing request and its cancel button itself. */}
      {/* While the student's screen is shared, the share bar alone carries the stop action; the guidance moves onto the stage. */}
      {!(teacherRail && !share) && !mirroredShare && <RemoteAssistanceStatus pointingReady={assistanceReady} snapshot={snapshot} userId={user.id} command={command} onError={setError} />}
      {share && <div className={`share-status-bar ${textbookLayout ? "is-textbook" : ""}`}><Icon name="screen" size={17} /><span>{share.type === "screen" ? `${roster.find(person => person.id === share.ownerId)?.name || "참여자"} 님의 화면 공유 중` : `${share.material?.name || "수업 자료"} 공유 중`}</span>{captureControl}{(isHost || share.ownerId === user.id) && <button onClick={() => { if (mirroredShare) void command("assistance.stop", { sessionId: mirroredShare.id }).catch(error => setError(friendlyError(error))); else void live.stopShare(share) }}>공유 중지</button>}</div>}
      <section className={`stage ${share ? "is-sharing" : ""}`} aria-label="수업 화면">
        {share && snapshot ? <div className="stage-view" key={share.id}><SharedStage textbookLayout={textbookLayout} dockedParticipants={dockedTextbook || teacherRail} captureControl={textbookLayout ? captureControl : undefined} user={user} snapshot={snapshot} room={room} command={command} previews={live.previews} sendPreview={live.sendPreview} remotePointer={live.remotePointer} sendAssistancePointer={live.sendAssistancePointer} assistanceConnected={live.appConnected && live.connection === ConnectionState.Connected} onAssistanceReady={setAssistanceReady} serverOffset={live.serverOffset} outputDevice={outputDevice} onError={setError} frameRef={notesEnabled ? frame : undefined} onFrameReady={notesEnabled ? setFrameReady : undefined} /></div> : teacherRail ? <TeacherStageGuide snapshot={snapshot} disabled={!modeReady || modeBusy} onShare={() => selectMode("classroom")} onPickStudent={() => selectMode("mirroring")} command={command} onError={setError} /> : <ParticipantGallery participants={ordered} layout={layout} gridRef={gridRef} renderParticipant={participant => { const person = roster.find(item => item.id === participant.identity); const entry = snapshot?.participants.find(item => item.user.id === participant.identity); return <VideoTile key={participant.identity} person={person?.name || participant.name || "참여자"} participant={participant} teacher={participant.identity === activeLesson.teacher.id} self={participant.identity === user.id} hand={entry?.raised} /> }} />}
      </section>
    </div><button className="panel-backdrop" aria-hidden={!panel} tabIndex={panel ? 0 : -1} aria-label="패널 닫기" onClick={() => changePanel(null)} /><div ref={panelRef} id="meeting-side-panel" className={`meeting-panel-container ${dockedTextbook || teacherRail ? "textbook-dock" : ""} ${teacherRail ? "teacher-rail" : ""} ${teacherRail && !panel ? "shows-materials" : ""}`} inert={!panel && !teacherRail} aria-hidden={!panel && !teacherRail}>
      {(dockedTextbook || teacherRail) && snapshot && <SharedParticipants snapshot={snapshot} user={user} room={room} docked rail={teacherRail && !panel} />}
      {teacherRail && !panel && <MaterialsCard textbookDisabled={!modeReady || modeBusy} onTextbook={() => selectMode("classroom", true)}
        subjectDisabled={!live.appConnected || activeLesson.status !== "LIVE"} onSubject={subjectSwitchSupported && props.onFollow ? () => setSubjectPicker(true) : undefined} />}
      <SidePanel panel={panel || lastPanel} activePanel={panel} textbookEnabled={textbookEnabled} textbookConnected={Boolean(modeReady)}
        onTextbookOpened={() => { if (window.matchMedia(overlayQuery).matches) changePanel(null) }}
        onSubject={isHost && subjectSwitchSupported && props.onFollow ? () => { changePanel(null); setSubjectPicker(true) } : undefined} setPanel={changePanel} user={user} lesson={activeLesson} room={room} snapshot={snapshot} command={command} onOutputChange={setOutputDevice} unreadChatCount={unreadCount} /></div></div>
    </ParticipantControlsContext.Provider>
    {notification && <ChatNotification message={notification} onOpen={() => changePanel("chat")} onDismiss={dismissNotification} />}
    <CallControls role={isHost ? "teacher" : "student"} raised={raised} setRaised={value => { void command("hand.set", { raised: value }).catch(e => setError(friendlyError(e))) }} panel={panel} setPanel={changePanel} mic={mic} cam={cam} setMic={value => void live.setMic(value)} setCam={value => void live.setCam(value)} participantCount={participants.length} screenSharing={ownScreen} showShare={phase === undefined && (canShare || ownScreen)} showMaterials={showMaterials && !teacherRail} onShareScreen={() => { if (ownScreen) void live.stopShare(share); else { changePanel(null); setShareConfirm(true) } }} onEnd={() => setEnd(true)} unreadChatCount={unreadCount} />
    <span className="sr-only" role="status">{captureNotice}</span>
    {notesEnabled && capture && <NoteDialog title={designContent.notesCapture} onClose={() => setCapture(undefined)} busy={captureBusy}>
      <NotePreview draft={capture.draft} label="저장할 수업 화면" />
      {isHost && <p>{designContent.notesShareNotice}</p>}
      {(captureChanged || captureError) && <p role="alert">{captureChanged ? designContent.notesShareChanged : captureError}</p>}
      <div className="note-actions"><button className="primary" disabled={captureBusy || !!captureChanged || !live.appConnected} onClick={() => void saveCapture()}>{captureBusy ? "저장 중…" : "저장하기"}</button></div>
    </NoteDialog>}
    <RemoteAudioTracks room={room} muted={outputDevice === "muted"} onBlocked={() => setAudioUnlock(true)} />
    <AnimatedPresence show={end}><Confirm title={isHost ? "모두의 수업을 종료할까요?" : "수업에서 나갈까요?"} copy={isHost ? "참여 중인 모든 사람의 수업이 함께 종료됩니다." : "다른 참여자는 수업을 계속할 수 있어요."} cancel={() => setEnd(false)} confirm={() => { setEnd(false); void live.leave() }} confirmText={isHost ? "모두 종료" : "수업 나가기"} /></AnimatedPresence>
    <AnimatedPresence show={modeConfirm !== null}><Confirm title={designContent.meetingLessonSwitchTitle} copy={designContent.meetingLessonSwitchCopy}
      cancel={() => setModeConfirm(null)} confirm={() => { if (modeConfirm) void updateInstruction(modeConfirm.change.mode, modeConfirm.change, modeConfirm.materials); setModeConfirm(null) }}
      confirmText={designContent.meetingLessonSwitchAction} /></AnimatedPresence>
    {subjectSwitchSupported && isHost && <SubjectSwitch lesson={activeLesson} open={subjectPicker} recording={recording.active} sharing={!!share || !!activeAssistance}
      onClose={() => setSubjectPicker(false)} onError={setError}
      onSwitched={next => { setSubjectPicker(false); showNotice(designContent.meetingSubjectSwitching); followLesson(next.id) }} />}
    <AnimatedPresence show={shareConfirm && canShare}><ScreenShareDialog cancel={() => setShareConfirm(false)} confirm={target => { setShareConfirm(false); void live.startScreen(target) }} /></AnimatedPresence>
    {showMirroringStudents && isHost && phase === "mirroring" && snapshot && <MirroringStudentDialog
      students={snapshot.participants.filter(member => member.online && member.user.role === "student" && member.user.id !== user.id).map(member => member.user)}
      connected={Boolean(modeReady)} blocked={activeAssistance ? designContent.meetingMirroringRequestInProgress : share ? designContent.remoteAssistStopShareFirst : undefined}
      onClose={() => setShowMirroringStudents(false)} onRequest={async studentId => { await command("assistance.request", { studentId }) }} />}
  </main>
}
function RemoteAudioTracks({ room, muted, onBlocked }: { room: Room | null; muted: boolean; onBlocked: () => void }) {
  const tracks = useRemoteAudioTracks(room)
  return <div hidden aria-hidden="true">{tracks.map(track => <RemoteAudio key={track.sid} track={track} muted={muted} onBlocked={onBlocked} />)}</div>
}
function RemoteAudio({ track, muted, onBlocked }: { track: AudioTrack; muted: boolean; onBlocked: () => void }) {
  const audio = useRef<HTMLAudioElement>(null)
  const blocked = useRef(onBlocked); blocked.current = onBlocked
  useEffect(() => { const element = audio.current; if (!element) return; track.attach(element); void element.play().catch(() => blocked.current()); return () => { track.detach(element) } }, [track])
  return <audio ref={audio} autoPlay muted={muted} data-testid="remote-audio" />
}
