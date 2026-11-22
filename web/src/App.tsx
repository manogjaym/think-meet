import { Suspense, useCallback, useState } from "react"
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom"
import { AppScreen } from "./app/AppScreen"
import { Status } from "./app/Status"
import { useAuthRedirect } from "./app/useAuthRedirect"
import { useLessonDetail } from "./app/useLessonDetail"
import { useScreenTransition } from "./app/useScreenTransition"
import { useWaitingRoom } from "./app/useWaitingRoom"
import { TopBar } from "./components/TopBar"
import { ScreenTransition } from "./components/ScreenTransition"
import { Login } from "./screens/Login"
import { ApiError, call, type ApiLesson, type JoinResult } from "./lib/api"
import { AuthProvider, useAuth } from "./lib/auth"
import { notesFeature } from "./lib/classNotes"
import { prejoinFeature } from "./lib/prejoin"
import { useCapabilityRefresh, useFeature } from "./lib/useFeature"
import { useLessonDirectory } from "./lib/useLessonDirectory"
import type { Screen } from "./models"
import { exceptionType, parseRoute, screenPath } from "./routes"
import type { HomeView } from "./screens/Home"
import { initialJoinDevices, type JoinDevices } from "./screens/Join"
import { attendanceFeature } from "./screens/StudentAttendance"
import "./service.css"

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

/** App shell: route, session, shared lesson state and the top bar. Screens are chosen by AppScreen. */
function Application() {
  const auth = useAuth(), { user } = auth
  const location = useLocation(), navigate = useNavigate()
  const route = parseRoute(location.pathname, location.search)
  const { screen, lessonId } = route
  const features = {
    notes: useFeature(notesFeature),
    attendance: useFeature(attendanceFeature) && user?.role === "teacher",
    prejoin: useFeature(prejoinFeature),
  }
  const directory = useLessonDirectory(user, screen !== "meeting" && screen !== "waiting")
  const detail = useLessonDetail(user?.id, route, location.pathname, directory.lessons, navigate)
  const [homeView, setHomeView] = useState<HomeView>({ tab: "upcoming", search: "" })
  const [devices, setDevices] = useState<JoinDevices>(initialJoinDevices)
  const [admission, setAdmission] = useState<JoinResult>()
  const waitConfirmed = (location.state as { waitConfirmed?: boolean } | null)?.waitConfirmed === true
  const { motion, rememberScroll, scrollTop } = useScreenTransition(screen, location.pathname)
  useAuthRedirect(auth, route, location, navigate)
  const waitingError = useWaitingRoom({ route, user, prejoinEnabled: features.prejoin, waitConfirmed, navigate, setSelected: detail.setSelected, setAdmission })
  const setScreen = useCallback((next: Screen) => {
    rememberScroll()
    const target = screenPath(next, { screen, lessonId, pathname: location.pathname })
    navigate(target.to, target.state ? { state: target.state } : undefined)
  }, [navigate, lessonId, screen, location.pathname, rememberScroll])
  const startJoin = useCallback(async (lesson: ApiLesson, values: JoinDevices) => {
    setDevices(values)
    try {
      const result = await call("joinLesson", { params: { id: lesson.id } })
      setAdmission(result)
      detail.setSelected(result.lesson)
      navigate(`/lessons/${lesson.id}/${result.waiting ? "waiting" : "meeting"}`, result.waiting ? { state: { waitConfirmed: true } } : undefined)
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0 && e.status < 500) {
        navigate(`/error/${exceptionType(e)}?lesson=${lesson.id}`, { state: { message: e.message } })
        return
      }
      throw e
    }
  }, [navigate, detail.setSelected])

  if (auth.loading) return <Status />
  if (auth.error) return <Status error={auth.error} retry={auth.retry} />
  if (!user) return <Login />
  if (route.page === "login") return <Status />
  const teacherTabs = (screen === "home" || (screen === "students" && features.attendance) || (screen === "form" && !lessonId)) && user.role === "teacher"
  return (
    <div className={`app ${screen === "meeting" ? "app-meeting" : screen === "home" ? "app-home" : ""} ${teacherTabs ? "app-with-tabs" : ""}`}>
      {!(screen === "attendance" && features.attendance) && <TopBar
        user={user}
        role={user.role}
        onLogout={auth.logout}
        screen={screen}
        attendanceEnabled={features.attendance}
        isEditing={screen === "form" && !!lessonId}
        setScreen={setScreen}
        prejoinEnabled={features.prejoin}
        onBack={() => {
          const from = (location.state as { from?: string } | null)?.from
          if (screen === "prejoin" && from?.startsWith("/") && !from.startsWith("//")) navigate(from)
          else if (screen === "form" && lessonId) navigate(`/lessons/${lessonId}`)
          else setScreen("home")
        }}
      />}
      <Suspense fallback={<Status />}>
        <ScreenTransition key={location.pathname} screen={screen} motion={motion} scrollTop={scrollTop}>
          <AppScreen
            route={route} user={user} location={location} navigate={navigate} setScreen={setScreen} rememberScroll={rememberScroll}
            onLogout={() => void auth.logout()} features={features} directory={directory} detail={detail}
            homeView={homeView} setHomeView={setHomeView} devices={devices} startJoin={startJoin}
            admission={admission} setAdmission={setAdmission} waitingError={waitingError}
          />
        </ScreenTransition>
      </Suspense>
    </div>
  )
}
