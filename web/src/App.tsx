import { ClassNotes } from "./screens/ClassNotes"
import { AttendanceStudents, StudentAttendance, attendanceFeature } from "./screens/StudentAttendance"
import { designContent } from "./generated/design-content"
import { notesFeature } from "./lib/classNotes"
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom"
import { createAppSocket, requestSocket } from "./lib/socket"
import { useCapabilityRefresh, useFeature } from "./lib/useFeature"
import { useLessonDirectory } from "./lib/useLessonDirectory"
import type { CommandAck, MeetingSnapshot } from "./generated/contracts"
import { SOCKET_EVENTS as Events } from "./generated/contracts"
import { prejoinFeature, registerPrejoinWait } from "./lib/prejoin"
import { createWaitingAdmission } from "./lib/waitingAdmission"
import type { Screen } from "./models"
import { TopBar } from "./components/TopBar"
import { Home, type HomeView } from "./screens/Home"
import { Created, Detail, Form } from "./screens/Lessons"
import { Login } from "./screens/Login"
import { AuthProvider, useAuth } from "./lib/auth"
import {
  api,
  ApiError,
  displayLesson,
  type ApiLesson,
  type JoinResult,
} from "./lib/api"
import { initialJoinDevices, type JoinDevices } from "./screens/Join"
import type { ExceptionType } from "./screens/End"
import {
  ScreenTransition,
  type ScreenMotion,
} from "./components/ScreenTransition"
import "./service.css"

