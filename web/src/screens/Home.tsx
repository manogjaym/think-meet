import { ClassNotesHome, type NotesTab } from "./ClassNotes"
import { designContent } from "../generated/design-content"
import { useState } from "react"
import { colorFor, displayLesson, type User } from "../lib/api"
import type { Role, Screen } from "../models"
import { Avatar, Icon } from "../components/ui"

export type Lesson = ReturnType<typeof displayLesson>

export type HomeView = {
  tab: "live" | "upcoming" | "history"
  search: string
  selectedLiveLessonId?: string
}

function orderByDate(item: Lesson) {
  if (item.dateISO && item.startTime)
    return new Date(`${item.dateISO}T${item.startTime}:00+09:00`).getTime()
  const year = new Intl.DateTimeFormat("en", {
    year: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date())
  const parts = new Intl.DateTimeFormat("en", {
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).formatToParts(new Date())
  const date = item.date.match(/(\d+)월\s*(\d+)일/)
  const month = date?.[1] || parts.find((p) => p.type === "month")?.value || "1"
  const day = date?.[2] || parts.find((p) => p.type === "day")?.value || "1"
  const time = item.date.match(/(오전|오후)\s*(\d+):(\d+)/)
  const hour = time ? (Number(time[2]) % 12) + (time[1] === "오후" ? 12 : 0) : 0
  return new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${time?.[3] || "00"}:00+09:00`,
  ).getTime()
}

export function Home({
  role,
  setScreen,
  onOpen,
  onJoin,
  lessons,
  user,
  onJoinCode,
  onNotes,
  view,
  onViewChange,
}: {
  role: Role
  lessons: Lesson[]
  user: User
  onNotes?: (tab: NotesTab) => void
  onJoinCode: (code: string) => Promise<void>
  setScreen: (screen: Screen) => void
  onOpen: (lesson: Lesson) => void
  onJoin: (lesson?: Lesson) => void
  view?: HomeView
  onViewChange?: (view: HomeView) => void
}) {
  const [localView, setLocalView] = useState<HomeView>({
    tab: "upcoming",
    search: "",
  })
  const currentView = view ?? localView
  const { tab, search, selectedLiveLessonId } = currentView
  const updateView = (changes: Partial<HomeView>) => {
    const next = { ...currentView, ...changes }
    setLocalView(next)
    onViewChange?.(next)
  }
  const setTab = (tab: HomeView["tab"]) => updateView({ tab })
  const setSearch = (search: string) => updateView({ search })
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [joining, setJoining] = useState(false)
  const liveLessons = lessons.filter((lesson) => lesson.state === "진행 중")
  const live =
    liveLessons.find((lesson) => lesson.id === selectedLiveLessonId) ||
    liveLessons[0]
  const upcoming = lessons
    .filter((lesson) => lesson.state === "예정")
    .sort((a, b) => orderByDate(a) - orderByDate(b))
  const past = [
    ...lessons.filter(
      (lesson) => lesson.state === "종료" || lesson.state === "취소",
    ),
  ].sort((a, b) => orderByDate(b) - orderByDate(a))
  const filtered = (
    tab === "live" ? liveLessons : tab === "upcoming" ? upcoming : past
  ).filter((lesson) =>
    `${lesson.title} ${lesson.people} ${lesson.studentNames.join(" ")} ${
      lesson.accessMode === "OPEN" ? "공개 수업" : ""
    }`.includes(search.trim()),
  )
  const selectLiveLesson = (lesson: Lesson) => {
    updateView({ selectedLiveLessonId: lesson.id })
    document.getElementById("live-lesson-feature")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    })
  }
  const today = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Seoul",
  }).format(new Date())
  const students = [
    ...new Map(
      lessons
        .flatMap((lesson) => lesson.students)
        .map((student) => [student.id, student]),
    ).values(),
  ].map((student) => ({ ...student, color: colorFor(student.id) }))
  const liveStudents = live?.students || []
  const joinedStudents = liveStudents
    .filter((student) =>
      live?.participants?.some((p) => p.userId === student.id),
    )
    .map((student) => ({ ...student, color: colorFor(student.id) }))
  const timeLabel = live?.date.split(", ")[1] || "오후 4:00"

  const renderSide = (quickJoin: React.ReactNode) => onNotes ? <div className="note-home-stack">
    <ClassNotesHome refreshKey={lessons.map(item => `${item.id}:${item.state}:${item.date}`).join("|")} onOpen={onNotes} />
    {quickJoin}
  </div> : quickJoin

  return (
    <main className="class-dashboard">
      <header className="dashboard-heading">
        <div>
          <p className="dashboard-greeting">
            {user.name} {role === "teacher" ? "선생님" : "학생"}의 클래스
          </p>
          <h1>{designContent.homeTitle}</h1>
        </div>
        <div className="dashboard-heading-actions">
          <span className="dashboard-today">
            <Icon name="calendar" size={16} />
            {today}
          </span>
          {role === "teacher" && (
            <button
              className="dashboard-reserve"
              onClick={() => setScreen("form")}
            >
              <Icon name="plus" size={18} />새 수업 예약
            </button>
          )}
        </div>
      </header>

      <div className="dashboard-feature-grid">
        {live ? (
          <section
            className="session-feature"
            id="live-lesson-feature"
            aria-label="진행 중인 수업"
          >
            <div className="session-feature-top">
              <span className="session-live">
                <i />
                진행 중
              </span>
              <span className="session-time">
                <Icon name="clock" size={15} />
                {timeLabel}
                <span>·</span>
                {live.duration}
              </span>
            </div>
            <div
              className="session-feature-copy"
              aria-live="polite"
              aria-atomic="true"
            >
              <p
                className={
                  live.accessMode === "OPEN"
                    ? "session-access-label"
                    : undefined
                }
              >
                {live.accessMode === "OPEN" ? (
                  <>
                    <Icon name="globe" size={15} />
                    공개 수업<span aria-hidden="true">·</span>누구나 참여 가능
                  </>
                ) : (
                  "초등 5학년 수학"
                )}
              </p>
              <h2>{live.title}</h2>
              <span>{live.teacher.name} 선생님과 함께하는 화상 수업</span>
            </div>
            <div className="session-feature-bottom">
              <div className="session-attendees">
                {joinedStudents.length > 0 && (
                  <div className="session-avatars">
                    {joinedStudents.slice(0, 3).map((student) => (
                      <Avatar
                        key={student.id}
                        name={student.name}
                        color={student.color}
                        small
                      />
                    ))}
                  </div>
                )}
                <span>
                  <strong>{joinedStudents.length}명</strong> 참여 중
                  {live.accessMode !== "OPEN" && (
                    <span className="session-invited">
                      {" "}
                      / {liveStudents.length}명
                    </span>
                  )}
                </span>
              </div>
              <button className="session-enter" onClick={() => onJoin(live)}>
                {live.teacher.id === user.id
                  ? "수업으로 돌아가기"
                  : "수업 참여"}
                <Icon name="chevron" size={18} />
              </button>
            </div>
          </section>
        ) : (
          <section
            className="session-feature session-idle"
            aria-label="오늘의 수업"
          >
            <div className="session-feature-top">
              <span className="session-idle-label">
                <Icon name="video" size={17} />
                나의 클래스룸
              </span>
              <span className="session-time">
                {upcoming.length}개의 예정 수업
              </span>
            </div>
            <div className="session-feature-copy">
              <p>다음 만남을 준비하는 시간</p>
              <h2>지금 진행 중인 수업이 없어요</h2>
              <span>예정된 수업을 확인하거나 수업 링크로 참여하세요.</span>
            </div>
            <button
              className="session-idle-action"
              onClick={() =>
                document
                  .getElementById("dashboard-schedule")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              수업 일정 확인
              <Icon name="chevron" size={16} />
            </button>
          </section>
        )}

        {renderSide(<section className="quick-join" aria-label="링크로 수업 참여">
          <div className="quick-join-copy">
            <span className="quick-join-icon" aria-hidden="true">
              <Icon name="link" size={19} />
            </span>
            <h2>{designContent.quickJoinTitle}</h2>
            <p>{designContent.quickJoinDescription}</p>
          </div>
          <form
            className="quick-join-form"
            onSubmit={async (event) => {
              event.preventDefault()
              if (code.trim().length < 6) {
                setError("6자 이상의 코드나 수업 링크를 입력해 주세요.")
                return
              }
              setError("")
              setJoining(true)
              try {
                await onJoinCode(code.trim())
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "수업을 찾지 못했어요.",
                )
              } finally {
                setJoining(false)
              }
            }}
          >
            <label className={`quick-join-input ${error ? "has-error" : ""}`}>
              <span className="sr-only">수업 코드 또는 링크</span>
              <input
                value={code}
                onChange={(event) => {
                  setCode(event.target.value)
                  setError("")
                }}
                placeholder={designContent.quickJoinPlaceholder}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "join-code-error" : undefined}
              />
              <button
                type="submit"
                aria-label="입장 준비"
                disabled={!code.trim() || joining}
              >
                <Icon name="chevron" size={18} />
              </button>
            </label>
            {error && (
              <p id="join-code-error" className="quick-join-error" role="alert">
                {error}
              </p>
            )}
          </form>
          <p className="quick-join-note">
            <Icon name="video" size={15} />
            <span>입장 전에 카메라와 마이크를 확인할 수 있어요.</span>
          </p>
        </section>)}
      </div>

      <section
        className="dashboard-schedule"
        id="dashboard-schedule"
        aria-label="수업 일정"
      >
        <div className="dashboard-schedule-heading">
          <h2>{designContent.scheduleTitle}</h2>
          <span>
            {tab === "live"
              ? "수업을 선택하면 상단에서 확인할 수 있어요"
              : tab === "upcoming"
                ? "다가오는 수업을 미리 준비하세요"
                : "함께한 수업을 확인하세요"}
          </span>
        </div>
        <div className="dashboard-list-toolbar">
          <div className="dashboard-tabs" role="tablist" aria-label="수업 목록">
            <button
              role="tab"
              id="live-tab"
              aria-controls="lesson-tabpanel"
              aria-selected={tab === "live"}
              className={tab === "live" ? "active" : ""}
              onClick={() => setTab("live")}
            >
              {designContent.liveTab}<span>{liveLessons.length}</span>
            </button>
            <button
              role="tab"
              id="upcoming-tab"
              aria-controls="lesson-tabpanel"
              aria-selected={tab === "upcoming"}
              className={tab === "upcoming" ? "active" : ""}
              onClick={() => setTab("upcoming")}
            >
              {designContent.upcomingTab}<span>{upcoming.length}</span>
            </button>
            <button
              role="tab"
              id="history-tab"
              aria-controls="lesson-tabpanel"
              aria-selected={tab === "history"}
              className={tab === "history" ? "active" : ""}
              onClick={() => setTab("history")}
            >
              {designContent.historyTab}<span>{past.length}</span>
            </button>
          </div>
          <label className="dashboard-search">
            <Icon name="search" size={17} />
            <input
              aria-label="수업 검색"
              placeholder="수업명, 학생 이름 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button aria-label="검색어 지우기" onClick={() => setSearch("")}>
                <Icon name="close" size={16} />
              </button>
            )}
          </label>
        </div>
        <div
          id="lesson-tabpanel"
          className="dashboard-list"
          role="tabpanel"
          aria-labelledby={`${tab}-tab`}
        >
          {filtered.length > 0 && (
            <div className="dashboard-columns" aria-hidden="true">
              <span>날짜 및 시간</span>
              <span>수업</span>
              <span>참여 학생</span>
              <span>상태</span>
              <span />
            </div>
          )}
          {filtered.map((lesson) => {
            const [date, time] = lesson.date.split(", ")
            const day = date.match(/(\d+)일/)?.[1]
            const month = date.match(/(\d+)월/)?.[1]
            const person = students.find(
              (student) => student.name === lesson.people.split(" ")[0],
            )
            const isLive = lesson.state === "진행 중"
            const isSelected = isLive && lesson.id === live?.id
            return (
              <button
                className={`dashboard-lesson-row${
                  isSelected ? " is-selected" : ""
                }`}
                key={lesson.id}
                aria-pressed={isLive ? isSelected : undefined}
                aria-controls={isLive ? "live-lesson-feature" : undefined}
                onClick={() =>
                  isLive ? selectLiveLesson(lesson) : onOpen(lesson)
                }
              >
                <span className="dashboard-row-date">
                  <strong>{month && day ? `${month}월 ${day}일` : date}</strong>
                  <span>{time}</span>
                </span>
                <span className="dashboard-row-lesson">
                  <strong>{lesson.title}</strong>
                  <span>
                    {lesson.accessMode === "OPEN" ? (
                      <span className="dashboard-access-label">
                        <Icon name="globe" size={13} />
                        공개 수업
                      </span>
                    ) : (
                      "초등 5학년 수학"
                    )}
                    <span aria-hidden="true">·</span>
                    {lesson.duration}
                  </span>
                </span>
                <span className="dashboard-row-people">
                  {lesson.accessMode === "OPEN" ? (
                    <span className="dashboard-open-icon" aria-hidden="true">
                      <Icon name="globe" size={16} />
                    </span>
                  ) : (
                    <Avatar
                      name={person?.name || lesson.people.split(" ")[0]}
                      color={person?.color || "#706e9e"}
                      small
                    />
                  )}
                  <span>{lesson.people}</span>
                </span>
                <span
                  className={`dashboard-row-status ${
                    lesson.state === "취소" ? "cancelled" : ""
                  }`}
                >
                  <i />
                  {lesson.state}
                </span>
                <Icon name={isSelected ? "check" : "chevron"} size={17} />
              </button>
            )
          })}
          {!filtered.length && (
            <div className="dashboard-empty">
              <Icon name={search ? "search" : "calendar"} size={26} />
              <h3>
                {search
                  ? "검색된 수업이 없어요"
                  : tab === "live"
                    ? "지금 진행 중인 수업이 없어요"
                    : tab === "upcoming"
                      ? "예정된 수업이 없어요"
                      : "아직 지난 수업이 없어요"}
              </h3>
              <p>
                {search
                  ? "다른 수업명이나 학생 이름으로 검색해 주세요."
                  : tab === "live"
                    ? "수업이 시작되면 이곳에서 선택할 수 있어요."
                    : "새로운 수업이 등록되면 이곳에 표시됩니다."}
              </p>
              {search && (
                <button onClick={() => setSearch("")}>전체 수업 보기</button>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
