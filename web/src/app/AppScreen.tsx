import { lazy, type ReactElement } from "react"
import type { Location, NavigateFunction } from "react-router-dom"
import { designContent } from "../generated/design-content"
import { call, displayLesson, type ApiLesson, type JoinResult, type User } from "../lib/api"
import type { Screen } from "../models"
import { exceptionType, joinCodeFrom, type Route } from "../routes"
import { ClassNotes } from "../screens/ClassNotes"
import { Home, type HomeView } from "../screens/Home"
import type { JoinDevices } from "../screens/Join"
import { Created, Detail, Form } from "../screens/Lessons"
import { AttendanceStudents, StudentAttendance } from "../screens/StudentAttendance"
import { Status } from "./Status"

const Prejoin = lazy(() => import("../screens/Join").then((m) => ({ default: m.Prejoin })))
const Waiting = lazy(() => import("../screens/Join").then((m) => ({ default: m.Waiting })))
const Meeting = lazy(() => import("../screens/Meeting").then((m) => ({ default: m.Meeting })))
const Ended = lazy(() => import("../screens/End").then((m) => ({ default: m.Ended })))
const Exception = lazy(() => import("../screens/End").then((m) => ({ default: m.Exception })))

export type AppScreenProps = {
  route: Route
  user: User
  location: Location
  navigate: NavigateFunction
  setScreen: (next: Screen) => void
  rememberScroll: () => void
  onLogout: () => void
  features: { notes: boolean; attendance: boolean; prejoin: boolean }
  directory: { lessons: ApiLesson[]; students: User[]; loading: boolean; error: string; refresh: () => Promise<void> | void }
  detail: { selected: ApiLesson | null; setSelected: (lesson: ApiLesson) => void; detailLoading: boolean; detailError: unknown }
  homeView: HomeView
  setHomeView: (view: HomeView) => void
  devices: JoinDevices
  startJoin: (lesson: ApiLesson, devices: JoinDevices) => Promise<void>
  admission?: JoinResult
  setAdmission: (result: JoinResult | undefined) => void
  waitingError: string
}

