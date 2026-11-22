import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { Track, type Room, type VideoTrack } from "livekit-client"
import type { PDFDocumentProxy } from "pdfjs-dist"
import { loadMaterialPdf } from "./pdfDocument"
import type { User } from "../../lib/api"
import { formatDuration, friendlyError, materialContentUrl, type Command, type MeetingSnapshot, type Point, type PreviewStroke, type Stroke } from "../../lib/meeting"
import { Confirm, Icon } from "../ui"
import { AnimatedPresence } from "../AnimatedPresence"
import { VideoTile } from "./VideoTile"
import { ParticipantPagination, useParticipantArea, useParticipantPagination } from "./ParticipantPagination"
import designLayout from "../../generated/design-layout.json"
import { designContent } from "../../generated/design-content"
import { useFeature } from "../../lib/useFeature"
import { activeAssistance, assistancePoint, geometryMatchesVideo, matchesAssistancePointer, REMOTE_POINTER_TTL_MS, type RemotePointer } from "../../lib/remoteAssistance"
import { useParticipantTrack, useRoomParticipants } from "../../lib/livekitMedia"

import { captureSharedFrame } from "./captureSharedFrame"
import { FEATURE_IDS } from "../../generated/feature-policy"

export type SharedFrame = { capture: () => Promise<Blob> }

