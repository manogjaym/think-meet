import { useCallback, useEffect, useRef, useState } from "react"
import { Room, RoomEvent, ConnectionState, DisconnectReason } from "livekit-client"
import type { Socket } from "socket.io-client"
import { createAppSocket, emitVolatile, requestSocket } from "./socket"
import type { CommandAck as Ack, StrokePreview, RealtimeError, AssistancePointer } from "../generated/contracts"
import { SOCKET_EVENTS as Events } from "../generated/contracts"
import { api, ApiError, type ApiLesson, type JoinResult, type User } from "./api"
import type { JoinDevices } from "../screens/Join"
import { friendlyError, readDevicePreferences, type Command, type MeetingSnapshot, type PreviewStroke } from "./meeting"
import { useFeature } from "./useFeature"
import { getCapabilityState, isFeatureEnabled } from "./features"
import { activeAssistance, matchesAssistancePointer, REMOTE_POINTER_INTERVAL_MS, REMOTE_POINTER_TTL_MS, type RemotePointer } from "./remoteAssistance"
import { ScreenShareSession } from "./screenShare"

export function useMeeting({ lesson, user, initialDevices, admission, onEnded, onWaiting }: { lesson: ApiLesson; user: User; initialDevices: JoinDevices; admission?: JoinResult; onEnded: (reason?: string) => void; onWaiting?: () => void }) {
  const [room, setRoom] = useState<Room | null>(null)
  const [snapshot, setSnapshot] = useState<MeetingSnapshot | null>(null)
  const [connection, setConnection] = useState<ConnectionState>(ConnectionState.Connecting)
  const [error, setError] = useState("")
  const [appConnected, setAppConnected] = useState(false)
  const [admissionId, setAdmissionId] = useState<string>()
  const [previews, setPreviews] = useState<Record<string, PreviewStroke>>({})
  const [remotePointer, setRemotePointer] = useState<RemotePointer | null>(null)
  const assistanceEnabled = useFeature("meeting.remote-assistance")
  const remotePointerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const remotePointerSentAt = useRef(0)
  const [serverOffset, setServerOffset] = useState(0)
  const socketRef = useRef<Socket | null>(null)
  const snapshotRef = useRef<MeetingSnapshot | null>(null)
  const closing = useRef(false)
  const intentionalLeave = useRef(false)
  const mounted = useRef(false)
  const screenRef = useRef<ScreenShareSession | null>(null)
  const onEndedRef = useRef(onEnded)
  const onWaitingRef = useRef(onWaiting)
  onEndedRef.current = onEnded; onWaitingRef.current = onWaiting
  const options = useRef({ initialDevices, admission })
  const clearRemotePointer = useCallback(() => {
    clearTimeout(remotePointerTimer.current)
    setRemotePointer(null)
    remotePointerSentAt.current = 0
  }, [])
  const finish = useCallback((reason?: string) => {
    if (closing.current) return
    closing.current = true
    onEndedRef.current(reason)
  }, [])
  const accept = useCallback((value: MeetingSnapshot) => {
    if (value.lessonId !== lesson.id || !mounted.current) return
    if (snapshotRef.current && value.seq < snapshotRef.current.seq) return
    snapshotRef.current = value
    screenRef.current?.observeShare(value.share, !value.instruction ||
      (value.instruction.phase === "classroom" && value.lesson.teacher.id === user.id))
    setRemotePointer(current => current && matchesAssistancePointer(current, value) ? current : null)
    setSnapshot(value)
    setPreviews({})
    setServerOffset(Date.parse(value.serverTime) - Date.now())
    if (value.lesson.status === "ENDED") finish("ended")
    else if (value.lesson.status === "CANCELLED") finish("cancelled")
  }, [lesson.id, user.id, finish])
  const command = useCallback<Command>(async (type, payload = {}, expectedShareId) => {
    const socket = socketRef.current
    if (!socket?.connected) throw new Error("수업 연결을 복구하고 있어요. 연결 후 다시 시도해 주세요.")
    const ack = await requestSocket<Ack>(socket, Events.Command, { lessonId: lesson.id, type, payload, requestId: crypto.randomUUID(), expectedShareId })
    if (!ack?.ok) throw new ApiError(400, ack?.error?.code || "COMMAND_FAILED", ack?.error?.message || "요청에 실패했어요.")
    if (socketRef.current === socket) accept(ack.snapshot)
    return ack.snapshot
  }, [lesson.id, accept])
  useEffect(() => {
    mounted.current = true; closing.current = false
    let cancelled = false
    let connectedRoom: Room | null = null
    let screen: ScreenShareSession | null = null
    const socket = createAppSocket({ transports: ["websocket", "polling"], autoConnect: false })
    socketRef.current = socket
    const subscribe = () => {
      if (cancelled || !socket.connected) return
      void requestSocket<Ack>(socket, Events.Subscribe, { lessonId: lesson.id }).then(ack => {
        if (cancelled) return
        if (ack?.ok) {
          if (socket.connected) { accept(ack.snapshot); setAppConnected(true); screen?.controlReconnected() }
        }
        else if (ack?.error) { if (["KICKED", "NOT_INVITED", "ACCOUNT", "ENDED", "CANCELLED"].includes(ack.error.code)) finish(ack.error.code.toLowerCase()); else setError(ack.error.message) }
      }).catch(error => { if (!cancelled) setError(friendlyError(error)) })
    }
    socket.on("connect", subscribe)
    socket.on("disconnect", () => { if (!cancelled) { setAppConnected(false); clearRemotePointer() } })
    socket.on("connect_error", () => { if (!cancelled) { setAppConnected(false); clearRemotePointer() } })
    socket.on(Events.Snapshot, accept)
    socket.on(Events.SessionReplaced, (event: { lessonId: string }) => { if (event.lessonId === lesson.id) finish("replaced") })
    socket.on(Events.RoomError, (event: RealtimeError) => {
      if (["KICKED", "ENDED", "CANCELLED", "SESSION_REPLACED", "REPLACED"].includes(event.code)) finish(event.code.toLowerCase())
      else setError(event.message)
    })
    socket.on(Events.StrokePreview, (value: StrokePreview) => {
      if (value.lessonId !== lesson.id || value.authorId === user.id || !value.authorId) return
      setPreviews(current => ({ ...current, [value.authorId!]: value }))
    })
    const start = async () => {
      try {
        const join = options.current.admission || await api<JoinResult>(`/lessons/${lesson.id}/join`, { method: "POST" })
        if (cancelled) return
        if (join.waiting) { onWaitingRef.current?.(); return }
        if (!join.token || !join.livekitUrl) throw new Error("수업 연결 정보를 받지 못했어요.")
        const devices = options.current.initialDevices
        const nextRoom = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true,
          audioCaptureDefaults: { deviceId: devices.microphoneId || undefined, noiseSuppression: devices.noise ?? true, echoCancellation: true },
          videoCaptureDefaults: { deviceId: devices.cameraId || undefined, resolution: { width: 1280, height: 720 } },
          audioOutput: devices.speakerId && devices.speakerId !== "muted" ? { deviceId: devices.speakerId } : undefined,
        })
        connectedRoom = nextRoom
        screen = new ScreenShareSession(nextRoom, user.id, {
          start: async () => (await command("share.start", { type: "screen" })).share,
          stop: id => command("share.stop", {}, id),
          connected: () => socket.connected && !closing.current,
          guardedStop: () => {
            const capabilities = getCapabilityState()
            return capabilities.status === "ready" && (capabilities.response?.contractRevision ?? 0) >= 5
          },
          report: error => { if (!cancelled) setError(friendlyError(error)) },
        })
        screenRef.current = screen
        screen.observeShare(snapshotRef.current?.share)
        nextRoom.on(RoomEvent.ConnectionStateChanged, state => { if (!cancelled) { setConnection(state); if (state !== ConnectionState.Connected) clearRemotePointer() } })
        nextRoom.on(RoomEvent.Disconnected, reason => {
          if (cancelled || closing.current || intentionalLeave.current) return
          if (reason === DisconnectReason.DUPLICATE_IDENTITY) finish("replaced")
          else if (reason === DisconnectReason.PARTICIPANT_REMOVED) finish("kicked")
          else if (reason === DisconnectReason.ROOM_DELETED) finish("ended")
          else finish("failed")
        })
        nextRoom.on(RoomEvent.Reconnected, () => { subscribe(); screen?.mediaReconnected() })
        nextRoom.on(RoomEvent.MediaDevicesError, e => { if (!cancelled) setError(`장치를 사용할 수 없어요. ${friendlyError(e)}`) })
        nextRoom.on(RoomEvent.LocalTrackPublished, ({ source, track }) => screen?.published(source, track))
        setRoom(nextRoom)
        socket.connect()
        // Optional localhost development proxy uses the server's trusted local CA.
        // Production always connects to the admission URL supplied by the API.
        const livekitUrl = import.meta.env.DEV && import.meta.env.VITE_THINK_MEET_LIVEKIT_PROXY === "true"
          ? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/livekit`
          : join.livekitUrl
        await nextRoom.connect(livekitUrl, join.token)
        if (cancelled) { await nextRoom.disconnect(); return }
        await api(`/lessons/${lesson.id}/connected`, { method: "POST" })
        if (!cancelled) setAdmissionId(join.admissionId)
        const results = await Promise.allSettled([
          nextRoom.localParticipant.setMicrophoneEnabled(devices.mic),
          nextRoom.localParticipant.setCameraEnabled(devices.cam),
        ])
        if (cancelled) return
        const failed = results.find(result => result.status === "rejected")
        if (failed?.status === "rejected") setError(`카메라 또는 마이크를 켜지 못했어요. 설정에서 다시 선택해 주세요. ${friendlyError(failed.reason)}`)
        accept(await api<MeetingSnapshot>(`/lessons/${lesson.id}/snapshot`))
      } catch (e) {
        if (cancelled) return
        if (e instanceof ApiError && ["KICKED", "NOT_INVITED", "ACCOUNT", "CANCELLED", "ENDED"].includes(e.code)) finish(e.code.toLowerCase())
        else { setError(friendlyError(e)); finish("failed") }
      }
    }
    void start()
    const poll = window.setInterval(() => {
      if (!closing.current) void api<MeetingSnapshot>(`/lessons/${lesson.id}/snapshot`).then(accept).catch(e => {
        if (e instanceof ApiError && e.code === "KICKED") finish("kicked")
      })
    }, 12000)
    return () => {
      cancelled = true; mounted.current = false; socket.disconnect(); socketRef.current = null; window.clearInterval(poll)
      clearTimeout(remotePointerTimer.current)
      screen?.close(); screenRef.current = null
      if (connectedRoom) { connectedRoom.removeAllListeners(); void connectedRoom.disconnect(true) }
    }
  }, [lesson.id, user.id, accept, finish, clearRemotePointer, command])

  useEffect(() => { if (!assistanceEnabled) clearRemotePointer() }, [assistanceEnabled, clearRemotePointer])

  const setMic = async (enabled: boolean) => {
    try { await room?.localParticipant.setMicrophoneEnabled(enabled, { deviceId: readDevicePreferences().microphoneId || undefined, noiseSuppression: readDevicePreferences().noise ?? true, echoCancellation: true }) } catch(e) { setError(friendlyError(e)) }
  }
  const setCam = async (enabled: boolean) => {
    try { await room?.localParticipant.setCameraEnabled(enabled, { deviceId: readDevicePreferences().cameraId || undefined }) } catch(e) { setError(friendlyError(e)) }
  }
  const startScreen = async (target: "browser" | "screen") => {
    if (!room || room.state !== ConnectionState.Connected) { setError("수업 연결 후 화면을 공유해 주세요."); return }
    if (!navigator.mediaDevices?.getDisplayMedia) { setError("이 브라우저는 화면 공유를 지원하지 않아요. PC의 Chrome 또는 Edge에서 공유해 주세요."); return }
    await screenRef.current?.start(target)
  }
  const stopShare = (share: MeetingSnapshot["share"]) => screenRef.current?.stop(share)
  const leave = async () => {
    const isHost = (snapshotRef.current?.lesson || lesson).teacher.id === user.id
    intentionalLeave.current = true
    try {
      await api(`/lessons/${lesson.id}/${isHost ? "end" : "leave"}`, { method: "POST" })
      await room?.disconnect(true)
      finish(isHost ? "ended" : "left")
    } catch(e) { intentionalLeave.current = false; setError(friendlyError(e)) }
  }
  const sendPreview = (preview: PreviewStroke) => {
    const socket = socketRef.current
    if (socket) emitVolatile(socket, Events.StrokePreview, { lessonId: lesson.id, ...preview })
  }
  const sendAssistancePointer = useCallback((x: number, y: number) => {
    const socket = socketRef.current
    const current = snapshotRef.current
    const session = activeAssistance(current)
    if (!socket?.connected || !session?.geometry || session.teacherId !== user.id || !isFeatureEnabled("meeting.remote-assistance")) return
    const now = Date.now()
    if (now - remotePointerSentAt.current < REMOTE_POINTER_INTERVAL_MS) return
    const frame: AssistancePointer = { lessonId: lesson.id, sessionId: session.id, shareId: session.shareId!, geometryVersion: session.geometry.version, x, y, authorId: user.id }
    if (!matchesAssistancePointer(frame, current)) return
    remotePointerSentAt.current = now
    // Pulse frames never wait for capabilities or reconnect, and never enter the command log.
    emitVolatile(socket, Events.AssistancePointer, { ...frame })
    clearTimeout(remotePointerTimer.current)
    setRemotePointer({ ...frame, receivedAt: now })
    remotePointerTimer.current = setTimeout(() => setRemotePointer(null), REMOTE_POINTER_TTL_MS)
  }, [lesson.id, user.id])
  return { room, snapshot, connection, error, setError, appConnected, admissionId, previews, remotePointer, sendAssistancePointer, serverOffset, command, setMic, setCam, startScreen, stopShare, leave, sendPreview }
}
