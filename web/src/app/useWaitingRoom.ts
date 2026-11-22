import { useEffect, useState } from "react"
import type { NavigateFunction } from "react-router-dom"
import type { CommandAck, MeetingSnapshot } from "../generated/contracts"
import { SOCKET_EVENTS as Events } from "../generated/contracts"
import { ApiError, call, type ApiLesson, type JoinResult, type User } from "../lib/api"
import { registerPrejoinWait } from "../lib/prejoin"
import { createAppSocket, requestSocket } from "../lib/socket"
import { createWaitingAdmission } from "../lib/waitingAdmission"
import { exceptionType, type Route } from "../routes"

/**
 * Waiting screen: announces the student to the teacher (prejoin wait), then admits into the meeting
 * once the lesson is LIVE, via socket snapshots with a 3s polling fallback.
 */
export function useWaitingRoom(options: {
  route: Route
  user: User | null
  prejoinEnabled: boolean
  waitConfirmed: boolean
  navigate: NavigateFunction
  setSelected: (lesson: ApiLesson) => void
  setAdmission: (result: JoinResult) => void
}) {
  const { route: { screen, lessonId }, user, prejoinEnabled, waitConfirmed, navigate, setSelected, setAdmission } = options
  const [waitingError, setWaitingError] = useState("")
  useEffect(() => {
    if (prejoinEnabled && screen === "waiting" && lessonId && waitConfirmed && user?.role === "student")
      return registerPrejoinWait(lessonId)
  }, [prejoinEnabled, screen, lessonId, waitConfirmed, user?.id, user?.role])
  useEffect(() => {
    if (screen !== "waiting" || !user || !lessonId) return
    let alive = true
    setWaitingError("")
    const admissionGate = createWaitingAdmission(
      () => call("joinLesson", { params: { id: lessonId } }),
      (result) => {
        setAdmission(result)
        navigate(`/lessons/${lessonId}/meeting`, { replace: true })
      },
      (error) => setWaitingError(error instanceof Error ? error.message : "입장을 확인하지 못했어요."),
    )
    const accept = async (lesson: ApiLesson) => {
      if (!alive) return
      setSelected(lesson)
      if (lesson.status === "CANCELLED" || lesson.status === "ENDED") {
        admissionGate.dispose()
        navigate(`/error/${lesson.status === "CANCELLED" ? "cancelled" : "ended"}?lesson=${lessonId}`, { replace: true })
        return
      }
      if (lesson.status === "LIVE") await admissionGate.request()
    }
    const check = () => {
      void call("getLesson", { params: { id: lessonId } })
        .then(accept)
        .catch((e) => {
          if (!alive) return
          if (e instanceof ApiError && e.status === 403) navigate(`/error/${exceptionType(e)}?lesson=${lessonId}`, { replace: true })
          else setWaitingError(e instanceof Error ? e.message : "연결 확인 중이에요.")
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
    socket.on(Events.Snapshot, (snapshot: MeetingSnapshot) => void accept(snapshot.lesson))
    socket.on("connect_error", () => setWaitingError("실시간 연결을 다시 확인하고 있어요."))
    check()
    const timer = setInterval(check, 3000)
    return () => {
      alive = false
      admissionGate.dispose()
      clearInterval(timer)
      socket.disconnect()
    }
  }, [screen, lessonId, user?.id, navigate])
  return waitingError
}