const colors = ["#1f2937", "#ef6461", "#f2b84b", "#4f9d76", "#4386d8", "#8b6bc1"]
const pathFor = (points: Point[]) => points.map((point, index) => `${index ? "L" : "M"}${point.x * 1000},${point.y * 1000}`).join(" ")
type Props = { user: User; snapshot: MeetingSnapshot; room: Room | null; command: Command; previews: Record<string, PreviewStroke>; sendPreview: (stroke: PreviewStroke) => void; remotePointer?: RemotePointer | null; sendAssistancePointer?: (x: number, y: number) => void; assistanceConnected?: boolean; onAssistanceReady?: (ready: boolean) => void; serverOffset: number; outputDevice: string; onError: (message: string) => void; frameRef?: Ref<SharedFrame>; onFrameReady?: (ready: boolean) => void; textbookLayout?: boolean; dockedParticipants?: boolean; captureControl?: ReactNode }
export function SharedStage({ user, snapshot, room, command, previews, sendPreview, remotePointer, sendAssistancePointer, assistanceConnected = false, onAssistanceReady, serverOffset, outputDevice, onError, frameRef, onFrameReady, textbookLayout = false, dockedParticipants = false, captureControl }: Props) {
  const share = snapshot.share!
  const [tool, setTool] = useState<"pen" | "highlighter" | "eraser">("pen")
  const [annotating, setAnnotating] = useState(false)
  const [color, setColor] = useState(colors[1])
  const [zoom, setZoom] = useState(1)
  const [pages, setPages] = useState(share.material?.pages || 1)
  const [natural, setNatural] = useState({ w: 1280, h: 720 })
  const [screenDimensions, setScreenDimensions] = useState({ w: 0, h: 0 })
  const [settledGeometryKey, setSettledGeometryKey] = useState("")
  const assistanceEnabled = useFeature(FEATURE_IDS.MeetingRemoteAssistance)
  const [available, setAvailable] = useState({ w: 800, h: 500 })
  const [loading, setLoading] = useState(false)
  const [renderedPage, setRenderedPage] = useState<number>()
  const [videoReady, setVideoReady] = useState(false)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [position, setPosition] = useState(share.position || 0)
  const [duration, setDuration] = useState(share.material?.duration || 0)
  const [draft, setDraft] = useState<PreviewStroke | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [controlPending, setControlPending] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pdf = useRef<PDFDocumentProxy | null>(null)
  const drawing = useRef<PreviewStroke | null>(null)
  const previewAt = useRef(0)
  const erasePending = useRef(new Set<string>())
  const pointing = useRef<{ pointerId: number; point: Point | null } | null>(null)
  const pointingTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const pointerSender = useRef(sendAssistancePointer)
  pointerSender.current = sendAssistancePointer
  const stopPointing = useCallback(() => {
    clearInterval(pointingTimer.current)
    pointingTimer.current = undefined
    pointing.current = null
  }, [])
  const strokes = snapshot.strokes.filter(stroke => stroke.shareId === share.id && stroke.page === share.page && !stroke.deleted)
  const canControl = snapshot.lesson.teacher.id === user.id
  // Missing value means an older server, which allows everyone to annotate.
  const canAnnotate = canControl || (snapshot.participants.find(entry => entry.user.id === user.id)?.annotationAllowed ?? true)
  const drawingActive = annotating && canAnnotate
  useEffect(() => { if (!canAnnotate) { setAnnotating(false); drawing.current = null; setDraft(null) } }, [canAnnotate])
  const assistance = activeAssistance(snapshot)
  const remoteActive = Boolean(assistance)
  const geometryKey = assistance ? `${assistance.id}:${assistance.geometry?.version}` : ""
  const canPoint = Boolean(assistanceEnabled && canControl && assistanceConnected && sendAssistancePointer && assistance && settledGeometryKey === geometryKey && geometryMatchesVideo(assistance.geometry, screenDimensions.w, screenDimensions.h))
  useEffect(() => {
    stopPointing()
    window.addEventListener("blur", stopPointing)
    document.addEventListener("visibilitychange", stopPointing)
    return () => {
      stopPointing()
      window.removeEventListener("blur", stopPointing)
      document.removeEventListener("visibilitychange", stopPointing)
    }
  }, [canPoint, geometryKey, stopPointing])
  const scale = Math.min(available.w / natural.w, available.h / natural.h) * (share.type === "document" ? zoom : 1)
  const width = Math.max(1, natural.w * scale), height = Math.max(1, natural.h * scale)
  const participants = useRoomParticipants(room)
  const owner = share.type === "screen" ? participants.find(person => person.identity === share.ownerId) : undefined
  const screenTrack = useParticipantTrack(owner, Track.Source.ScreenShare).track as VideoTrack | undefined
  const frameReady = !share.assistanceId && (share.type === "document" ? renderedPage === share.page : videoReady && (share.type !== "screen" || !!screenTrack))
  useImperativeHandle(frameRef, () => ({ capture() {
    const source = share.type === "document" ? canvasRef.current : videoRef.current
    if (!frameReady || !source || source instanceof HTMLVideoElement && (source.readyState < 2 || source.seeking)) throw new Error("공유 화면을 불러오는 중이에요.")
    return captureSharedFrame(source, strokes, width)
  } }), [frameReady, share.type, strokes, width])
  useEffect(() => {
    onFrameReady?.(frameReady)
    return () => onFrameReady?.(false)
  }, [frameReady, onFrameReady])
  const execute = async (type: string, payload?: Record<string, unknown>) => {
    setControlPending(true)
    try { await command(type, payload) } catch(e) { onError(friendlyError(e)) } finally { setControlPending(false) }
  }
  const measureVideo = (video: HTMLVideoElement) => {
    if (share.type !== "screen" || !video.videoWidth || !video.videoHeight) return
    setScreenDimensions({ w: video.videoWidth, h: video.videoHeight })
    setNatural({ w: video.videoWidth, h: video.videoHeight })
  }
  useEffect(() => {
    if (!remoteActive) return
    setAnnotating(false); setDraft(null); drawing.current = null
  }, [remoteActive])
  useEffect(() => {
    setSettledGeometryKey("")
    if (!assistance) return
    // Same-aspect rotations need a grace period too; dimensions alone cannot identify their frame.
    const timer = window.setTimeout(() => setSettledGeometryKey(geometryKey), 500)
    return () => window.clearTimeout(timer)
  }, [geometryKey])
  useEffect(() => {
    onAssistanceReady?.(canPoint)
    return () => onAssistanceReady?.(false)
  }, [canPoint, onAssistanceReady])
  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    const resize = () => { const style = getComputedStyle(element); setAvailable({ w: Math.max(100, element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)), h: Math.max(100, element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) }) }
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect()
  }, [])
  useEffect(() => { setDraft(null); drawing.current = null; setZoom(1); setAutoplayBlocked(false); setScreenDimensions({ w: 0, h: 0 }) }, [share.id])
  useEffect(() => {
    if (share.type !== "screen") return
    const video = videoRef.current
    if (!video || !screenTrack) return
    setVideoReady(false)
    screenTrack.attach(video)
    measureVideo(video)
    return () => { screenTrack.detach(video) }
  }, [share.type, screenTrack])
  useEffect(() => {
    if (share.type !== "document" || !share.materialId) return
    let cancelled = false
    setLoading(true)
    const task = loadMaterialPdf(share.materialId, snapshot.lessonId)
    void task.promise.then(document => { if (cancelled) return; pdf.current = document; setPages(document.numPages); setLoading(false) }).catch(e => { if (!cancelled) { setLoading(false); onError(`PDF를 열지 못했어요. ${friendlyError(e)}`) } })
    return () => { cancelled = true; pdf.current = null; void task.destroy() }
  }, [share.id, share.materialId, share.type, snapshot.lessonId, onError])
  useEffect(() => {
    const document = pdf.current
    const canvas = canvasRef.current
    if (!document || !canvas || loading) return
    let cancelled = false
    let cancelRender: (() => void) | undefined
    setRenderedPage(undefined)
    void document.getPage(Math.max(1, Math.min(document.numPages, share.page))).then(page => {
      if (cancelled) return
      const original = page.getViewport({ scale: 1 })
      setNatural(current => current.w === original.width && current.h === original.height ? current : { w: original.width, h: original.height })
      const pageScale = Math.min(available.w / original.width, available.h / original.height) * zoom
      const viewport = page.getViewport({ scale: pageScale * Math.min(window.devicePixelRatio || 1, 2) })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const render = page.render({ canvas, viewport })
      cancelRender = () => render.cancel()
      return render.promise.then(() => { if (!cancelled) setRenderedPage(share.page) })
    }).catch(e => { if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) onError(friendlyError(e)) })
    return () => { cancelled = true; cancelRender?.() }
  }, [share.page, share.id, loading, available.w, available.h, zoom, onError])

  const syncVideo = useCallback(() => {
    const video = videoRef.current
    if (!video || share.type !== "media" || !video.readyState) return
    const elapsed = share.playing ? Math.max(0, (Date.now() + serverOffset - Date.parse(share.updatedAt)) / 1000) : 0
    const expected = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, share.position + elapsed))
    if (Math.abs(video.currentTime - expected) > .65) video.currentTime = expected
    if (share.playing && expected < video.duration) { if (video.paused) void video.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true)) }
    else if (!video.paused) video.pause()
  }, [share.type, share.playing, share.position, share.updatedAt, serverOffset])
  useEffect(() => { syncVideo(); const interval = window.setInterval(syncVideo, 800); return () => window.clearInterval(interval) }, [syncVideo])
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = share.type === "screen" || outputDevice === "muted"
    if (share.type === "media" && outputDevice !== "muted" && "setSinkId" in video) void video.setSinkId(outputDevice || "default").catch(e => onError(friendlyError(e)))
  }, [share.type, outputDevice, onError])

  const pointAt = (event: ReactPointerEvent<SVGSVGElement>): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  const eraseAt = (point: Point) => {
    const ids = strokes.filter(stroke => (canControl || stroke.authorId === user.id) && !erasePending.current.has(stroke.id) && stroke.points.some(p => Math.hypot(p.x - point.x, (p.y - point.y) * height / width) < .02)).map(stroke => stroke.id)
    if (!ids.length) return
    ids.forEach(id => erasePending.current.add(id))
    void command("stroke.erase", { ids }).catch(e => onError(friendlyError(e))).finally(() => ids.forEach(id => erasePending.current.delete(id)))
  }
  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (remoteActive) {
      if (!canPoint || event.button !== 0 || pointing.current) return
      event.preventDefault()
      const point = assistancePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
      if (!point) return
      event.currentTarget.setPointerCapture(event.pointerId)
      pointing.current = { pointerId: event.pointerId, point }
      pointerSender.current?.(point.x, point.y)
      // Refresh the student's existing expiry even while the held pointer is stationary.
      pointingTimer.current = setInterval(() => {
        const point = pointing.current?.point
        if (point) pointerSender.current?.(point.x, point.y)
      }, 250)
      return
    }
    if (!drawingActive || event.button !== 0) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointAt(event)
    if (tool === "eraser") { eraseAt(point); return }
    drawing.current = { shareId: share.id, page: share.page, tool, color, points: [point] }
    setDraft({ ...drawing.current })
  }
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (remoteActive) {
      const current = pointing.current
      if (!current || current.pointerId !== event.pointerId) return
      if (!canPoint || !(event.buttons & 1)) { stopPointing(); return }
      event.preventDefault()
      current.point = assistancePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
      if (current.point) pointerSender.current?.(current.point.x, current.point.y)
      return
    }
    if (!drawingActive || !(event.buttons & 1)) return
    const point = pointAt(event)
    if (tool === "eraser") { eraseAt(point); return }
    const current = drawing.current
    if (!current || current.points.length >= 2048) return
    const previous = current.points[current.points.length - 1]
    if (Math.hypot(previous.x - point.x, previous.y - point.y) < .001) return
    current.points.push(point); setDraft({ ...current, points: [...current.points] })
    if (Date.now() - previewAt.current > 80) { sendPreview({ ...current, points: current.points.slice(-256) }); previewAt.current = Date.now() }
  }
  const end = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pointing.current?.pointerId === event.pointerId) stopPointing()
    const current = drawing.current
    drawing.current = null
    if (!current) return
    if (current.points.length === 1) current.points.push({ x: Math.min(1, current.points[0].x + .0001), y: current.points[0].y })
    void command("stroke.add", { ...current, id: crypto.randomUUID() }).then(() => setDraft(null)).catch(e => { setDraft(null); onError(friendlyError(e)) }).finally(() => sendPreview({ ...current, points: [] }))
  }
  const draw = (stroke: Pick<Stroke, "tool" | "color" | "points">, key: string, confirmed = false) => <path key={key} data-stroke-id={confirmed ? key : undefined} d={pathFor(stroke.points)} fill="none" stroke={stroke.color} strokeWidth={stroke.tool === "highlighter" ? 18 : 4} strokeOpacity={stroke.tool === "highlighter" ? .38 : 1} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  const documentControls = <div className="document-controls"><button aria-label="PDF 축소" onClick={() => setZoom(value => Math.max(.5, value - .25))}>− 축소</button><span>{Math.round(zoom * 100)}%</span><button aria-label="PDF 확대" onClick={() => setZoom(value => Math.min(4, value + .25))}>＋ 확대</button><button onClick={() => setZoom(1)}>화면에 맞추기</button><button aria-label="PDF 이전 페이지" disabled={!canControl || share.page <= 1 || controlPending} onClick={() => void execute("document.page", { page: share.page - 1 })}>이전</button><span>{share.page} / {pages}쪽</span><button aria-label="PDF 다음 페이지" disabled={!canControl || share.page >= pages || controlPending} onClick={() => void execute("document.page", { page: share.page + 1 })}>다음</button>{captureControl}</div>
  const annotationControls = !remoteActive && canAnnotate && (annotating ? <div className="annotation-bar"><div className="annotation-tools">{(["pen", "highlighter", "eraser"] as const).map(item => <button key={item} className={`annotation-tool ${tool === item ? "active" : ""}`} onClick={() => setTool(item)} aria-label={item === "pen" ? "펜" : item === "highlighter" ? "형광펜" : "지우개"}><Icon name={item} size={20} /><span>{item === "pen" ? "펜" : item === "highlighter" ? "형광펜" : "지우개"}</span></button>)}</div><div className="annotation-colors" aria-label="판서 색상"><div className="color-grid">{colors.map(item => <button key={item} className={color === item ? "selected" : ""} style={{ backgroundColor: item }} onClick={() => setColor(item)} aria-label={`색상 ${item}`}>{color === item && <Icon name="check" size={12} />}</button>)}</div></div><div className="annotation-history"><button aria-label="실행 취소" disabled={controlPending} onClick={() => void execute("annotation.undo")}><Icon name="undo" size={20} /><span>실행 취소</span></button><button aria-label="다시 실행" disabled={controlPending} onClick={() => void execute("annotation.redo")}><Icon name="redo" size={20} /><span>다시 실행</span></button></div><button className="annotation-clear" disabled={!strokes.some(stroke => canControl || stroke.authorId === user.id)} onClick={() => setClearConfirm(true)}><Icon name="trash" size={18} />{canControl ? "전체 지우기" : "내 판서 지우기"}</button><button className="annotation-exit" onClick={() => setAnnotating(false)}><Icon name="close" size={18} />판서 종료</button></div> : <button className="annotate-entry" onClick={() => setAnnotating(true)}><Icon name="pen" />판서 시작</button>)

  return <div className={`shared-stage ${textbookLayout ? "textbook-stage" : ""} ${dockedParticipants ? "textbook-stage-docked" : ""}`}>
    <div ref={contentRef} className="shared-content live-shared-content">
      {loading && <p className="live-stage-message">문서를 불러오는 중이에요.</p>}
      {share.type === "screen" && !screenTrack && <p className="live-stage-message">공유 화면 연결을 기다리고 있어요.</p>}
      <div ref={surfaceRef} className="content-surface" style={{ width, height, maxWidth: "none", display: loading || share.type === "screen" && !screenTrack ? "none" : undefined }}>
        {share.type === "document" ? <canvas ref={canvasRef} aria-label={`${share.material?.name || "PDF"} ${share.page}페이지`} /> : <video ref={videoRef} data-testid={share.type === "screen" ? "shared-screen" : "shared-media"} src={share.type === "media" && share.materialId ? materialContentUrl(share.materialId, snapshot.lessonId) : undefined} autoPlay={share.type === "screen"} muted={share.type === "screen" || outputDevice === "muted"} playsInline preload={frameRef ? "auto" : "metadata"} onLoadedData={() => setVideoReady(true)} onCanPlay={() => setVideoReady(true)} onSeeked={() => setVideoReady(true)} onSeeking={() => setVideoReady(false)} onEmptied={() => setVideoReady(false)} onLoadedMetadata={event => { const video = event.currentTarget; setNatural({ w: video.videoWidth || 1280, h: video.videoHeight || 720 }); measureVideo(video); if (share.type === "media") { setDuration(video.duration); syncVideo() } }} onResize={event => { const video = event.currentTarget; if (video.videoWidth && video.videoHeight) setNatural({ w: video.videoWidth, h: video.videoHeight }); measureVideo(video) }} onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onEnded={() => { if (canControl && share.type === "media" && share.playing) void execute("media.update", { playing: false, position: duration }) }} onError={() => onError("공유 영상을 재생하지 못했어요. 파일 형식과 연결 상태를 확인해 주세요.")} />}
        <svg ref={svgRef} className={`annotation-overlay live-annotation ${!remoteActive && drawingActive || canPoint ? "is-drawing" : ""}`} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label={remoteActive && canControl ? designContent.remoteAssistActive : "수업 판서 영역"} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
          {strokes.map(stroke => draw(stroke, stroke.id, true))}
          {Object.entries(previews).filter(([, stroke]) => stroke.shareId === share.id && stroke.page === share.page).map(([id, stroke]) => draw(stroke, `preview-${id}`))}
          {draft && draft.shareId === share.id && draft.page === share.page && draw(draft, "draft")}
        </svg>
        {assistanceEnabled && remotePointer && matchesAssistancePointer(remotePointer, snapshot) && Date.now() - remotePointer.receivedAt < REMOTE_POINTER_TTL_MS && <span className="remote-pointer-mark" data-testid="remote-pointer" style={{ left: `${remotePointer.x * 100}%`, top: `${remotePointer.y * 100}%` }} aria-hidden="true"><i /></span>}
        {autoplayBlocked && share.playing && <button className="media-audio-prompt" onClick={() => { void videoRef.current?.play().then(() => setAutoplayBlocked(false)).catch(e => onError(friendlyError(e))) }}>영상과 소리 켜기</button>}
      </div>
    </div>

    {!dockedParticipants && <SharedParticipants snapshot={snapshot} user={user} room={room} />}
    {textbookLayout
      ? <div className="textbook-stage-footer">{documentControls}{annotationControls}</div>
      : <>{share.type === "document" && documentControls}{annotationControls}</>}
    {share.type === "media" && <div className="media-controls"><button aria-label="영상 재생" className={share.playing ? "active" : ""} disabled={!canControl || controlPending} onClick={() => void execute("media.update", { playing: true, position: videoRef.current?.currentTime || 0 })}><Icon name="play" size={17} />재생</button><button aria-label="영상 정지" className={!share.playing ? "active" : ""} disabled={!canControl || controlPending} onClick={() => void execute("media.update", { playing: false, position: videoRef.current?.currentTime || 0 })}><Icon name="pause" size={17} />정지</button><input aria-label="영상 재생 위치" type="range" min={0} max={Number.isFinite(duration) ? duration : 0} step={.1} value={Math.min(position, Number.isFinite(duration) ? duration : 0)} disabled={!canControl || controlPending} onChange={event => void execute("media.update", { playing: share.playing, position: Number(event.target.value) })} /><span>{formatDuration(position)} / {formatDuration(duration)}</span></div>}

    <AnimatedPresence show={clearConfirm}><Confirm title={canControl ? "판서를 모두 지울까요?" : "내 판서를 지울까요?"} copy="현재 페이지의 판서를 삭제합니다. 이 작업은 되돌릴 수 없습니다." cancel={() => setClearConfirm(false)} confirm={() => { setClearConfirm(false); void execute("annotation.clear") }} confirmText="지우기" /></AnimatedPresence>
  </div>
}

