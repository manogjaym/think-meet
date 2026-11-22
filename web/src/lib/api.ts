import { avatarColors } from "../generated/design-palette"
import type { ApiLesson } from "../generated/contracts"
import { API_BASE_PATH, API_OPERATIONS, type ApiOperationId, type ApiOperations } from "../generated/contracts"
import { capabilityHeaders, requireHttpFeature } from "./features"
export type { User, LessonAccessMode, ApiLesson, JoinResult } from "../generated/contracts"
export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}
/** Startup `/auth/me` and wrong passwords are expected unauthenticated states, as in the KMP client. */
const authProbePaths = new Set(["/auth/me", "/auth/login"])
let unauthorizedHandler: (() => void) | null = null
/** Registers the single app-wide reaction to an expired session (any other 401). */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}
export async function apiResponse(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  await requireHttpFeature(options.method || "GET", path, options.signal)
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  for (const [name, value] of Object.entries(capabilityHeaders())) headers.set(name, value)
  let response: Response
  try {
    response = await fetch(`${API_BASE_PATH}${path}`, {
      ...options,
      credentials: "include",
      headers,
    })
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "서버에 연결하지 못했어요. 네트워크를 확인해 주세요.",
    )
  }
  if (!response.ok) {
    if (response.status === 401 && !authProbePaths.has(path)) unauthorizedHandler?.()
    const data = (await response.json().catch(() => ({}))) as {
      code?: string
      message?: string | string[]
    }
    throw new ApiError(
      response.status,
      data.code || `HTTP_${response.status}`,
      Array.isArray(data.message)
        ? data.message.join(" ")
        : data.message || "요청을 처리하지 못했어요. 다시 시도해 주세요.",
    )
  }
  return response
}
export async function api<T = void>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiResponse(path, options)
  if (response.status === 204 || response.headers.get("content-length") === "0")
    return undefined as T
  const body = await response.text()
  return (body ? JSON.parse(body) : undefined) as T
}
type Operation<K extends ApiOperationId> = ApiOperations[K]
type Field<Name extends string, Value> = [Value] extends [undefined] ? { [P in Name]?: undefined } : { [P in Name]: Value }
type OptionalField<Name extends string, Value> = [Value] extends [undefined] ? { [P in Name]?: undefined } : { [P in Name]?: Value }
/** Path params, query and body are typed from contracts/openapi.json for each operationId. */
export type CallOptions<K extends ApiOperationId> = Omit<RequestInit, "body" | "method"> &
  Field<"params", Operation<K>["params"]> & OptionalField<"query", Operation<K>["query"]> & Field<"body", Operation<K>["body"]>
type OptionalArgs<K extends ApiOperationId> = [Operation<K>["params"], Operation<K>["body"]] extends [undefined, undefined] ? [options?: CallOptions<K>] : [options: CallOptions<K>]

/** Builds `/path` for an operation, encoding every path parameter. */
export function operationPath<K extends ApiOperationId>(id: K, params?: Record<string, string>, query?: Record<string, string | undefined>) {
  const path = API_OPERATIONS[id].path.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) => {
    const value = params?.[name]
    if (value === undefined) throw new Error(`Missing path parameter ${name} for ${id}`)
    return encodeURIComponent(value)
  })
  const search = new URLSearchParams(Object.entries(query ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString()
  return search ? `${path}?${search}` : path
}

/**
 * Typed JSON call by contract operationId. The response type comes from the contract, so a renamed
 * field or route fails type checking instead of at runtime. Binary responses use apiResponse instead.
 */
export function call<K extends ApiOperationId>(id: K, ...[options]: OptionalArgs<K>): Promise<Operation<K>["response"]> {
  const { params, query, body, ...init } = (options ?? {}) as CallOptions<K> & { params?: Record<string, string>; query?: Record<string, string | undefined>; body?: unknown }
  const request: RequestInit = { ...init, method: API_OPERATIONS[id].method }
  if (body !== undefined) request.body = body instanceof FormData || typeof body === "string" ? body : JSON.stringify(body)
  return api<Operation<K>["response"]>(operationPath(id, params, query), request)
}

export const joinLink = (lesson: Pick<ApiLesson, "code">) =>
  `${window.location.origin}/join/${encodeURIComponent(lesson.code)}`
export const colorFor = (value: string) =>
  avatarColors[
    [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5
  ]
export const statusLabels = {
  SCHEDULED: "예정",
  LIVE: "진행 중",
  ENDED: "종료",
  CANCELLED: "취소",
} as const
export function koreaParts(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value))
  const p = (type: string) =>
    parts.find((item) => item.type === type)?.value || ""
  return {
    dateISO: `${p("year")}-${p("month")}-${p("day")}`,
    time: `${p("hour")}:${p("minute")}`,
  }
}
export function displayLesson(lesson: ApiLesson) {
  const start = koreaParts(lesson.startsAt)
  const end = lesson.endsAt ? koreaParts(lesson.endsAt) : null
  return {
    ...lesson,
    accessMode: lesson.accessMode || "INVITE_ONLY",
    state: statusLabels[lesson.status],
    date:
      new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "long",
        day: "numeric",
      }).format(new Date(lesson.startsAt)) +
      ", " +
      new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(lesson.startsAt)),
    duration: lesson.endsAt
      ? `${Math.round((Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt)) / 60000)}분`
      : "종료 시간 없음",
    people:
      lesson.accessMode === "OPEN"
        ? "누구나 참여 가능"
        : lesson.students.length > 1
          ? `${lesson.students[0].name} 외 ${lesson.students.length - 1}명`
          : lesson.students[0]?.name || "초대 학생 없음",
    studentNames: lesson.students.map((student) => student.name),
    dateISO: start.dateISO,
    startTime: start.time,
    endTime: end?.time || "",
  }
}
