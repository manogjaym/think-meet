import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import type { ApiLesson, User } from "../../src/lib/api"
import type { MeetingSnapshot } from "../../src/lib/meeting"
import type { Panel } from "../../src/models"
import { useChatNotifications } from "../../src/components/meeting/useChatNotifications"
import { ChatNotification } from "../../src/components/meeting/ChatNotification"
import { CallControls } from "../../src/components/meeting/CallControls"
import { SidePanel } from "../../src/components/meeting/SidePanel"
import "../../src/index.css"
import "../../src/meeting.css"
import "../../src/components/meeting/live-meeting.css"
import "../../src/components/meeting/chat-notifications.css"
import "../../src/components/meeting/chat-notification-badges.css"

type Message = MeetingSnapshot["messages"][number]
type FixtureEvent = {
  append?: Message[]
  replace?: Message[]
  lessonId?: string
  userId?: string
  rerender?: boolean
}

const teacher: User = { id: "teacher", username: "teacher", name: "윤지아", role: "teacher" }
const student: User = { id: "student", username: "student", name: "김민준", role: "student" }
const oldMessage: Message = { id: "old-message", clientId: "old-message", userId: teacher.id, userName: teacher.name, text: "입장 전 메시지", createdAt: "2026-11-09T07:00:00.000Z" }

function Harness() {
  const [messages, setMessages] = useState<Message[]>([oldMessage])
  const [lessonId, setLessonId] = useState("lesson-one")
  const [userId, setUserId] = useState(student.id)
  const [panel, setPanel] = useState<Panel>(null)
  const [lastPanel, setLastPanel] = useState<Panel>(null)
  const { unreadCount, notification, dismissNotification } = useChatNotifications({ lessonId, userId, messages, chatOpen: panel === "chat" })
  const user = { ...student, id: userId }
  const lesson: ApiLesson = { id: lessonId, title: "화상 수업 채팅", description: "", teacher, students: [user], startsAt: oldMessage.createdAt, endsAt: null, status: "LIVE", code: "chat", startedAt: oldMessage.createdAt, endedAt: null }
  const snapshot: MeetingSnapshot = { lessonId, lesson, participants: [teacher, user].map(person => ({ user: person, online: true, raised: false })), messages, share: null, strokes: [], seq: messages.length, serverTime: oldMessage.createdAt }
  const changePanel = (next: Panel) => {
    setPanel(next)
    if (next) setLastPanel(next)
  }

  useEffect(() => {
    document.body.classList.add("meeting-viewport")
    const update = (event: Event) => {
      const data = (event as CustomEvent<FixtureEvent>).detail
      if (data.lessonId) setLessonId(data.lessonId)
      if (data.userId) setUserId(data.userId)
      if (data.replace) setMessages(data.replace)
      else if (data.append) setMessages(current => [...current, ...data.append!])
      else if (data.rerender) setMessages(current => current.map(message => ({ ...message })))
    }
    window.addEventListener("chat-fixture", update)
    return () => { document.body.classList.remove("meeting-viewport"); window.removeEventListener("chat-fixture", update) }
  }, [])

  return <main className={`meeting ${panel ? "has-panel" : ""}`} data-testid="chat-fixture">
    <header className="meeting-head"><div className="meeting-title-group"><div><h1>{lesson.title}</h1><span className="meeting-subtitle">선생님과 함께하는 수업</span></div></div></header>
    <div className="meeting-body">
      <div className="meeting-main"><section className="stage" aria-label="수업 화면"><div className="video-tile" style={{ height: "100%" }}><span className="tile-avatar">민준</span></div></section></div>
      <button className="panel-backdrop" aria-label="패널 닫기" aria-hidden={!panel} tabIndex={panel ? 0 : -1} onClick={() => changePanel(null)} />
      <div id="meeting-side-panel" className="meeting-panel-container" inert={!panel} aria-hidden={!panel}>
        <SidePanel panel={panel || lastPanel} setPanel={changePanel} user={user} lesson={lesson} room={null} snapshot={snapshot} command={async () => snapshot} onOutputChange={() => {}} unreadChatCount={unreadCount} />
      </div>
    </div>
    {notification && <ChatNotification message={notification} onOpen={() => changePanel("chat")} onDismiss={dismissNotification} />}
    <CallControls role="student" raised={false} setRaised={() => {}} panel={panel} setPanel={changePanel} screenSharing={false} onShareScreen={() => {}} onEnd={() => {}} mic={false} cam={false} setMic={() => {}} setCam={() => {}} participantCount={2} unreadChatCount={unreadCount} />
  </main>
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
