import { designContent as copy } from "../generated/design-content"
import { useFeature } from "../lib/useFeature"
import { useEffect, useRef, useState } from "react"
import type { Lesson } from "./Home"
import type { Role, Screen } from "../models"
import type { User } from "../lib/api"
import { colorFor } from "../lib/api"
import { readDevicePreferences, saveDevicePreferences } from "../lib/meeting"
import { Avatar, Badge, Icon } from "../components/ui"

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
  initialDevices,
  onJoin,
}: {
  lesson: Lesson
  user: User
  role: Role
  setScreen: (s: Screen) => void
  initialDevices?: JoinDevices
  onJoin: (devices: JoinDevices) => Promise<void>
}) {
  const lessonModes = useFeature("classroom.lesson-modes")
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
    if (!devices.cam) return
    setCameraError("")
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("카메라는 신뢰된 HTTPS 연결에서 사용할 수 있어요.")
      setDevices((current) => ({ ...current, cam: false }))
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
          await video.current.play().catch(() => {})
        }
        setAvailable(await navigator.mediaDevices.enumerateDevices())
      })
      .catch((e) => {
        if (!cancelled) {
          setCameraError(mediaError(e))
          setDevices((current) => ({ ...current, cam: false }))
        }
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
      if (video.current) video.current.srcObject = null
    }
  }, [devices.cam, devices.cameraId, retry])
  useEffect(() => {
    let cancelled = false,
      stream: MediaStream | null = null,
      context: AudioContext | null = null,
      frame = 0
    if (!devices.mic) {
      setLevel(0)
      return
    }
    setMicrophoneError("")
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophoneError("마이크는 신뢰된 HTTPS 연결에서 사용할 수 있어요.")
      setDevices((current) => ({ ...current, mic: false }))
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
        setAvailable(await navigator.mediaDevices.enumerateDevices())
        if (cancelled) return
        context = new AudioContext()
        await context.resume().catch(() => {})
        if (cancelled) return
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
          setMicrophoneError(mediaError(e))
          setDevices((current) => ({ ...current, mic: false }))
        }
      })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close().catch(() => {})
    }
  }, [devices.mic, devices.microphoneId, devices.noise, retry])
  const { mic, cam } = devices
  const participants = lesson.students.filter((student) =>
    lesson.participants?.some((p) => p.userId === student.id),
  )
  return (
    <main className="join-page">
      <div className="prejoin">
        <section className="preview-wrap" aria-label="입장 전 기기 확인">
          <div className={`join-preview ${!cam ? "camera-off" : ""}`}>
            {cam && (
              <video
                ref={video}
                autoPlay
                muted
                playsInline
                aria-label="카메라 미리보기"
              />
            )}
            {!cam && (
              <div className="join-preview-person">
                <Avatar name={user.name} color={colorFor(user.id)} />
                <p>카메라가 꺼져 있습니다</p>
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
          <div className="join-device-selectors">
            <label>
              <Icon name="mic" size={19} />
              <select
                value={devices.microphoneId || ""}
                onChange={(e) => update({ microphoneId: e.target.value })}
                aria-label="마이크 선택"
              >
                <option value="">기본 마이크</option>
                {available
                  .filter((d) => d.kind === "audioinput")
                  .map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `마이크 ${i + 1}`}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <Icon name="video" size={19} />
              <select
                value={devices.cameraId || ""}
                onChange={(e) => update({ cameraId: e.target.value })}
                aria-label="카메라 선택"
              >
                <option value="">기본 카메라</option>
                {available
                  .filter((d) => d.kind === "videoinput")
                  .map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `카메라 ${i + 1}`}
                    </option>
                  ))}
              </select>
            </label>
          </div>
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
        </section>
        <aside className="prejoin-info">
          <Badge tone={lesson.status === "LIVE" ? "live" : "blue"}>
            {lesson.state}
          </Badge>
          <h1>{lesson.title}</h1>
          <p className="join-lesson-meta">
            {lesson.teacher.name} 선생님 · {lesson.date.replace(",", "")}
          </p>
          {lesson.accessMode === "OPEN" && (
            <p className="join-open-notice">
              <Icon name="globe" size={17} />
              <span>
                <strong>공개 수업</strong>로그인한 누구나 참여할 수 있어요.
              </span>
            </p>
          )}
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
          <div className="account-row">
            <Avatar name={user.name} color={colorFor(user.id)} />
            <div>
              <small>다음 계정으로 참여</small>
              <strong>
                {user.name} {user.role === "teacher" ? "선생님" : "학생"}
              </strong>
            </div>
          </div>
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
              : lesson.status === "SCHEDULED" && lesson.teacher.id === user.id
                ? lessonModes ? copy.meetingEnter : "수업 시작하기"
                : "지금 참여하기"}
            <Icon name="chevron" size={18} />
          </button>
          <p className="join-ready-note">
            {!mic && !cam
              ? "카메라와 마이크를 끈 상태로 참여합니다."
              : "준비가 되면 참여해 주세요."}
          </p>
        </aside>
      </div>
    </main>
  )
}
export function Waiting({
  setScreen,
  lesson,
  user,
  error,
}: {
  setScreen: (s: Screen) => void
  lesson: Lesson
  user: User
  error?: string
}) {
  const lessonModes = useFeature("classroom.lesson-modes")
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
          카메라·마이크 확인하기
        </button>
        <button className="ghost full" onClick={() => setScreen("home")}>
          대기 나가기
        </button>
      </section>
    </main>
  )
}
