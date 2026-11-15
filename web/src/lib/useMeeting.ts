import { useCallback, useEffect, useRef, useState } from "react"
import { Room, RoomEvent, Track, ConnectionState, DisconnectReason, type LocalTrackPublication } from "livekit-client"
import type { Socket } from "socket.io-client"
import { createAppSocket, emitVolatile, requestSocket } from "./socket"
import type { CommandAck as Ack, StrokePreview, RealtimeError } from "../generated/contracts"
import { SOCKET_EVENTS as Events } from "../generated/contracts"
import { api, ApiError, type ApiLesson, type JoinResult, type User } from "./api"
import type { JoinDevices } from "../screens/Join"
import { friendlyError, readDevicePreferences, type Command, type MeetingSnapshot, type PreviewStroke } from "./meeting"

export function useMeeting({ lesson, user, initialDevices, admission, onEnded, onWaiting }: { lesson: ApiLesson; user: User; initialDevices: JoinDevices; admission?: JoinResult; onEnded: (reason?: string) => void; onWaiting?: () => void }) {
  const [room, setRoom] = useState<Room | null>(null)
  const [snapshot, setSnapshot] = useState<MeetingSnapshot | null>(null)
  const [connection, setConnection] = useState<ConnectionState>(ConnectionState.Connecting)
  const [error, setError] = useState("")
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [appConnected, setAppConnected] = useState(false)
  const [revision, setRevision] = useState(0)
  const [previews, setPreviews] = useState<Record<string, PreviewStroke>>({})
  const [serverOffset, setServerOffset] = useState(0)
  const socketRef = useRef<Socket | null>(null)
  const snapshotRef = useRef<MeetingSnapshot | null>(null)
  const closing = useRef(false)
  const intentionalLeave = useRef(false)
  const mounted = useRef(false)
  const screenStarting = useRef(false)
  const onEndedRef = useRef(onEnded)
  const onWaitingRef = useRef(onWaiting)
  onEndedRef.current = onEnded; onWaitingRef.current = onWaiting
  const options = useRef({ initialDevices, admission })
  const finish = useCallback((reason?: string) => {
    if (closing.current) return
    closing.current = true
    onEndedRef.current(reason)
  }, [])
  const accept = useCallback((value: MeetingSnapshot) => {
    if (value.lessonId !== lesson.id || !mounted.current) return
    if (snapshotRef.current && value.seq < snapshotRef.current.seq) return
    snapshotRef.current = value
    setSnapshot(value)
    setPreviews({})
    setServerOffset(Date.parse(value.serverTime) - Date.now())
    if (value.lesson.status === "ENDED") finish("ended")
    else if (value.lesson.status === "CANCELLED") finish("cancelled")
  }, [lesson.id, finish])
  const command = useCallback<Command>(async (type, payload = {}) => {
    const socket = socketRef.current
    if (!socket?.connected) throw new Error("수업 연결을 복구하고 있어요. 연결 후 다시 시도해 주세요.")
    const ack = await requestSocket<Ack>(socket, Events.Command, { lessonId: lesson.id, type, payload, requestId: crypto.randomUUID() })
    if (!ack?.ok) throw new ApiError(400, ack?.error?.code || "COMMAND_FAILED", ack?.error?.message || "요청에 실패했어요.")
    accept(ack.snapshot)
    return ack.snapshot
  }, [lesson.id, accept])
  const commandRef = useRef(command); commandRef.current = command

  useEffect(() => {
    mounted.current = true; closing.current = false
    let cancelled = false
    let connectedRoom: Room | null = null
    const socket = createAppSocket({ transports: ["websocket", "polling"], autoConnect: false })
    socketRef.current = socket
    const subscribe = () => {
      if (cancelled) return
      setAppConnected(true)
      void requestSocket<Ack>(socket, Events.Subscribe, { lessonId: lesson.id }).then(ack => {
        if (cancelled) return
        if (ack?.ok) accept(ack.snapshot)
        else if (ack?.error) { if (["KICKED", "NOT_INVITED", "ACCOUNT", "ENDED", "CANCELLED"].includes(ack.error.code)) finish(ack.error.code.toLowerCase()); else setError(ack.error.message) }
      }).catch(error => { if (!cancelled) setError(friendlyError(error)) })
    }
    socket.on("connect", subscribe)
    socket.on("disconnect", () => { if (!cancelled) setAppConnected(false) })
    socket.on("connect_error", () => { if (!cancelled) setAppConnected(false) })
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
        const refresh = () => { if (!cancelled) { setRevision(value => value + 1); setAudioBlocked(!nextRoom.canPlaybackAudio) } }
        nextRoom.on(RoomEvent.ConnectionStateChanged, state => { if (!cancelled) setConnection(state) })
        nextRoom.on(RoomEvent.Disconnected, reason => {
          refresh()
          if (cancelled || closing.current || intentionalLeave.current) return
          if (reason === DisconnectReason.DUPLICATE_IDENTITY) finish("replaced")
          else if (reason === DisconnectReason.PARTICIPANT_REMOVED) finish("kicked")
          else if (reason === DisconnectReason.ROOM_DELETED) finish("ended")
          else finish("failed")
        })
        nextRoom.on(RoomEvent.TrackSubscribed, refresh).on(RoomEvent.TrackUnsubscribed, refresh)
          .on(RoomEvent.TrackMuted, refresh).on(RoomEvent.TrackUnmuted, refresh)
          .on(RoomEvent.LocalTrackPublished, refresh).on(RoomEvent.ParticipantConnected, refresh)
          .on(RoomEvent.ParticipantDisconnected, refresh).on(RoomEvent.ActiveSpeakersChanged, refresh)
          .on(RoomEvent.AudioPlaybackStatusChanged, refresh).on(RoomEvent.Reconnected, () => { subscribe(); refresh() })
        nextRoom.on(RoomEvent.MediaDevicesError, e => { if (!cancelled) setError(`장치를 사용할 수 없어요. ${friendlyError(e)}`) })
        nextRoom.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
          refresh()
          if (publication.source === Track.Source.ScreenShare && snapshotRef.current?.share?.type === "screen" && snapshotRef.current.share.ownerId === user.id && !closing.current && !screenStarting.current) {
            void commandRef.current("share.stop").catch(e => { if (!cancelled) setError(friendlyError(e)) })
          }
        })
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
        const results = await Promise.allSettled([
          nextRoom.localParticipant.setMicrophoneEnabled(devices.mic),
          nextRoom.localParticipant.setCameraEnabled(devices.cam),
        ])
        if (cancelled) return
        const failed = results.find(result => result.status === "rejected")
        if (failed?.status === "rejected") setError(`카메라 또는 마이크를 켜지 못했어요. 설정에서 다시 선택해 주세요. ${friendlyError(failed.reason)}`)
        refresh()
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
      if (connectedRoom) { connectedRoom.removeAllListeners(); void connectedRoom.disconnect(true) }
    }
  }, [lesson.id, user.id, accept, finish])

  useEffect(() => {
    if (!room || screenStarting.current) return
    if (room.localParticipant.isScreenShareEnabled && (snapshot?.share?.ownerId !== user.id || snapshot.share.type !== "screen")) {
      void room.localParticipant.setScreenShareEnabled(false).catch(() => undefined)
    }
  }, [snapshot?.share?.id, snapshot?.share?.ownerId, room, user.id])

  const setMic = async (enabled: boolean) => {
    try { await room?.localParticipant.setMicrophoneEnabled(enabled, { deviceId: readDevicePreferences().microphoneId || undefined, noiseSuppression: readDevicePreferences().noise ?? true, echoCancellation: true }); setRevision(value => value + 1) } catch(e) { setError(friendlyError(e)) }
  }
  const setCam = async (enabled: boolean) => {
    try { await room?.localParticipant.setCameraEnabled(enabled, { deviceId: readDevicePreferences().cameraId || undefined }); setRevision(value => value + 1) } catch(e) { setError(friendlyError(e)) }
  }
  const startScreen = async (target: "browser" | "screen") => {
    if (!room || room.state !== ConnectionState.Connected) { setError("수업 연결 후 화면을 공유해 주세요."); return }
    if (!navigator.mediaDevices?.getDisplayMedia) { setError("이 브라우저는 화면 공유를 지원하지 않아요. PC의 Chrome 또는 Edge에서 공유해 주세요."); return }
    screenStarting.current = true
    try {
      await room.localParticipant.setScreenShareEnabled(true, { audio: true, video: { displaySurface: target === "browser" ? "browser" : "monitor" }, systemAudio: "include", surfaceSwitching: "include" })
      await command("share.start", { type: "screen" })
    } catch(e) {
      await room.localParticipant.setScreenShareEnabled(false).catch(() => undefined)
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) setError(friendlyError(e))
    } finally { screenStarting.current = false; setRevision(value => value + 1) }
  }
  const stopShare = async () => {
    try {
      await command("share.stop")
      if (room?.localParticipant.isScreenShareEnabled) await room.localParticipant.setScreenShareEnabled(false)
    } catch(e) { setError(friendlyError(e)) }
  }
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
  return { room, snapshot, connection, error, setError, audioBlocked, appConnected, revision, previews, serverOffset, command, setMic, setCam, startScreen, stopShare, leave, sendPreview }
}