const Prejoin = lazy(() =>
  import("./screens/Join").then((m) => ({ default: m.Prejoin })),
)
const Waiting = lazy(() =>
  import("./screens/Join").then((m) => ({ default: m.Waiting })),
)
const Meeting = lazy(() =>
  import("./screens/Meeting").then((m) => ({ default: m.Meeting })),
)
const Ended = lazy(() =>
  import("./screens/End").then((m) => ({ default: m.Ended })),
)
const Exception = lazy(() =>
  import("./screens/End").then((m) => ({ default: m.Exception })),
)
function exceptionType(error: unknown): ExceptionType {
  const code =
    error instanceof ApiError
      ? error.code.toLowerCase()
      : String(error || "").toLowerCase()
  if (/kick|banned|removed/.test(code)) return "kicked"
  if (/cancel/.test(code)) return "cancelled"
  if (/ended|closed/.test(code)) return "ended"
  if (/invited|forbidden|account/.test(code)) return "account"
  if (/not_found|invalid|404/.test(code)) return "invalid"
  if (/duplicate|moved|replaced/.test(code)) return "moved"
  return "failed"
}
function Status({ error, retry }: { error?: string; retry?: () => void }) {
  return (
    <div className="service-status" role={error ? "alert" : "status"}>
      {error ? (
        <>
          <p>{error}</p>
          {retry && (
            <button className="secondary" onClick={retry}>
              다시 시도
            </button>
          )}
        </>
      ) : (
        <>
          <span className="spinner" />
          <p>수업 정보를 불러오고 있어요</p>
        </>
      )}
    </div>
  )
}
export default function App() {
  useCapabilityRefresh()
  return (
    <BrowserRouter>
      <AuthProvider>
        <Application />
      </AuthProvider>
    </BrowserRouter>
  )
}
function Application() {
  const auth = useAuth(),
    { user } = auth
  const location = useLocation(),
    navigate = useNavigate()
  const parts = location.pathname.split("/").filter(Boolean)
  const notesEnabled = useFeature(notesFeature)
  const attendanceEnabled = useFeature(attendanceFeature) && user?.role === "teacher"
  const notesTab = new URLSearchParams(location.search).get("tab") === "records" ? "records" : "worksheets"
  const lessonId =
    parts[0] === "lessons" && parts[1] !== "new"
      ? parts[1]
      : new URLSearchParams(location.search).get("lesson") || undefined
  const screen: Screen =
    parts[0] === "lessons"
      ? parts[1] === "new"
        ? "form"
        : parts[2] === "edit"
          ? "form"
          : ["created", "prejoin", "waiting", "meeting", "ended"].includes(
                parts[2],
              )
            ? parts[2] as Screen
            : "detail"
      : parts[0] === "error"
        ? "exception"
        : parts[0] === "class-notes" ? "class-notes"
        : parts[0] === "students" ? (parts[1] && parts[2] === "attendance" ? "attendance" : "students")
        : "home"
  const { lessons, students, loading, error, refresh } = useLessonDirectory(
    user,
    screen !== "meeting" && screen !== "waiting",
    auth.retry,
  )
  const [selected, setSelected] = useState<ApiLesson | null>(null)
  const [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState<unknown>(null)
  const [homeView, setHomeView] = useState<HomeView>({
    tab: "upcoming",
    search: "",
  })
  const [devices, setDevices] = useState<JoinDevices>(initialJoinDevices)
  const [admission, setAdmission] = useState<JoinResult>()
  const [waitingError, setWaitingError] = useState("")
  const prejoinEnabled = useFeature(prejoinFeature)
  const waitConfirmed = (location.state as { waitConfirmed?: boolean } | null)?.waitConfirmed === true
  const previousScreen = useRef<Screen>(screen),
    previousLocation = useRef(location.pathname),
    scrollPositions = useRef<Record<string, number>>({})
  const [motion, setMotion] = useState<ScreenMotion>("none")
  useEffect(() => {
    if (auth.loading || auth.error) return
    if (!user && parts[0] !== "login") {
      navigate(
        `/login?next=${encodeURIComponent(location.pathname + location.search)}`,
        { replace: true },
      )
      return
    }
    if (user && parts[0] === "login") {
      const next = new URLSearchParams(location.search).get("next")
      let destination = "/"
      if (next) {
        try {
          const url = new URL(next, window.location.origin)
          if (
            url.origin === window.location.origin &&
            !url.pathname.startsWith("/login")
          )
            destination = url.pathname + url.search + url.hash
        } catch {
          /* An invalid return URL falls back to the dashboard. */
        }
      }
      navigate(destination, { replace: true })
    }
  }, [
    user,
    auth.loading,
    auth.error,
    location.pathname,
    location.search,
    navigate,
  ])
  useEffect(() => {
    if (!user || !lessonId) {
      setSelected(null)
      setDetailError(null)
      return
    }
    let alive = true
    setDetailLoading(true)
    setDetailError(null)
    api<ApiLesson>(`/lessons/${encodeURIComponent(lessonId)}`)
      .then((value) => {
        if (alive) setSelected(value)
      })
      .catch((e) => {
        if (alive) setDetailError(e)
      })
      .finally(() => {
        if (alive) setDetailLoading(false)
      })
    return () => {
      alive = false
    }
  }, [user?.id, lessonId, location.pathname])
  useEffect(() => {
    if (!lessonId || screen === "meeting") return
    const updated = lessons.find((item) => item.id === lessonId)
    if (updated) setSelected(updated)
  }, [lessons, lessonId, screen])
  useEffect(() => {
    if (!user || parts[0] !== "join") return
    let alive = true
    setDetailLoading(true)
    setDetailError(null)
    api<ApiLesson>(`/join/${encodeURIComponent(parts[1] || "")}`)
      .then((value) => {
        if (alive) {
          setSelected(value)
          navigate(`/lessons/${value.id}/prejoin`, { replace: true })
        }
      })
      .catch((e) => {
        if (alive) {
          setDetailError(e)
          navigate(`/error/${exceptionType(e)}`, {
            replace: true,
            state: { message: e instanceof Error ? e.message : undefined },
          })
        }
      })
      .finally(() => {
        if (alive) setDetailLoading(false)
      })
    return () => {
      alive = false
    }
  }, [user?.id, location.pathname, navigate])
  useLayoutEffect(() => {
    const lock = screen === "meeting"
    document.documentElement.classList.toggle("meeting-viewport", lock)
    document.body.classList.toggle("meeting-viewport", lock)
    if (previousLocation.current !== location.pathname) {
      const from = previousScreen.current
      setMotion(
        lock
          ? "none"
          : from === "meeting"
            ? "fade"
            : screen === "home"
              ? "back"
              : from === "home" && screen === "form"
                ? "tab-forward"
                : "forward",
      )
      previousScreen.current = screen
      previousLocation.current = location.pathname
    }
    return () => {
      document.documentElement.classList.remove("meeting-viewport")
      document.body.classList.remove("meeting-viewport")
    }
  }, [screen, location.pathname])
  const setScreen = useCallback(
    (next: Screen) => {
      if (screen !== "meeting")
        scrollPositions.current[location.pathname] = window.scrollY
      if (next === "home") navigate("/")
      else if (next === "students") navigate("/students")
      else if (next === "form")
        navigate(
          lessonId && screen === "detail"
            ? `/lessons/${lessonId}/edit`
            : "/lessons/new",
        )
      else if (next === "prejoin" && lessonId)
        navigate(`/lessons/${lessonId}/prejoin`, {
          state: { from: location.pathname },
        })
      else if (next === "exception")
        navigate(`/error/failed${lessonId ? `?lesson=${lessonId}` : ""}`)
      else if (lessonId)
        navigate(
          `/lessons/${lessonId}/${next === "detail" ? "" : next}`.replace(
            /\/$/,
            "",
          ),
        )
      else navigate("/")
    },
    [navigate, lessonId, screen, location.pathname],
  )
  const startJoin = useCallback(
    async (lesson: ApiLesson, values: JoinDevices) => {
      setDevices(values)
      try {
        const result = await api<JoinResult>(`/lessons/${lesson.id}/join`, {
          method: "POST",
        })
        setAdmission(result)
        setSelected(result.lesson)
        navigate(
          `/lessons/${lesson.id}/${result.waiting ? "waiting" : "meeting"}`,
          result.waiting ? { state: { waitConfirmed: true } } : undefined,
        )
      } catch (e) {
        if (e instanceof ApiError && e.status !== 0 && e.status < 500) {
          navigate(`/error/${exceptionType(e)}?lesson=${lesson.id}`, {
            state: { message: e.message },
          })
          return
        }
        throw e
      }
    },
    [navigate],
  )
  useEffect(() => {
    if (prejoinEnabled && screen === "waiting" && lessonId && waitConfirmed && user?.role === "student")
      return registerPrejoinWait(lessonId)
  }, [prejoinEnabled, screen, lessonId, waitConfirmed, user?.id, user?.role])
  useEffect(() => {
    if (screen !== "waiting" || !user || !lessonId) return
    let alive = true
    setWaitingError("")
    const admissionGate = createWaitingAdmission(
      () => api<JoinResult>(`/lessons/${lessonId}/join`, { method: "POST" }),
      (result) => {
        setAdmission(result)
        navigate(`/lessons/${lessonId}/meeting`, { replace: true })
      },
      (error) =>
        setWaitingError(
          error instanceof Error ? error.message : "입장을 확인하지 못했어요.",
        ),
    )
    const accept = async (lesson: ApiLesson) => {
      if (!alive) return
      setSelected(lesson)
      if (lesson.status === "CANCELLED" || lesson.status === "ENDED") {
        admissionGate.dispose()
        navigate(
          `/error/${
            lesson.status === "CANCELLED" ? "cancelled" : "ended"
          }?lesson=${lessonId}`,
          { replace: true },
        )
        return
      }
      if (lesson.status === "LIVE") await admissionGate.request()
    }

    const check = () => {
      void api<ApiLesson>(`/lessons/${lessonId}`)
        .then(accept)
        .catch((e) => {
          if (alive) {
            if (e instanceof ApiError && e.status === 403)
              navigate(`/error/${exceptionType(e)}?lesson=${lessonId}`, {
                replace: true,
              })
            else
              setWaitingError(
                e instanceof Error ? e.message : "연결 확인 중이에요.",
              )
          }
        })
    }
    const socket = createAppSocket()
    socket.on("connect", () => {
      void requestSocket<CommandAck>(socket, Events.Subscribe, { lessonId }).then(result => {
          if (!alive) return
          if (result.ok) void accept(result.snapshot.lesson)
          else setWaitingError(result.error.message)
        }).catch(error => { if (alive) setWaitingError(error instanceof Error ? error.message : "연결 확인 중이에요.") })
    })
    socket.on(
      Events.Snapshot,
      (snapshot: MeetingSnapshot) => void accept(snapshot.lesson),
    )
    socket.on("connect_error", () =>
      setWaitingError("실시간 연결을 다시 확인하고 있어요."),
    )
    check()
    const timer = setInterval(check, 3000)
    return () => {
      alive = false
      admissionGate.dispose()
      clearInterval(timer)
      socket.disconnect()
    }
  }, [screen, lessonId, user?.id, navigate])
  if (auth.loading) return <Status />
  if (auth.error) return <Status error={auth.error} retry={auth.retry} />
  if (!user) return <Login />
  if (parts[0] === "login") return <Status />
  const lesson =
    selected && selected.id === lessonId ? displayLesson(selected) : null
  const lessonRole = lesson?.teacher.id === user.id ? "teacher" : "student"
  let content
  if (parts[0] === "join") content = <Status />
  else if (screen === "exception") {
    const types: ExceptionType[] = [
      "invalid",
      "account",
      "cancelled",
      "ended",
      "failed",
      "kicked",
      "moved",
    ]
    const type = types.includes(parts[1] as ExceptionType)
      ? parts[1] as ExceptionType
      : "failed"
    content = (
      <Exception
        setScreen={setScreen}
        type={type}
        message={(location.state as { message?: string } | null)?.message}
        onLogout={() => void auth.logout()}
      />
    )
  } else if (screen === "home")
    content = loading ? (
      <Status />
    ) : error ? (
      <Status error={error} retry={() => void refresh()} />
    ) : (
      <Home
        role={user.role}
        user={user}
        onNotes={notesEnabled && user.role === "student" ? tab => {
          scrollPositions.current[location.pathname] = window.scrollY
          navigate(`/class-notes?tab=${tab}`)
        } : undefined}
        lessons={lessons.map(displayLesson)}
        view={homeView}
        onViewChange={setHomeView}
        setScreen={setScreen}
        onOpen={(item) => {
          scrollPositions.current[location.pathname] = window.scrollY
          navigate(`/lessons/${item.id}`)
        }}
        onJoin={(item) => {
          if (item) {
            scrollPositions.current[location.pathname] = window.scrollY
            navigate(`/lessons/${item.id}/prejoin`, { state: { from: "/" } })
          }
        }}
        onJoinCode={async (value) => {
          let code = value
          if (/^https?:\/\//i.test(value)) {
            const url = new URL(value)
            if (
              url.origin !== window.location.origin ||
              !/^\/join\/[^/]+\/?$/.test(url.pathname)
            )
              throw new Error("이 서비스의 수업 링크를 입력해 주세요.")
            code = decodeURIComponent(url.pathname.split("/")[2])
          }
          const item = await api<ApiLesson>(`/join/${encodeURIComponent(code)}`)
          navigate(`/lessons/${item.id}/prejoin`)
        }}
      />
    )
  else if (screen === "class-notes")
    content = user.role === "student" && notesEnabled ? <ClassNotes tab={notesTab} onTab={tab => navigate(`/class-notes?tab=${tab}`, { replace: true })} /> : <Status error="수업 노트를 이용할 수 없어요." />
  else if (screen === "students" || screen === "attendance")
    content = !attendanceEnabled ? <Status error={designContent.attendanceUnavailable} />
      : screen === "students" ? <AttendanceStudents key={user.id} unauthorized={auth.retry} />
      : <StudentAttendance key={user.id} studentId={parts[1]} unauthorized={auth.retry} />
  else if (screen === "form" && !lessonId)
    content = loading ? (
      <Status />
    ) : error ? (
      <Status error={error} retry={() => void refresh()} />
    ) : user.role === "teacher" ? (
      <Form
        key="new"
        students={students}
        setScreen={setScreen}
        onCreated={(item) => {
          setSelected(item)
          void refresh()
          navigate(`/lessons/${item.id}/created`)
        }}
      />
    ) : (
      <Exception type="account" setScreen={setScreen} />
    )
  else if (detailLoading && !lesson) content = <Status />
  else if (detailError)
    content = (
      <Exception
        type={exceptionType(detailError)}
        setScreen={setScreen}
        message={detailError instanceof Error ? detailError.message : undefined}
      />
    )
  else if (!lesson) content = <Status />
  else if (screen === "detail")
    content = (
      <Detail
        lesson={lesson}
        role={lessonRole}
        notesEnabled={notesEnabled}
        setScreen={setScreen}
        onEdit={() => navigate(`/lessons/${lesson.id}/edit`)}
        onCancel={async () => {
          await api(`/lessons/${lesson.id}/cancel`, { method: "POST" })
          await refresh()
        }}
      />
    )
  else if (screen === "form")
    content = loading ? (
      <Status />
    ) : error ? (
      <Status error={error} retry={() => void refresh()} />
    ) : lesson.teacher.id === user.id && lesson.status === "SCHEDULED" ? (
      <Form
        key={lesson.id}
        students={students}
        lesson={lesson}
        setScreen={(next) =>
          next === "home" ? navigate(`/lessons/${lesson.id}`) : setScreen(next)
        }
        onCreated={(item) => {
          setSelected(item)
          void refresh()
          navigate(`/lessons/${item.id}/created`)
        }}
      />
    ) : (
      <Exception
        type="account"
        message="예정된 본인 수업만 수정할 수 있어요."
        setScreen={setScreen}
      />
    )
  else if (screen === "created")
    content = <Created lesson={lesson} setScreen={setScreen} />
  else if (screen === "prejoin")
    content =
      lesson.status === "CANCELLED" || lesson.status === "ENDED" ? (
        <Exception
          type={lesson.status === "CANCELLED" ? "cancelled" : "ended"}
          setScreen={setScreen}
        />
      ) : (
        <Prejoin
          lesson={lesson}
          user={user}
          role={lessonRole}
          setScreen={setScreen}
          onJoin={(value) => startJoin(lesson, value)}
          enhanced={prejoinEnabled}
          onUnavailable={(error) => {
            if (error.status === 401) auth.retry()
            else navigate(`/error/${exceptionType(error)}?lesson=${lesson.id}`, {
              replace: true,
              state: { message: error.message },
            })
          }}
        />
      )
  else if (screen === "waiting")
    content = (
      <Waiting
        lesson={lesson}
        user={user}
        setScreen={setScreen}
        error={waitingError}
        enhanced={prejoinEnabled}
      />
    )
  else if (screen === "meeting")
    content = (
      <Meeting
        key={lesson.id}
        lesson={lesson}
        user={user}
        initialDevices={devices}
        admission={
          admission?.lesson.id === lesson.id && !admission.waiting
            ? admission
            : undefined
        }
        onWaiting={() => {
          setAdmission(undefined)
          navigate(`/lessons/${lesson.id}/waiting`, { replace: true, state: { waitConfirmed: true } })
        }}
        onEnded={(reason?: string) => {
          sessionStorage.setItem(
            `think-meet.left.${lesson.id}`,
            new Date().toISOString(),
          )
          setAdmission(undefined)
          void refresh()
          const type = exceptionType(reason)
          if (reason && reason !== "left" && type !== "ended")
            navigate(`/error/${type}?lesson=${lesson.id}`, { replace: true })
          else navigate(`/lessons/${lesson.id}/ended`, { replace: true })
        }}
      />
    )
  else
    content = (
      <Ended
        lesson={lesson}
        user={user}
        role={lessonRole}
        setScreen={setScreen}
      />
    )
  return (
    <div
      className={`app ${
        screen === "meeting"
          ? "app-meeting"
          : screen === "home"
            ? "app-home"
            : ""
      } ${
        (screen === "home" || (screen === "students" && attendanceEnabled) || (screen === "form" && !lessonId)) &&
        user.role === "teacher"
          ? "app-with-tabs"
          : ""
      }`}
    >
      {!(screen === "attendance" && attendanceEnabled) && <TopBar
        user={user}
        role={user.role}
        onLogout={auth.logout}
        screen={screen}
        attendanceEnabled={attendanceEnabled}
        isEditing={screen === "form" && !!lessonId}
        setScreen={setScreen}
        prejoinEnabled={prejoinEnabled}
        onBack={() => {
          const from = (location.state as { from?: string } | null)?.from
          if (
            screen === "prejoin" &&
            from?.startsWith("/") &&
            !from.startsWith("//")
          )
            navigate(from)
          else if (screen === "form" && lessonId)
            navigate(`/lessons/${lessonId}`)
          else setScreen("home")
        }}
      />}
      <Suspense fallback={<Status />}>
        <ScreenTransition
          key={location.pathname}
          screen={screen}
          motion={motion}
          scrollTop={scrollPositions.current[location.pathname] || 0}
        >
          {content}
        </ScreenTransition>
      </Suspense>
    </div>
  )
}