/** Chooses the screen component for the current route. Navigation rules live in ../routes.ts. */
export function AppScreen(props: AppScreenProps) {
  const { route, user, location, navigate, setScreen, rememberScroll, features, directory, detail } = props
  const { screen, lessonId } = route
  const { lessons, students, loading, error, refresh } = directory
  const lesson = detail.selected && detail.selected.id === lessonId ? displayLesson(detail.selected) : null
  const lessonRole = lesson?.teacher.id === user.id ? "teacher" : "student"
  const directoryGate = (ready: () => ReactElement) => loading ? <Status /> : error ? <Status error={error} retry={() => void refresh()} /> : ready()
  const created = (item: ApiLesson) => {
    detail.setSelected(item)
    void refresh()
    navigate(`/lessons/${item.id}/created`)
  }

  if (route.page !== "screen") return <Status />
  if (screen === "exception")
    return <Exception setScreen={setScreen} type={route.exception} message={(location.state as { message?: string } | null)?.message} onLogout={props.onLogout} />
  if (screen === "home")
    return directoryGate(() => (
      <Home
        role={user.role}
        user={user}
        onNotes={features.notes && user.role === "student" ? tab => { rememberScroll(); navigate(`/class-notes?tab=${tab}`) } : undefined}
        lessons={lessons.map(displayLesson)}
        view={props.homeView}
        onViewChange={props.setHomeView}
        setScreen={setScreen}
        onOpen={(item) => { rememberScroll(); navigate(`/lessons/${item.id}`) }}
        onJoin={(item) => { if (item) { rememberScroll(); navigate(`/lessons/${item.id}/prejoin`, { state: { from: "/" } }) } }}
        onJoinCode={async (value) => {
          const item = await call("resolveLesson", { params: { code: joinCodeFrom(value, window.location.origin) } })
          navigate(`/lessons/${item.id}/prejoin`)
        }}
      />
    ))
  if (screen === "class-notes")
    return user.role === "student" && features.notes ? <ClassNotes tab={route.notesTab} onTab={tab => navigate(`/class-notes?tab=${tab}`, { replace: true })} /> : <Status error="수업 노트를 이용할 수 없어요." />
  if (screen === "students" || screen === "attendance")
    return !features.attendance ? <Status error={designContent.attendanceUnavailable} />
      : screen === "students" ? <AttendanceStudents key={user.id} />
      : <StudentAttendance key={user.id} studentId={route.studentId!} />
  if (screen === "form" && !lessonId)
    return directoryGate(() => user.role === "teacher"
      ? <Form key="new" students={students} lessons={lessons} teacherId={user.id} setScreen={setScreen} onCreated={created} />
      : <Exception type="account" setScreen={setScreen} />)
  if (detail.detailLoading && !lesson) return <Status />
  if (detail.detailError)
    return <Exception type={exceptionType(detail.detailError)} setScreen={setScreen} message={detail.detailError instanceof Error ? detail.detailError.message : undefined} />
  if (!lesson) return <Status />
  switch (screen) {
    case "detail":
      return (
        <Detail
          lesson={lesson}
          role={lessonRole}
          notesEnabled={features.notes}
          setScreen={setScreen}
          onEdit={() => navigate(`/lessons/${lesson.id}/edit`)}
          onCancel={async () => {
            await call("cancelLesson", { params: { id: lesson.id } })
            await refresh()
          }}
        />
      )
    case "form":
      return directoryGate(() => lesson.teacher.id === user.id && lesson.status === "SCHEDULED"
        ? <Form key={lesson.id} students={students} lessons={lessons} teacherId={user.id} lesson={lesson}
            setScreen={(next) => next === "home" ? navigate(`/lessons/${lesson.id}`) : setScreen(next)} onCreated={created} />
        : <Exception type="account" message="예정된 본인 수업만 수정할 수 있어요." setScreen={setScreen} />)
    case "created":
      return <Created lesson={lesson} setScreen={setScreen} />
    case "prejoin":
      return lesson.status === "CANCELLED" || lesson.status === "ENDED"
        ? <Exception type={lesson.status === "CANCELLED" ? "cancelled" : "ended"} setScreen={setScreen} />
        : (
          <Prejoin
            lesson={lesson}
            user={user}
            role={lessonRole}
            setScreen={setScreen}
            onJoin={(value) => props.startJoin(lesson, value)}
            enhanced={features.prejoin}
            onUnavailable={(error) => {
              // An expired session is handled once by the app-wide 401 handler.
              if (error.status !== 401) navigate(`/error/${exceptionType(error)}?lesson=${lesson.id}`, { replace: true, state: { message: error.message } })
            }}
          />
        )
    case "waiting":
      return <Waiting lesson={lesson} user={user} setScreen={setScreen} error={props.waitingError} enhanced={features.prejoin} />
    case "meeting":
      return (
        <Meeting
          key={lesson.id}
          lesson={lesson}
          user={user}
          initialDevices={props.devices}
          admission={props.admission?.lesson.id === lesson.id && !props.admission.waiting ? props.admission : undefined}
          onWaiting={() => {
            props.setAdmission(undefined)
            navigate(`/lessons/${lesson.id}/waiting`, { replace: true, state: { waitConfirmed: true } })
          }}
          onEnded={(reason?: string) => {
            sessionStorage.setItem(`think-meet.left.${lesson.id}`, new Date().toISOString())
            props.setAdmission(undefined)
            void refresh()
            const type = exceptionType(reason)
            if (reason && reason !== "left" && type !== "ended") navigate(`/error/${type}?lesson=${lesson.id}`, { replace: true })
            else navigate(`/lessons/${lesson.id}/ended`, { replace: true })
          }}
        />
      )
    default:
      return <Ended lesson={lesson} user={user} role={lessonRole} setScreen={setScreen} />
  }
}
