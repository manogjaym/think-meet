import { useEffect, useState } from "react"
import type { NavigateFunction } from "react-router-dom"
import { call, type ApiLesson } from "../lib/api"
import { exceptionType, type Route } from "../routes"

/**
 * The lesson shown by lesson-scoped screens: loaded by id, refreshed from the directory list,
 * or resolved from a /join/<code> link (which then redirects to prejoin).
 */
export function useLessonDetail(userId: string | undefined, route: Route, pathname: string, lessons: ApiLesson[], navigate: NavigateFunction) {
  const { lessonId, screen, joinCode, page } = route
  const [selected, setSelected] = useState<ApiLesson | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<unknown>(null)
  useEffect(() => {
    if (!userId || !lessonId) {
      setSelected(null)
      setDetailError(null)
      return
    }
    let alive = true
    setDetailLoading(true)
    setDetailError(null)
    call("getLesson", { params: { id: lessonId } })
      .then((value) => { if (alive) setSelected(value) })
      .catch((e) => { if (alive) setDetailError(e) })
      .finally(() => { if (alive) setDetailLoading(false) })
    return () => { alive = false }
  }, [userId, lessonId, pathname])
  useEffect(() => {
    if (!lessonId || screen === "meeting") return
    const updated = lessons.find((item) => item.id === lessonId)
    if (updated) setSelected(updated)
  }, [lessons, lessonId, screen])
  useEffect(() => {
    if (!userId || page !== "join") return
    let alive = true
    setDetailLoading(true)
    setDetailError(null)
    call("resolveLesson", { params: { code: joinCode || "" } })
      .then((value) => {
        if (!alive) return
        setSelected(value)
        navigate(`/lessons/${value.id}/prejoin`, { replace: true })
      })
      .catch((e) => {
        if (!alive) return
        setDetailError(e)
        navigate(`/error/${exceptionType(e)}`, { replace: true, state: { message: e instanceof Error ? e.message : undefined } })
      })
      .finally(() => { if (alive) setDetailLoading(false) })
    return () => { alive = false }
  }, [userId, pathname, navigate])
  return { selected, setSelected, detailLoading, detailError }
}
