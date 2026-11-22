// URL ↔ screen mapping. Pure functions only (no React), so the URL scheme can be unit tested.
import type { Screen } from "./models"

export type ExceptionType = "invalid" | "account" | "cancelled" | "ended" | "failed" | "kicked" | "moved"
export const EXCEPTION_TYPES: readonly ExceptionType[] = ["invalid", "account", "cancelled", "ended", "failed", "kicked", "moved"]
const lessonScreens = ["created", "prejoin", "waiting", "meeting", "ended"] as const

export type Route = {
  /** "login" and "join" are transitional pages that render a status while redirecting. */
  page: "screen" | "login" | "join" | "unknown"
  screen: Screen
  lessonId?: string
  joinCode?: string
  studentId?: string
  exception: ExceptionType
  notesTab: "worksheets" | "records"
}

export function parseRoute(pathname: string, search = ""): Route {
  const parts = pathname.split("/").filter(Boolean)
  const query = new URLSearchParams(search)
  const base = { exception: "failed" as ExceptionType, notesTab: query.get("tab") === "records" ? "records" as const : "worksheets" as const, lessonId: query.get("lesson") || undefined }
  const screen = (screen: Screen, extra: Partial<Route> = {}): Route => ({ ...base, page: "screen", screen, ...extra })
  const [first, second, third, ...rest] = parts
  if (!first) return screen("home")
  if (first === "login" && !second) return { ...base, page: "login", screen: "home" }
  if (first === "join" && second && !third) return { ...base, page: "join", screen: "home", joinCode: decodeURIComponent(second) }
  if (first === "class-notes" && !second) return screen("class-notes")
  if (first === "students" && !second) return screen("students")
  if (first === "students" && second && third === "attendance" && !rest.length) return screen("attendance", { studentId: decodeURIComponent(second) })
  if (first === "error" && !third) return screen("exception", { exception: EXCEPTION_TYPES.includes(second as ExceptionType) ? second as ExceptionType : "failed" })
  if (first === "lessons" && second === "new" && !third) return screen("form")
  if (first === "lessons" && second && second !== "new" && !rest.length) {
    if (!third) return screen("detail", { lessonId: second })
    if (third === "edit") return screen("form", { lessonId: second })
    if ((lessonScreens as readonly string[]).includes(third)) return screen(third as Screen, { lessonId: second })
  }
  return { ...base, page: "unknown", screen: "home" }
}

/** Target of a `setScreen(next)` request from the current screen; null keeps the current URL. */
export function screenPath(next: Screen, current: { screen: Screen; lessonId?: string; pathname: string }): { to: string; state?: unknown } {
  const { lessonId } = current
  if (next === "home") return { to: "/" }
  if (next === "students") return { to: "/students" }
  if (next === "class-notes") return { to: "/class-notes" }
  if (next === "form") return { to: lessonId && current.screen === "detail" ? `/lessons/${lessonId}/edit` : "/lessons/new" }
  if (next === "exception") return { to: `/error/failed${lessonId ? `?lesson=${lessonId}` : ""}` }
  if (!lessonId) return { to: "/" }
  if (next === "prejoin") return { to: `/lessons/${lessonId}/prejoin`, state: { from: current.pathname } }
  return { to: next === "detail" ? `/lessons/${lessonId}` : `/lessons/${lessonId}/${next}` }
}

/** Same-origin return path after login; anything else falls back to the dashboard. */
export function loginReturnPath(search: string, origin: string) {
  const next = new URLSearchParams(search).get("next")
  if (!next) return "/"
  try {
    const url = new URL(next, origin)
    return url.origin === origin && !url.pathname.startsWith("/login") ? url.pathname + url.search + url.hash : "/"
  } catch { return "/" }
}

/** Accepts a bare code or this site's /join/<code> link. */
export function joinCodeFrom(value: string, origin: string) {
  if (!/^https?:\/\//i.test(value)) return value
  const url = new URL(value)
  if (url.origin !== origin || !/^\/join\/[^/]+\/?$/.test(url.pathname)) throw new Error("이 서비스의 수업 링크를 입력해 주세요.")
  return decodeURIComponent(url.pathname.split("/")[2])
}

/** Maps an API error code or leave reason to the exception page shown to the user. */
export function exceptionType(error: unknown): ExceptionType {
  const code = (error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : String(error || "")).toLowerCase()
  if (/kick|banned|removed/.test(code)) return "kicked"
  if (/cancel/.test(code)) return "cancelled"
  if (/ended|closed/.test(code)) return "ended"
  if (/invited|forbidden|account/.test(code)) return "account"
  if (/not_found|invalid|404/.test(code)) return "invalid"
  if (/duplicate|moved|replaced/.test(code)) return "moved"
  return "failed"
}
