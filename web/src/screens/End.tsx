import type { Lesson } from "./Home"
import type { Role, Screen } from "../models"
import type { User } from "../lib/api"
import { Badge, Icon } from "../components/ui"
import { designContent } from "../generated/design-content"
import { lessonRecordStart } from "../lib/lessonRecord"
import { useFeature } from "../lib/useFeature"
const timeFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "numeric",
  minute: "2-digit",
})
export function Ended({
  role,
  setScreen,
  lesson,
  user,
}: {
  role: Role
  setScreen: (s: Screen) => void
  lesson: Lesson
  user: User
}) {
  const ended = lesson.status === "ENDED"
  const subjectsEnabled = useFeature("classroom.subjects")
  const intervals = lesson.attendance?.filter(item => item.userId === user.id) || []
  const personalStart = intervals.length ? new Date(Math.min(...intervals.map(item=>Date.parse(item.joinedAt)))) : null
  const localFinish = sessionStorage.getItem(`think-meet.left.${lesson.id}`)
  const fallbackFinish = lesson.endedAt || localFinish || new Date().toISOString()
  const startedAt = subjectsEnabled && lesson.subject ? lessonRecordStart(lesson) : lesson.startedAt
  const start = role === "student" ? personalStart : startedAt ? new Date(startedAt) : null
  const finish = role === "student" && intervals.length ? new Date(Math.max(...intervals.map(item=>Date.parse(item.leftAt || fallbackFinish)))) : new Date(fallbackFinish)
  const duration = role === "student" ? intervals.reduce((total,item)=>total+Math.max(0,Date.parse(item.leftAt || fallbackFinish)-Date.parse(item.joinedAt)),0) : start ? finish.getTime()-start.getTime() : 0
  const elapsed = start ? `${timeFormat.format(start)} – ${timeFormat.format(finish)} · ${Math.max(0,Math.round(duration/60000))}분` : role === "student" ? "참여 기록이 없어요" : "수업이 시작되지 않았어요"
  return (
    <main className="center-page">
      <div className="ended-card">
        <div className="ended-icon">
          <Icon name="phone" size={30} />
        </div>
        <Badge tone="default">
          {ended ? "수업 종료 완료" : "수업에서 나감"}
        </Badge>
        <h1>{ended ? "수업이 모두 종료되었어요" : "수업을 나왔어요"}</h1>
        <p>
          {ended && role === "teacher"
            ? "참여 학생에게 종료 안내를 보냈습니다."
            : ended
              ? "선생님이 수업을 종료했어요."
              : "다른 참여자는 수업을 계속할 수 있어요."}
        </p>
        <div className="ended-summary">
          <div>
            <small>학습 제목</small>
            <strong>{lesson.title}</strong>
          </div>
          {subjectsEnabled && lesson.subject && <div>
            <small>{designContent.lessonSubjectLabel}</small>
            <strong>{lesson.subject.name}</strong>
          </div>}
          <div>
            <small>{role === "student" ? "내 참여 시간" : ended ? "실제 진행 시간" : "현재까지 진행 시간"}</small>
            <strong>{elapsed}</strong>
          </div>
          <div>
            <small>종료 상태</small>
            <Badge tone="default">{ended ? "정상 종료" : "개인 퇴장"}</Badge>
          </div>
        </div>
        <button className="primary full" onClick={() => setScreen("home")}>
          홈으로 돌아가기
        </button>
        {!ended && (
          <button className="ghost full" onClick={() => setScreen("prejoin")}>
            수업에 다시 참여
          </button>
        )}
      </div>
    </main>
  )
}
export type ExceptionType = "invalid" | "account" | "cancelled" | "ended" | "failed" | "kicked" | "moved"
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
