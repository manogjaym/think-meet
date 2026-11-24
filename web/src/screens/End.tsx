import { useEffect, useState } from "react"
import type { Lesson } from "./Home"
import { EndedRecordingUploads } from "../components/LessonRecordings"
import type { Role, Screen } from "../models"
import type { User } from "../lib/api"
import { Icon } from "../components/ui"
import { designContent as content } from "../generated/design-content"
import { lessonRecordStart } from "../lib/lessonRecord"
import { noteCaptures, notesFeature } from "../lib/classNotes"
import { useFeature } from "../lib/useFeature"
import { FEATURE_IDS } from "../generated/feature-policy"

/** Minutes the user spent in the lesson: teachers see the lesson length, students their own attendance. */
function lessonMinutes(lesson: Lesson, user: User, role: Role, bySubject: boolean) {
  const fallbackFinish = lesson.endedAt || sessionStorage.getItem(`think-meet.left.${lesson.id}`) || new Date().toISOString()
  if (role === "student") {
    const intervals = lesson.attendance?.filter(item => item.userId === user.id) || []
    if (!intervals.length) return null
    return intervals.reduce((total, item) => total + Math.max(0, Date.parse(item.leftAt || fallbackFinish) - Date.parse(item.joinedAt)), 0) / 60000
  }
  const startedAt = bySubject && lesson.subject ? lessonRecordStart(lesson) : lesson.startedAt
  return startedAt ? Math.max(0, Date.parse(fallbackFinish) - Date.parse(startedAt)) / 60000 : null
}

/** Screens this user saved during the lesson; undefined while loading or when the list is unavailable. */
function useSavedScreens(lessonId: string, enabled: boolean) {
  const [count, setCount] = useState<number>()
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    noteCaptures(controller.signal)
      .then(rows => setCount(rows.filter(row => row.lesson.id === lessonId && row.source === "self").length))
      .catch(() => undefined)
    return () => controller.abort()
  }, [lessonId, enabled])
  return count
}

export function Ended({
  role,
  setScreen,
  lesson,
  user,
  onRecords,
}: {
  role: Role
  setScreen: (s: Screen) => void
  lesson: Lesson
  user: User
  onRecords: () => void
}) {
  const ended = lesson.status === "ENDED"
  const subjectsEnabled = useFeature(FEATURE_IDS.ClassroomSubjects)
  const notesEnabled = useFeature(notesFeature)
  const minutes = lessonMinutes(lesson, user, role, subjectsEnabled)
  const saved = useSavedScreens(lesson.id, notesEnabled)
  return (
    <main className="center-page">
      <section className="ended-screen" aria-labelledby="ended-title">
        <div className="ended-check">
          <Icon name="check" size={36} />
        </div>
        <h1 id="ended-title">{ended ? content.endedTitle : content.endedLeftTitle}</h1>
        <dl className="ended-stats">
          <div>
            <dt>{content.endedDuration}</dt>
            <dd>{minutes === null ? "–" : `${Math.round(minutes)}분`}</dd>
          </div>
          {notesEnabled && <div>
            <dt>{content.endedSavedScreens}</dt>
            <dd>{saved === undefined ? "–" : `${saved}장`}</dd>
          </div>}
        </dl>
        {lesson.teacher.id === user.id && <EndedRecordingUploads lessonId={lesson.id} />}
        <div className="ended-actions">
          <button className="primary" onClick={() => notesEnabled ? onRecords() : setScreen("detail")}>
            {content.endedViewRecords}
          </button>
          <button className="outline" onClick={() => setScreen("home")}>
            {content.endedHome}
          </button>
        </div>
        {!ended && (
          <button className="ghost ended-rejoin" onClick={() => setScreen("prejoin")}>
            {content.endedRejoin}
          </button>
        )}
      </section>
    </main>
  )
}
export type { ExceptionType } from "../routes"
import type { ExceptionType } from "../routes"
const copy: Record<ExceptionType, [string, string]> = {
  invalid: [
    "수업을 찾을 수 없어요",
    "링크 또는 참여 코드가 올바른지 확인해 주세요.",
  ],
  account: [
    "초대된 계정이 아니에요",
    "초대받은 계정으로 다시 로그인해 주세요.",
  ],
  cancelled: ["취소된 수업이에요", "선생님이 이 수업 일정을 취소했습니다."],
  ended: [
    "이미 종료된 수업이에요",
    "지난 수업 기록은 홈에서 확인할 수 있어요.",
  ],
  failed: [
    "수업 입장에 실패했어요",
    "네트워크 상태를 확인한 후 다시 시도해 주세요.",
  ],
  kicked: [
    "선생님에 의해 수업에서 퇴장되었습니다",
    "수업에 다시 참여하려면 선생님에게 문의해 주세요.",
  ],
  moved: [
    "다른 기기에서 수업에 참여했어요",
    "같은 계정으로 새로 입장하여 이 기기의 연결이 종료되었습니다.",
  ],
}
export function Exception({
  setScreen,
  type = "failed",
  message,
  onLogout,
}: {
  setScreen: (s: Screen) => void
  type?: ExceptionType
  message?: string
  onLogout?: () => void
}) {
  return (
    <main className="center-page">
      <div className="exception-card">
        <div className="error-icon">
          <Icon name="alert" size={28} />
        </div>
        <h1>{copy[type][0]}</h1>
        <p>{message || copy[type][1]}</p>
        <button
          className="primary full"
          onClick={() => setScreen(type === "failed" ? "prejoin" : "home")}
        >
          {type === "failed" ? "다시 시도" : "홈으로 돌아가기"}
        </button>
        {type === "account" && onLogout && (
          <button className="ghost full" onClick={onLogout}>
            다른 계정으로 로그인
          </button>
        )}
      </div>
    </main>
  )
}