export function SharedParticipants({ snapshot, user, room, docked = false }: {
  snapshot: MeetingSnapshot
  user: User
  room: Room | null
  docked?: boolean
}) {
  const participants = useRoomParticipants(room)
  const canControl = snapshot.lesson.teacher.id === user.id
  const controlsId = docked ? "textbook-participant-tiles" : "shared-participant-tiles"
  const [windowLayout, setParticipantLayout] = useState(() => window.innerWidth <= designLayout.meetingCompactBreakpoint ? "mobile" : window.innerWidth <= designLayout.meetingMediumBreakpoint ? "narrow" : "wide")
  const { areaRef, width: participantWidth, height: participantHeight } = useParticipantArea()
  const participantLayout = docked ? "mobile" : windowLayout
  useEffect(() => {
    const mobile = window.matchMedia(`(max-width:${designLayout.meetingCompactBreakpoint}px)`)
    const narrow = window.matchMedia(`(max-width:${designLayout.meetingMediumBreakpoint}px)`)
    const update = () => setParticipantLayout(mobile.matches ? "mobile" : narrow.matches ? "narrow" : "wide")
    update()
    mobile.addEventListener("change", update)
    narrow.addEventListener("change", update)
    return () => { mobile.removeEventListener("change", update); narrow.removeEventListener("change", update) }
  }, [])
  const people = snapshot.participants.filter(entry => entry.online && (canControl
    ? docked || entry.user.id !== snapshot.lesson.teacher.id
    : entry.user.id === snapshot.lesson.teacher.id))
  if (docked) people.sort((a, b) => Number(b.user.id === user.id) - Number(a.user.id === user.id))
  const participantTileHeight = docked ? 90 : participantHeight ? Math.max(56, Math.min(participantLayout === "narrow" ? 115 : 132, participantHeight - 92)) : 132
  const participantPageSize = docked ? 2 : participantLayout === "mobile"
    ? Math.max(1, Math.min(4, Math.floor((participantWidth + 8) / 120)))
    : Math.max(1, Math.min(4, Math.floor((participantHeight - 40 - 52 + 12) / (participantTileHeight + 12))))
  const participantPages = useParticipantPagination(people.length, participantPageSize)
  const personParticipant = (id: string) => participants.find(person => person.identity === id)

  return <div ref={areaRef} className={`shared-participant-gallery ${docked ? "textbook-participants" : ""}`}>
      <div id={controlsId} className="shared-participants" style={{ "--shared-tile-height": `${participantTileHeight}px` } as CSSProperties}>{!docked && <div className="shared-participants-title"><Icon name="users" size={14} />{canControl ? `참여자 ${people.length}명` : "선생님"}</div>}{people.slice(participantPages.start, participantPages.end).map(({ user: person, raised }) => { const participant = personParticipant(person.id); return <VideoTile key={person.id} userId={person.id} person={person.name} teacher={person.id === snapshot.lesson.teacher.id} participant={participant} small self={person.id === user.id} hand={raised} /> })}{!people.length && <div className="shared-participants-empty"><Icon name="users" size={18} />입장 대기 중</div>}</div>
      <ParticipantPagination page={participantPages.page} pageCount={participantPages.pageCount} start={participantPages.start} end={participantPages.end} total={people.length} onPageChange={participantPages.setPage} compact controlsId={controlsId} />
    </div>
}
