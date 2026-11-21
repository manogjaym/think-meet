import { designContent } from "../../generated/design-content"
import { useEffect, useRef, useState } from "react"
import { Track, createAudioAnalyser, supportsAudioOutputSelection, type LocalAudioTrack, type Participant, type Room } from "livekit-client"
import { api, colorFor, joinLink, type ApiLesson, type User } from "../../lib/api"
import { API_BASE_PATH } from "../../generated/contracts"
import { capabilityHeaders, requireHttpFeature } from "../../lib/features"
import { friendlyError, saveDevicePreferences, readDevicePreferences, formatDuration, type Command, type Material, type MeetingSnapshot } from "../../lib/meeting"
import type { Panel } from "../../models"
import { Avatar, Confirm, Icon } from "../ui"
import { AnimatedPresence } from "../AnimatedPresence"
import { useFeature } from "../../lib/useFeature"
import { currentAssistance } from "../../lib/remoteAssistance"
import { useMediaStreamTrack, useParticipantTrack, useRoomParticipants } from "../../lib/livekitMedia"
import { TextbookPicker } from "./TextbookPicker"

type PanelProps = { panel: Panel; activePanel: Panel; setPanel: (panel: Panel) => void; user: User; lesson: ApiLesson; room: Room | null; snapshot: MeetingSnapshot | null; command: Command; onOutputChange: (id: string) => void; unreadChatCount?: number; textbookEnabled: boolean; textbookConnected: boolean; onTextbookOpened: () => void }
export function SidePanel({ panel, activePanel, setPanel, user, lesson, room, snapshot, command, onOutputChange, unreadChatCount = 0, textbookEnabled, textbookConnected, onTextbookOpened }: PanelProps) {
  const isHost = lesson.teacher.id === user.id
  const assistanceSupported = useFeature("meeting.remote-assistance")
  const phase = snapshot?.instruction?.phase
  const remoteAssistanceEnabled = assistanceSupported && phase === undefined
  const showMaterials = isHost && (phase === undefined || phase === "classroom")
  const [requestingAssistance, setRequestingAssistance] = useState(false)
  const assistanceRequestPending = useRef(false)
  const assistanceSession = currentAssistance(snapshot?.assistance) ? snapshot.assistance : null
  const assistanceRequestBlocked = requestingAssistance || Boolean(assistanceSession || snapshot?.share) || snapshot?.lesson.status !== "LIVE"
  const isOpen = lesson.accessMode === "OPEN"
  const [search, setSearch] = useState("")
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const clientMessageId = useRef(crypto.randomUUID())
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [kick, setKick] = useState<User | null>(null)
  const [students, setStudents] = useState<User[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [contentTab, setContentTab] = useState<"media" | "document">(textbookEnabled ? "document" : "media")
  const [listing, setListing] = useState(true)
  const [listError, setListError] = useState(false)
  const [listAttempt, setListAttempt] = useState(0)
  const [textbookBusy, setTextbookBusy] = useState(false)
  const textbookRequest = useRef(false)
  const contentOpen = activePanel === "content" && showMaterials
  const textbookTab = textbookEnabled && contentTab === "document"
  const latestPanel = useRef({ contentOpen, onTextbookOpened })
  latestPanel.current = { contentOpen, onTextbookOpened }
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null)
  const [failedFile, setFailedFile] = useState<File | null>(null)
  const uploadRef = useRef<XMLHttpRequest | null>(null)
  const uploadGateRef = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const endMessages = useRef<HTMLDivElement>(null)
  const messages = snapshot?.messages || []
  const title = { people: designContent.meetingPeoplePanel, more: "더보기", chat: designContent.meetingChatPanel, invite: isOpen ? "참여 링크 공유" : "다른 참석자 추가", settings: "설정", content: textbookTab ? designContent.textbookPicker : "콘텐츠 공유" }[panel || "more"]
  const roster = snapshot?.participants || [lesson.teacher, ...lesson.students].map(person => ({ user: person, online: false, raised: false }))
  const participants = useRoomParticipants(panel === "people" || panel === "chat" ? room : null)
  const connected = new Map(participants.map(person => [person.identity, person]))
  const online = roster.filter(person => connected.has(person.user.id))
  const offline = roster.filter(person => !connected.has(person.user.id))
  useEffect(() => { setSearch(""); setError(""); setNotice("") }, [panel])
  useEffect(() => { endMessages.current?.scrollIntoView({ block: "end", behavior: "smooth" }) }, [messages.length, panel])
  useEffect(() => setContentTab(textbookEnabled ? "document" : "media"), [textbookEnabled])
  useEffect(() => {
    if (!isHost) return
    if (panel === "invite" && !isOpen) void api<User[]>("/students").then(setStudents).catch(e => setError(friendlyError(e)))
  }, [panel, isHost, isOpen])
  useEffect(() => {
    if (!contentOpen) {
      if (textbookEnabled) setContentTab("document")
      setListing(true)
      setListError(false)
      return
    }
    setError("")
    setNotice("")
  }, [contentOpen, textbookEnabled])
  useEffect(() => {
    if (!contentOpen) return
    const request = new AbortController()
    setListing(true)
    setListError(false)
    void api<Material[]>("/materials", { signal: request.signal }).then(files => {
      if (!request.signal.aborted) setMaterials(files)
    }).catch(() => {
      if (!request.signal.aborted) setListError(true)
    }).finally(() => {
      if (!request.signal.aborted) setListing(false)
    })
    return () => request.abort()
  }, [contentOpen, listAttempt])
  useEffect(() => () => { uploadGateRef.current?.abort(); uploadRef.current?.abort() }, [])
  const run = async (action: () => Promise<unknown>, success?: string) => {
    setError("")
    try { await action(); if (success) setNotice(success) } catch(e) { setError(friendlyError(e)) }
  }
  const changeTextbook = async (action: () => Promise<unknown>) => {
    if (textbookRequest.current) return
    textbookRequest.current = true
    setTextbookBusy(true)
    try { await run(action) } finally { textbookRequest.current = false; setTextbookBusy(false) }
  }
  const removeMaterial = async (material: Material) => {
    await api(`/materials/${material.id}`, { method: "DELETE" })
    setMaterials(current => current.filter(item => item.id !== material.id))
    setNotice("파일을 삭제했어요.")
  }
  const requestAssistance = (studentId: string) => {
    if (!isHost || !remoteAssistanceEnabled || assistanceRequestBlocked || assistanceRequestPending.current) return
    assistanceRequestPending.current = true
    setRequestingAssistance(true)
    void run(() => command("assistance.request", { studentId })).finally(() => {
      assistanceRequestPending.current = false
      setRequestingAssistance(false)
    })
  }
  const cancelUpload = () => { uploadGateRef.current?.abort(); uploadRef.current?.abort() }
  const uploadFile = async (file: File) => {
    if (uploadRef.current || uploadGateRef.current) return
    const document = file.name.toLowerCase().endsWith(".pdf")
    const media = file.name.toLowerCase().endsWith(".mp4")
    if (!document && !media) { setError("PDF 또는 MP4 파일을 선택해 주세요."); return }
    if (file.size > (document ? 50 : 500) * 1024 * 1024) { setError(document ? "PDF는 50MiB까지 업로드할 수 있어요." : "MP4는 500MiB까지 업로드할 수 있어요."); return }
    setError(""); setNotice(""); setFailedFile(null); setContentTab(document ? "document" : "media")
    const gate = new AbortController()
    uploadGateRef.current = gate; setUpload({ name: file.name, progress: 0 })
    try { await requireHttpFeature("POST", "/materials", gate.signal) }
    catch (error) {
      setUpload(null)
      if (gate.signal.aborted) setNotice("업로드를 취소했어요.")
      else { setError(friendlyError(error)); setFailedFile(file) }
      return
    } finally { if (uploadGateRef.current === gate) uploadGateRef.current = null }
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${API_BASE_PATH}/materials`); xhr.withCredentials = true
    for (const [name, value] of Object.entries(capabilityHeaders())) xhr.setRequestHeader(name, value)
    uploadRef.current = xhr; setUpload({ name: file.name, progress: 0 })
    xhr.upload.onprogress = event => { if (event.lengthComputable) setUpload({ name: file.name, progress: Math.min(99, Math.round(event.loaded / event.total * 100)) }) }
    const finish = () => { uploadRef.current = null; setUpload(null) }
    xhr.onload = () => {
      finish()
      if (xhr.status >= 200 && xhr.status < 300) {
        try { const material = JSON.parse(xhr.responseText) as Material; setMaterials(current => [material, ...current.filter(item => item.id !== material.id)]); setNotice("업로드가 완료되었어요.") }
        catch { setError("업로드 결과를 확인하지 못했어요. 파일 목록을 다시 열어 주세요.") }
      } else {
        const response = (() => { try { return JSON.parse(xhr.responseText) as { message?: string } } catch { return {} } })()
        setError(response.message || "업로드에 실패했어요. 다시 시도해 주세요."); setFailedFile(file)
      }
    }
    xhr.onerror = () => { finish(); setError("파일 업로드 중 연결이 끊어졌어요."); setFailedFile(file) }
    xhr.onabort = () => { finish(); setNotice("업로드를 취소했어요.") }
    const form = new FormData(); form.append("file", file); xhr.send(form)
  }
  const participantRow = (entry: typeof roster[number], joined: boolean) => {
    const person = entry.user
    const participant = connected.get(person.id)
    return <div className="person-row" key={person.id}>
      <Avatar name={person.name} color={colorFor(person.id)} small />
      <div><strong>{person.name}{person.id === user.id ? " (나)" : ""}</strong><span>{person.id === lesson.teacher.id ? "선생님 · 호스트" : `${person.role === "teacher" ? "선생님" : "학생"} · ${joined ? "참여 중" : "아직 입장하지 않음"}`}</span>
        {isHost && joined && person.role === "student" && remoteAssistanceEnabled && <button className="assistance-request" aria-label={`${person.name} ${designContent.remoteAssistRequest}`} disabled={assistanceRequestBlocked} onClick={() => requestAssistance(person.id)}><Icon name="screen" size={17} />{designContent.remoteAssistRequest}</button>}
      </div>
      {entry.raised && <span className="raised" aria-label="손들기"><Icon name="hand" size={16} /></span>}
      {joined && <ParticipantDevices participant={participant} />}
      {isHost && person.id !== lesson.teacher.id && <button aria-label={`${person.name} 퇴장`} onClick={() => setKick(person)}><Icon name="more" size={20} /></button>}
    </div>
  }
  return <aside className={`side-panel ${panel === "content" && textbookTab ? "textbook-panel" : ""}`}>
    <header><div><h2>{title}</h2>{panel === "people" && <span>{online.length}명 입장</span>}</div><button onClick={() => setPanel(null)} aria-label="패널 닫기"><Icon name="close" /></button></header>
    {(panel === "people" || panel === "chat") && <nav className="participant-tabs" aria-label="참석자 패널 보기"><button className={panel === "people" ? "active" : ""} onClick={() => setPanel("people")}><Icon name="users" size={17} />참석자<span>{online.length}</span></button><button className={panel === "chat" ? "active" : ""} onClick={() => setPanel("chat")} aria-label={unreadChatCount ? `채팅, 읽지 않은 메시지 ${unreadChatCount}개` : "채팅"}><Icon name="chat" size={17} />채팅{unreadChatCount > 0 && <span className="chat-unread-badge" aria-hidden="true">{unreadChatCount > 99 ? "99+" : unreadChatCount}</span>}</button></nav>}
    <div className="panel-view">
      {error && <p className="panel-error" role="alert">{error}</p>}{notice && <p className="panel-notice" role="status">{notice}</p>}
      {panel === "people" && <div className="panel-body"><label className="search compact"><Icon name="search" size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="참석자 찾기" aria-label="참석자 찾기" /></label>{isHost && remoteAssistanceEnabled && <p className="chat-notice">{designContent.remoteAssistRequestHelp}</p>}
        {isHost && remoteAssistanceEnabled && snapshot?.share && !assistanceSession && <p className="panel-notice" role="status">{designContent.remoteAssistStopShareFirst}</p>}
        {isHost && assistanceSession && assistanceSession.status !== "active" && <p className="panel-notice" role="status">{assistanceSession.status === "pending" ? designContent.remoteAssistWaiting : designContent.remoteAssistPreparing}</p>}<p className="panel-label">통화 중 · {online.length}</p>{online.filter(entry => entry.user.name.includes(search.trim())).map(entry => participantRow(entry, true))}<p className="panel-label">입장 대기 · {offline.length}</p>{offline.filter(entry => entry.user.name.includes(search.trim())).map(entry => participantRow(entry, false))}</div>}
      {panel === "more" && <div className="panel-body menu-grid">
        {isHost && remoteAssistanceEnabled && <button onClick={() => setPanel("people")}><span><Icon name="screen" /></span><div><strong>{designContent.remoteAssistStudentScreen}</strong><small>{designContent.remoteAssistRequestHelp}</small></div></button>}<button onClick={() => setPanel("chat")} aria-label={unreadChatCount ? `수업 채팅, 읽지 않은 메시지 ${unreadChatCount}개` : "수업 채팅"}><span><Icon name="chat" /></span><div><strong>{designContent.meetingChatPanel}</strong><small>함께 이야기 나누기</small></div>{unreadChatCount > 0 && <span className="chat-unread-badge" aria-hidden="true">{unreadChatCount > 99 ? "99+" : unreadChatCount}</span>}</button>{isHost && <><button onClick={() => setPanel("invite")}><span><Icon name={isOpen ? "link" : "users"} /></span><div><strong>{isOpen ? "참여 링크 공유" : "다른 참석자 추가"}</strong><small>{isOpen ? "누구나 참여할 수 있는 공개 수업" : "초대 학생과 참여 링크 관리"}</small></div></button>{showMaterials && <button onClick={() => setPanel("content")}><span><Icon name="folder" /></span><div><strong>수업 자료</strong><small>영상과 PDF를 함께 보기</small></div></button>}</>}<button onClick={() => setPanel("settings")}><span><Icon name="settings" /></span><div><strong>카메라·마이크 설정</strong><small>입력·출력 장치 및 노이즈 캔슬링</small></div></button></div>}
      {panel === "chat" && <div className="panel-body chat-body"><div className="chat-notice">이 수업의 참여자 모두에게 메시지가 전달됩니다.</div><div className="messages" aria-live="polite">{messages.map(message => <div className="message" key={message.id}><Avatar name={message.userName} color={colorFor(message.userId)} small /><div><span><strong>{message.userName}{message.userId === user.id ? " (나)" : ""}</strong><small>{new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(message.createdAt))}</small></span><p>{message.text}</p></div></div>)}<div ref={endMessages} /></div><form className="chat-input" onSubmit={e => { e.preventDefault(); if (!draft.trim() || sending) return; setSending(true); void run(async () => { await command("chat.send", { text: draft.trim(), clientId: clientMessageId.current }); setDraft(""); clientMessageId.current = crypto.randomUUID() }).finally(() => setSending(false)) }}><input aria-label="채팅 메시지" maxLength={2000} placeholder="메시지 보내기" value={draft} onChange={e => setDraft(e.target.value)} disabled={sending} /><button type="submit" disabled={sending || !draft.trim()} aria-label="메시지 전송"><Icon name="send" size={21} /></button></form></div>}
      {panel === "invite" && isHost && <div className="panel-body">
        {isOpen ? <div className="chat-notice"><strong>누구나 함께할 수 있는 공개 수업이에요.</strong><p>학생을 따로 초대할 필요 없이, 로그인한 누구나 수업 목록이나 참여 링크로 입장할 수 있어요.</p></div> : <>
          <label className="search compact"><Icon name="search" size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="학생 이름 검색" aria-label="초대할 학생 검색" /></label>
          {students.filter(person => person.name.includes(search.trim())).map(person => { const invited = lesson.students.some(student => student.id === person.id); return <div className="invite-row" key={person.id}><Avatar name={person.name} color={colorFor(person.id)} small /><div><strong>{person.name}</strong><span>{invited ? "이미 초대됨" : "초대 가능"}</span></div><button disabled={invited} aria-pressed={selected.includes(person.id)} onClick={() => setSelected(current => current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id])}>{invited ? "초대됨" : selected.includes(person.id) ? "선택됨" : "선택"}</button></div> })}
          <div className="invite-footer"><span>{selected.length}명 선택</span><button className="primary" disabled={!selected.length} onClick={() => void run(async () => { await api(`/lessons/${lesson.id}/invites`, { method: "POST", body: JSON.stringify({ studentIds: selected }) }); setSelected([]) }, "학생을 초대했어요.")}>초대하기</button></div>
        </>}
        <button className="copy-link" onClick={() => void run(() => navigator.clipboard.writeText(joinLink(lesson)), "참여 링크를 복사했어요.")}><Icon name="copy" size={17} />참여 링크 복사</button><p className="content-note">{joinLink(lesson)}</p>
      </div>}
      {panel === "settings" && <Settings room={room} onError={setError} onOutputChange={onOutputChange} />}
      {panel === "content" && contentOpen && <div className={`panel-body content-body ${textbookTab ? "textbook-body" : ""}`}>
        <div className="tabs">
          {(textbookEnabled ? ["document", "media"] as const : ["media", "document"] as const).map(tab =>
            <button key={tab} className={contentTab === tab ? "active" : ""} aria-pressed={contentTab === tab}
              disabled={textbookBusy} onClick={() => setContentTab(tab)}>
              {tab === "media" ? "미디어" : textbookEnabled ? designContent.textbookTab : "문서"}
            </button>)}
        </div>
        <input ref={fileInput} type="file" hidden accept={contentTab === "media" ? ".mp4,video/mp4" : ".pdf,application/pdf"} onChange={e => { const file = e.target.files?.[0]; if (file) uploadFile(file); e.target.value = "" }} />
        <button className="upload" disabled={listing || Boolean(upload) || textbookBusy} onClick={() => fileInput.current?.click()}>
          <Icon name="plus" />{contentTab === "media" ? "미디어 파일 업로드" : textbookTab ? designContent.textbookAdd : "문서 파일 업로드"}
        </button>
        {upload && <div className="upload-progress"><div><strong>{upload.name}</strong><button onClick={cancelUpload}>취소</button></div><span><i style={{ width: `${upload.progress}%` }} /></span><small>{upload.progress >= 99 ? "파일을 확인하는 중" : `업로드 중 · ${upload.progress}%`}</small></div>}
        {failedFile && <button className="upload" disabled={listing || textbookBusy} onClick={() => uploadFile(failedFile)}>업로드 다시 시도</button>}
        {listError && <div className="panel-error" role="alert"><p>{textbookTab ? designContent.textbookListError : "자료 목록을 불러오지 못했어요."}</p><button className="textbook-retry" onClick={() => setListAttempt(value => value + 1)}>{designContent.textbookRetry}</button></div>}
        {listing ? <p className="chat-notice" role="status">자료 목록을 불러오는 중이에요.</p> : !listError && (textbookTab ?
          <TextbookPicker materials={materials.filter(item => item.type === "document")} share={snapshot?.share}
            busy={textbookBusy || Boolean(upload)} connected={textbookConnected}
            onOpen={(materialId, page) => changeTextbook(async () => {
              await command("document.open", { materialId, page })
              if (latestPanel.current.contentOpen) latestPanel.current.onTextbookOpened()
            })}
            onDelete={material => changeTextbook(() => removeMaterial(material))} />
          : <>
            <p className="panel-label">내 파일</p>
            {materials.filter(material => material.type === contentTab).map(material => <div className={`content-item ${snapshot?.share?.materialId === material.id ? "active" : ""}`} key={material.id}>
              <div className="file-thumb"><Icon name={material.type === "media" ? "video" : "file"} /></div>
              <button className="content-share" onClick={() => void run(async () => { await command("share.start", { type: material.type, materialId: material.id }); setPanel(null) })}>
                <strong>{material.name}</strong><span>{material.type === "media" ? `${formatDuration(material.duration || 0)} · MP4` : `${material.pages || ""}페이지 · PDF`} · {(material.size / 1024 / 1024).toFixed(1)}MiB</span>
              </button>
              <button className="content-delete" disabled={snapshot?.share?.materialId === material.id} title={snapshot?.share?.materialId === material.id ? "공유를 중지한 후 삭제할 수 있어요." : "파일 삭제"} aria-label={`${material.name} 삭제`} onClick={() => void run(() => removeMaterial(material))}><Icon name="trash" size={17} /></button>
            </div>)}
            {!materials.some(material => material.type === contentTab) && <p className="chat-notice">업로드한 자료가 없어요.</p>}
            <div className="content-note"><Icon name="alert" size={17} /><span>새 자료 또는 화면을 공유하면 기존 공유가 전환됩니다. PDF 50MiB, MP4 500MiB까지 지원합니다.</span></div>
          </>)}
      </div>}
    </div>
    <AnimatedPresence show={Boolean(kick)}><Confirm title={`${kick?.name || "참여자"} 님을 퇴장시킬까요?`} copy="이 참여자는 이 수업에 다시 입장할 수 없습니다." cancel={() => setKick(null)} confirm={() => { if (kick) void run(() => api(`/lessons/${lesson.id}/kick`, { method: "POST", body: JSON.stringify({ userId: kick.id }) }), "참여자를 퇴장시켰어요."); setKick(null) }} confirmText="퇴장시키기" /></AnimatedPresence>
  </aside>
}

function ParticipantDevices({ participant }: { participant: Participant | undefined }) {
  const mic = useParticipantTrack(participant, Track.Source.Microphone).enabled
  const camera = useParticipantTrack(participant, Track.Source.Camera).enabled
  return <div className="participant-devices"><span className={`device-state ${mic ? "" : "off"}`} title={mic ? "마이크 켜짐" : "음소거"}><Icon name={mic ? "mic" : "micOff"} size={15} /></span><span className={`device-state ${camera ? "" : "off"}`}><Icon name={camera ? "video" : "videoOff"} size={15} /></span></div>
}

function Settings({ room, onError, onOutputChange }: { room: Room | null; onError: (message: string) => void; onOutputChange: (id: string) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [preferences, setPreferences] = useState(readDevicePreferences)
  const [level, setLevel] = useState(0)
  const [applied, setApplied] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const cameraState = useParticipantTrack(room?.localParticipant, Track.Source.Camera)
  const micState = useParticipantTrack(room?.localParticipant, Track.Source.Microphone)
  const camera = cameraState.enabled ? cameraState.track : undefined
  const mic = micState.track as LocalAudioTrack | undefined
  const activeMic = micState.enabled ? mic : undefined
  const micStream = useMediaStreamTrack(activeMic)
  useEffect(() => { const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(e => onError(friendlyError(e))) }; refresh(); navigator.mediaDevices?.addEventListener("devicechange", refresh); return () => navigator.mediaDevices?.removeEventListener("devicechange", refresh) }, [onError])
  useEffect(() => { const element = video.current; if (!camera || !element) return; camera.attach(element); return () => { camera.detach(element) } }, [camera])
  useEffect(() => {
    if (!activeMic || !micStream) { setLevel(0); return }
    const analyser = createAudioAnalyser(activeMic)
    const interval = window.setInterval(() => setLevel(Math.min(100, analyser.calculateVolume() * 250)), 100)
    return () => { window.clearInterval(interval); void analyser.cleanup() }
  }, [activeMic, micStream])
  const change = async (key: "cameraId" | "microphoneId" | "speakerId" | "noise", value: string | boolean) => {
    if (!room) return
    try {
      if (key === "noise") await mic?.restartTrack({ noiseSuppression: Boolean(value), echoCancellation: true, deviceId: preferences.microphoneId || undefined })
      else if (key === "speakerId") { if (value !== "muted" && supportsAudioOutputSelection()) await room.switchActiveDevice("audiooutput", String(value)); onOutputChange(String(value)) }
      else await room.switchActiveDevice(key === "cameraId" ? "videoinput" : "audioinput", String(value), Boolean(value) && value !== "default")
      const next = { ...preferences, [key]: value }; setPreferences(next); saveDevicePreferences(next); setApplied(true)
    } catch(e) { onError(friendlyError(e)) }
  }
  const select = (kind: MediaDeviceKind, key: "cameraId" | "microphoneId", label: string) => <label className="field"><span>{label}</span><select aria-label={label} value={preferences[key] || ""} onChange={e => void change(key, e.target.value)}><option value="">기본 장치</option>{devices.filter(device => device.kind === kind && device.deviceId !== "default").map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}</select></label>
  return <div className="panel-body settings-body"><div className="setting-title"><Icon name="settings" /><div>장치 설정<span>변경한 설정은 이 기기에 저장됩니다.</span></div></div>{select("videoinput", "cameraId", "카메라")}<div className="camera-mini">{camera && !camera.isMuted ? <video ref={video} autoPlay playsInline muted /> : "카메라 꺼짐"}</div>{select("audioinput", "microphoneId", "마이크 입력")}<div className="real-level" role="meter" aria-label="마이크 입력 레벨" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level)}><i style={{ width: `${level}%` }} /></div><label className="field"><span>상대방 소리 출력</span><select aria-label="상대방 소리 출력" value={preferences.speakerId || "default"} onChange={e => void change("speakerId", e.target.value)}><option value="default">기본 스피커</option>{supportsAudioOutputSelection() && devices.filter(device => device.kind === "audiooutput" && device.deviceId !== "default").map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `스피커 ${index + 1}`}</option>)}<option value="muted">소리 끄기</option></select></label>{!supportsAudioOutputSelection() && <p className="chat-notice">이 브라우저에서는 출력 장치 선택을 지원하지 않아요. 기기의 소리 설정에서 변경해 주세요.</p>}<div className="setting-row"><div><strong>노이즈 캔슬링</strong><span>{preferences.noise !== false ? "켜짐" : "꺼짐"}</span></div><button className={`switch ${preferences.noise !== false ? "on" : ""}`} role="switch" aria-checked={preferences.noise !== false} aria-label="노이즈 캔슬링" onClick={() => void change("noise", preferences.noise === false)}><i /></button></div>{applied && <p className="panel-notice" role="status">설정 변경이 적용되었어요.</p>}</div>
}
