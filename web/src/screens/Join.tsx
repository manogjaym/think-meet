import { useEffect, useRef, useState, type ReactNode } from "react"
import type { Lesson } from "./Home"
import type { Role, Screen } from "../models"
import type { User } from "../lib/api"
import { ApiError, colorFor } from "../lib/api"
import { designContent as copy } from "../generated/design-content"
import {
  prejoinMediaError,
  prejoinTestTone,
  usePrejoinProbe,
} from "../lib/prejoin"
import { readDevicePreferences, saveDevicePreferences } from "../lib/meeting"
import { Avatar, Badge, Icon } from "../components/ui"
import { useFeature } from "../lib/useFeature"
import { FEATURE_IDS } from "../generated/feature-policy"

export type JoinDevices = {
  mic: boolean
  cam: boolean
  cameraId?: string
  microphoneId?: string
  speakerId?: string
  noise?: boolean
}
export const initialJoinDevices = (): JoinDevices => ({
  mic: true,
  cam: true,
  noise: true,
  ...readDevicePreferences(),
})
const mediaError = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError")
      return "기기 접근 권한이 필요해요. 주소 표시줄에서 카메라·마이크를 허용해 주세요."
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError")
      return "선택한 기기를 찾을 수 없어요. 연결된 기기를 확인해 주세요."
    if (error.name === "NotReadableError")
      return "다른 앱에서 기기를 사용하고 있어요. 기기를 사용 중인 앱을 닫고 다시 시도해 주세요."
  }
  return "기기를 사용할 수 없어요. 연결과 브라우저 권한을 확인해 주세요."
}
export function Prejoin({
  lesson,
  user,
  role,
  initialDevices,
  onJoin,
  enhanced = false,
  onUnavailable,
}: {
  lesson: Lesson
  user: User
  role: Role
  setScreen: (s: Screen) => void
  initialDevices?: JoinDevices
  onJoin: (devices: JoinDevices) => Promise<void>
  enhanced?: boolean
  onUnavailable?: (error: ApiError) => void
}) {
  const lessonModes = useFeature(FEATURE_IDS.ClassroomLessonModes)
  const [devices, setDevices] = useState<JoinDevices>(
    initialDevices || initialJoinDevices,
  )
  const [available, setAvailable] = useState<MediaDeviceInfo[]>([])
  const [cameraError, setCameraError] = useState("")
  const [microphoneError, setMicrophoneError] = useState("")
  const [error, setError] = useState("")
  const [level, setLevel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(!document.hidden)
  const [cameraStatus, setCameraStatus] = useState<string>(copy.prejoinChecking)
  const [micStatus, setMicStatus] = useState<string>(copy.prejoinChecking)
  const [probeRetry, setProbeRetry] = useState(0)
  const probe = usePrejoinProbe(lesson.id, enhanced, probeRetry)
  const status =
    probe.state === "connected" ? probe.result.status : lesson.status
  const unavailable = useRef(onUnavailable)
  unavailable.current = onUnavailable
  useEffect(() => {
    if (status === "ENDED" || status === "CANCELLED") {
      unavailable.current?.(
        new ApiError(
          409,
          status,
          status === "ENDED" ? "이미 종료된 수업입니다." : "취소된 수업입니다.",
        ),
      )
    } else if (
      probe.state === "failed" &&
      probe.error &&
      [401, 403, 404].includes(probe.error.status)
    ) {
      unavailable.current?.(probe.error)
    }
  }, [status, probe])
  useEffect(() => {
    const changed = () => setVisible(!document.hidden)
    document.addEventListener("visibilitychange", changed)
    return () => document.removeEventListener("visibilitychange", changed)
  }, [])
  const update = (value: Partial<JoinDevices>) =>
    setDevices((current) => ({ ...current, ...value }))
  useEffect(() => {
    saveDevicePreferences(devices)
  }, [devices])
  useEffect(() => {
    const refresh = () => {
      if (navigator.mediaDevices?.enumerateDevices)
        void navigator.mediaDevices
          .enumerateDevices()
          .then(setAvailable)
          .catch(() => {})
    }
    refresh()
    navigator.mediaDevices?.addEventListener("devicechange", refresh)
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", refresh)
  }, [])
  useEffect(() => {
    let cancelled = false,
      stream: MediaStream | null = null
    if (!devices.cam || (enhanced && !visible)) return
    setCameraStatus(copy.prejoinChecking)
    setCameraError("")
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("카메라는 신뢰된 HTTPS 연결에서 사용할 수 있어요.")
      setCameraStatus(copy.prejoinFailed)
      if (!enhanced) setDevices((current) => ({ ...current, cam: false }))
      return
    }
    void navigator.mediaDevices
      .getUserMedia({
        video: devices.cameraId
          ? { deviceId: { exact: devices.cameraId } }
          : true,
        audio: false,
      })
      .then(async (next) => {
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop())
          return
        }
        stream = next
        if (video.current) {
          video.current.srcObject = next
          await video.current.play()
          if (!cancelled) setCameraStatus(copy.prejoinConnected)
        }
        void navigator.mediaDevices
          .enumerateDevices()
          .then((values) => {
            if (!cancelled) setAvailable(values)
          })
          .catch(() => {})
        next.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (!cancelled) setCameraStatus(copy.prejoinUnavailable)
        })
      })
      .catch((e) => {
        if (!cancelled) {
          stream?.getTracks().forEach((track) => track.stop())
          if (video.current?.srcObject === stream)
            video.current.srcObject = null
          setCameraError(mediaError(e))
          setCameraStatus(prejoinMediaError(e))
          if (!enhanced) setDevices((current) => ({ ...current, cam: false }))
        }
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
      if (video.current) video.current.srcObject = null
    }
  }, [devices.cam, devices.cameraId, retry, visible, enhanced])
  useEffect(() => {
    let cancelled = false,
      stream: MediaStream | null = null,
      context: AudioContext | null = null,
      frame = 0
    if (!devices.mic || (enhanced && !visible)) {
      setLevel(0)
      return
    }
    setMicStatus(copy.prejoinChecking)
    setMicrophoneError("")
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophoneError("마이크는 신뢰된 HTTPS 연결에서 사용할 수 있어요.")
      setMicStatus(copy.prejoinFailed)
      if (!enhanced) setDevices((current) => ({ ...current, mic: false }))
      return
    }
    void navigator.mediaDevices
      .getUserMedia({
        audio: {
          ...(devices.microphoneId
            ? { deviceId: { exact: devices.microphoneId } }
            : {}),
          echoCancellation: true,
          noiseSuppression: devices.noise ?? true,
        },
        video: false,
      })
      .then(async (next) => {
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop())
          return
        }
        stream = next
        void navigator.mediaDevices
          .enumerateDevices()
          .then((values) => {
            if (!cancelled) setAvailable(values)
          })
          .catch(() => {})
        next.getAudioTracks()[0]?.addEventListener("ended", () => {
          if (cancelled) return
          setMicStatus(copy.prejoinUnavailable)
          cancelAnimationFrame(frame)
          setLevel(0)
        })
        context = new AudioContext()
        void context.resume().catch(() => {})
        setMicStatus(copy.prejoinConnected)
        const analyser = context.createAnalyser()
        analyser.fftSize = 256
        context.createMediaStreamSource(next).connect(analyser)
        const values = new Uint8Array(analyser.frequencyBinCount)
        const measure = () => {
          analyser.getByteTimeDomainData(values)
          const rms = Math.sqrt(
            values.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) /
              values.length,
          )
          setLevel(Math.min(100, rms * 350))
          frame = requestAnimationFrame(measure)
        }
        measure()
      })
      .catch((e) => {
        if (!cancelled) {
          stream?.getTracks().forEach((track) => track.stop())
          void context?.close().catch(() => {})
          setMicrophoneError(mediaError(e))
          setMicStatus(prejoinMediaError(e))
          if (!enhanced) setDevices((current) => ({ ...current, mic: false }))
        }
      })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close().catch(() => {})
    }
  }, [
    devices.mic,
    devices.microphoneId,
    devices.noise,
    retry,
    visible,
    enhanced,
  ])
  const { mic, cam } = devices
  // Already-online people other than me, teacher first.
  const participants = [lesson.teacher, ...lesson.students].filter(
    (person, index, people) =>
      person.id !== user.id &&
      people.findIndex((other) => other.id === person.id) === index &&
      lesson.participants?.some((p) => p.userId === person.id),
  )
  const scheduled = status === "SCHEDULED"
  const deviceStatus = (enabled: boolean, current: string) =>
    enabled ? current : copy.prejoinOff
  const inputMeter = (
    <div
      className="join-input-meter"
      aria-label="마이크 입력 레벨"
      role="meter"
      aria-valuenow={Math.round(level)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${level}%` }} />
    </div>
  )
  const picker = (
    kind: "videoinput" | "audioinput" | "audiooutput",
    key: "cameraId" | "microphoneId" | "speakerId",
    title: string,
  ) => {
    const selected = devices[key] === "default" ? "" : devices[key] || ""
    const options = available.filter(
      (d) => d.kind === kind && d.deviceId && d.deviceId !== "default",
    )
    return (
      <select
        aria-label={`${title} 선택`}
        value={selected}
        onChange={(e) => update({ [key]: e.target.value })}
      >
        <option value="">기본 {title}</option>
        {options.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${title} ${i + 1}`}
          </option>
        ))}
        {selected && !options.some((d) => d.deviceId === selected) && (
          <option value={selected}>
            {selected === "muted" ? "소리 끄기" : `선택한 ${title}`}
          </option>
        )}
      </select>
    )
  }
  const retryMedia = () => setRetry((value) => value + 1)
  const showCamera =
    cam && (!enhanced || cameraStatus === copy.prejoinConnected)
  const waiting =
    probe.state === "connected" ? probe.result.waitingStudents || [] : []
  const heading = (
    <>
      <Badge tone={status === "LIVE" ? "live" : "blue"}>
        {status === "LIVE" ? "진행 중" : lesson.state}
      </Badge>
      <h1>{lesson.title}</h1>
      <p className="join-lesson-meta">
        {lesson.teacher.name} 선생님 · {lesson.date.replace(",", "")}
      </p>
    </>
  )
  const account = (
    <div className="account-row">
      <Avatar name={user.name} color={colorFor(user.id)} />
      <div>
        <small>다음 계정으로 참여</small>
        <strong>
          {user.name} {user.role === "teacher" ? "선생님" : "학생"}
        </strong>
      </div>
    </div>
  )
  return (
    <main className={`join-page${enhanced ? " join-check-page" : ""}`}>
      <div className="prejoin">
        {enhanced && (
          <header className="prejoin-info join-check-header">
            <div>{heading}</div>
            {account}
          </header>
        )}
        <section className="preview-wrap" aria-label="입장 전 기기 확인">
          <div className={`join-preview ${!showCamera ? "camera-off" : ""}`}>
            {cam && (
              <video
                ref={video}
                autoPlay
                muted
                playsInline
                aria-label="카메라 미리보기"
                style={enhanced && !showCamera ? { opacity: 0 } : undefined}
              />
            )}
            {!showCamera && (
              <div className="join-preview-person">
                <Avatar name={user.name} color={colorFor(user.id)} />
                <p>{cam ? cameraStatus : "카메라가 꺼져 있습니다"}</p>
              </div>
            )}
            <span className="join-preview-name">{user.name} · 나</span>
            <div className="preview-controls">
              <button
                className={!mic ? "off" : ""}
                onClick={() => update({ mic: !mic })}
                aria-label={mic ? "마이크 끄기" : "마이크 켜기"}
                aria-pressed={mic}
              >
                <Icon name={mic ? "mic" : "micOff"} size={23} />
              </button>
              <button
                className={!cam ? "off" : ""}
                onClick={() => update({ cam: !cam })}
                aria-label={cam ? "카메라 끄기" : "카메라 켜기"}
                aria-pressed={cam}
              >
                <Icon name={cam ? "video" : "videoOff"} size={23} />
              </button>
            </div>
          </div>
          {!enhanced && (
            <>
              <div className="join-device-selectors">
                <label>
                  <Icon name="mic" size={19} />
                  {picker("audioinput", "microphoneId", copy.prejoinMicrophone)}
                </label>
                <label>
                  <Icon name="video" size={19} />
                  {picker("videoinput", "cameraId", copy.prejoinCamera)}
                </label>
              </div>
              {inputMeter}
              <p className="join-preview-note">
                말씀하시면 마이크 입력이 표시됩니다.
              </p>
              {(cameraError || microphoneError) && (
                <div className="service-error" role="status">
                  <div>
                    {cameraError && <p>{cameraError}</p>}
                    {microphoneError && <p>{microphoneError}</p>}
                    <button
                      className="device-permission-retry"
                      onClick={() => {
                        update({ cam: true, mic: true })
                        setRetry((value) => value + 1)
                      }}
                    >
                      기기 연결 다시 확인
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
        <aside className="prejoin-info">
          {enhanced ? (
            <>
              <section
                className="join-check-panel"
                aria-label={copy.prejoinDevices}
              >
                <h2>{copy.prejoinDevices}</h2>
                <CheckRow
                  icon="video"
                  title={copy.prejoinCamera}
                  status={deviceStatus(cam, cameraStatus)}
                >
                  {picker("videoinput", "cameraId", copy.prejoinCamera)}
                  {cam &&
                    cameraStatus !== copy.prejoinConnected &&
                    cameraStatus !== copy.prejoinChecking && (
                      <button
                        className="ghost"
                        title={cameraError || undefined}
                        onClick={retryMedia}
                      >
                        {copy.prejoinRetry}
                      </button>
                    )}
                </CheckRow>
                <CheckRow
                  icon="mic"
                  title={copy.prejoinMicrophone}
                  status={deviceStatus(mic, micStatus)}
                >
                  {picker("audioinput", "microphoneId", copy.prejoinMicrophone)}
                  {mic &&
                    micStatus !== copy.prejoinConnected &&
                    micStatus !== copy.prejoinChecking && (
                      <button
                        className="ghost"
                        title={microphoneError || undefined}
                        onClick={retryMedia}
                      >
                        {copy.prejoinRetry}
                      </button>
                    )}
                  {inputMeter}
                </CheckRow>
                <SpeakerCheck
                  device={devices.speakerId}
                  visible={visible}
                  picker={
                    "setSinkId" in HTMLMediaElement.prototype ? (
                      picker("audiooutput", "speakerId", copy.prejoinSpeaker)
                    ) : (
                      <span>{copy.prejoinSystemOutput}</span>
                    )
                  }
                />
                <CheckRow
                  icon="wifi"
                  title={copy.prejoinNetwork}
                  status={
                    probe.state === "connected"
                      ? `${probe.millis} ms`
                      : probe.state === "failed"
                        ? copy.prejoinFailed
                        : copy.prejoinChecking
                  }
                  healthy={probe.state === "connected"}
                >
                  <span>{copy.prejoinServer}</span>
                  {probe.state === "failed" && (
                    <button
                      className="ghost"
                      onClick={() => setProbeRetry((value) => value + 1)}
                    >
                      {copy.prejoinRetry}
                    </button>
                  )}
                </CheckRow>
              </section>
              {role === "teacher" && scheduled && (
                <section
                  className="join-waiting-students"
                  aria-label={copy.prejoinWaitingStudents}
                  role="status"
                >
                  <h2>
                    {copy.prejoinWaitingStudents}
                    {waiting.length > 1 ? ` · ${waiting.length}명` : ""}
                  </h2>
                  <p>
                    {probe.state === "checking"
                      ? copy.prejoinChecking
                      : probe.state === "failed"
                        ? copy.prejoinWaitingFailed
                        : waiting.length === 0
                          ? copy.prejoinWaitingEmpty
                          : waiting.map((student) => student.name).join(", ")}
                  </p>
                </section>
              )}
            </>
          ) : (
            heading
          )}
          {lesson.accessMode === "OPEN" && (
            <p className="join-open-notice">
              <Icon name="globe" size={17} />
              <span>
                <strong>공개 수업</strong>로그인한 누구나 참여할 수 있어요.
              </span>
            </p>
          )}
          {(!enhanced || !scheduled) && (
            <div className="join-participants">
              {participants.length > 0 && (
                <div className="join-avatar-stack" aria-hidden="true">
                  {participants.slice(0, 3).map((p) => (
                    <Avatar
                      key={p.id}
                      name={p.name}
                      color={colorFor(p.id)}
                      small
                    />
                  ))}
                </div>
              )}
              <span>
                {participants.length
                  ? `${participants.length}명이 먼저 참여하고 있어요`
                  : "아직 참여 중인 사람이 없어요"}
              </span>
            </div>
          )}
          {!enhanced && (
            <>
              {account}
              <div className="device-check" aria-live="polite">
                <span>
                  <Icon name={mic ? "mic" : "micOff"} size={17} />
                  마이크 {mic ? "켜짐" : "꺼짐"}
                </span>
                <span>
                  <Icon name={cam ? "video" : "videoOff"} size={17} />
                  카메라 {cam ? "켜짐" : "꺼짐"}
                </span>
              </div>
            </>
          )}
          {error && (
            <p className="service-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary full join-submit"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError("")
              try {
                await onJoin(devices)
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "수업에 입장하지 못했어요.",
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy
              ? "입장 확인 중…"
              : scheduled && lesson.teacher.id === user.id
                ? lessonModes ? copy.meetingEnter : "수업 시작하기"
                : enhanced && scheduled
                  ? copy.prejoinWaitAction
                  : "지금 참여하기"}
            <Icon name="chevron" size={18} />
          </button>
          {!enhanced && (
            <p className="join-ready-note">
              {!mic && !cam
                ? "카메라와 마이크를 끈 상태로 참여합니다."
                : "준비가 되면 참여해 주세요."}
            </p>
          )}
        </aside>
      </div>
    </main>
  )
}
function CheckRow({
  icon,
  title,
  status,
  healthy = status === copy.prejoinConnected,
  children,
}: {
  icon: Parameters<typeof Icon>[0]["name"]
  title: string
  status: string
  healthy?: boolean
  children: ReactNode
}) {
  return (
    <div className="join-check-row">
      <Icon name={icon} size={20} />
      <div className="join-check-body">
        <div className="join-check-title">
          <strong>{title}</strong>
          <span className={healthy ? "healthy" : ""}>{status}</span>
        </div>
        <div className="join-check-detail">{children}</div>
      </div>
    </div>
  )
}

function SpeakerCheck({
  device,
  visible,
  picker,
}: {
  device?: string
  visible: boolean
  picker: ReactNode
}) {
  const [status, setStatus] = useState<string>(copy.prejoinSoundReady)
  const playing = useRef<(() => void) | null>(null)
  useEffect(() => {
    setStatus(copy.prejoinSoundReady)
    return () => playing.current?.()
  }, [device, visible])
  const test = async () => {
    if (playing.current) return
    const url = URL.createObjectURL(prejoinTestTone())
    const audio = new Audio(url)
    const stop = () => {
      audio.pause()
      audio.removeAttribute("src")
      URL.revokeObjectURL(url)
      playing.current = null
    }
    playing.current = stop
    const complete = (next: string) => {
      if (playing.current !== stop) return
      stop()
      setStatus(next)
    }
    audio.onended = () => complete(copy.prejoinSoundPlayed)
    audio.onerror = () => complete(copy.prejoinSoundFailed)
    setStatus(copy.prejoinSoundPlaying)
    try {
      if (device && device !== "muted" && "setSinkId" in audio)
        await audio.setSinkId(device)
      if (playing.current === stop) await audio.play()
    } catch {
      complete(copy.prejoinSoundFailed)
    }
  }
  return (
    <CheckRow
      icon="speaker"
      title={copy.prejoinSpeaker}
      status={status}
      healthy={status === copy.prejoinSoundPlayed}
    >
      {picker}
      <button
        className="ghost"
        disabled={status === copy.prejoinSoundPlaying}
        onClick={() => void test()}
      >
        {copy.prejoinSoundTest}
      </button>
    </CheckRow>
  )
}

export function Waiting({
  setScreen,
  lesson,
  user,
  error,
  enhanced = false,
}: {
  setScreen: (s: Screen) => void
  lesson: Lesson
  user: User
  error?: string
  enhanced?: boolean
}) {
  const lessonModes = useFeature(FEATURE_IDS.ClassroomLessonModes)
  return (
    <main className="center-page join-waiting-page">
      <section className="waiting-card">
        <div className="join-waiting-icon">
          <Icon name="clock" size={28} />
        </div>
        <Badge tone="blue">입장 대기 중</Badge>
        <h1>곧 수업이 시작돼요</h1>
        <p>
          {lesson.title} · {lesson.teacher.name} 선생님
          <br />
          {lessonModes ? copy.meetingWaitForTeacher : "선생님이 수업을 시작할 때까지 잠시 기다려 주세요."}
        </p>
        <div className="wait-account">
          <Avatar name={user.name} color={colorFor(user.id)} small />
          <span>
            {user.name} {user.role === "teacher" ? "선생님" : "학생"}으로 대기
            중
          </span>
        </div>
        {error && (
          <p className="service-error" role="status">
            {error}
          </p>
        )}
        <button className="secondary full" onClick={() => setScreen("prejoin")}>
          {enhanced ? copy.prejoinRecheck : "카메라·마이크 확인하기"}
        </button>
        <button className="ghost full" onClick={() => setScreen("home")}>
          대기 나가기
        </button>
      </section>
    </main>
  )
}
