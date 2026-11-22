import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { SOCKET_EVENTS } from "../generated/contracts"
import { call, type ApiLesson, type User } from "./api"
import { createAppSocket } from "./socket"

type Account = Pick<User, "id" | "role">
type Directory = {
  lessons: ApiLesson[]
  students: User[]
  error: string
}
const emptyDirectory: Directory = { lessons: [], students: [], error: "" }

export function useLessonDirectory(
  user: User | null,
  /** Off during meeting/waiting, which own their realtime state; no list traffic runs then. */
  watchChanges: boolean,
) {
  const id = user?.id
  const role = user?.role
  const account = useMemo(() => (id && role ? { id, role } : null), [id, role])
  const activeAccount = useRef<Account | null>(null)
  const request = useRef<AbortController | null>(null)
  const [result, setResult] = useState<{
    account: Account
    directory: Directory
  } | null>(null)

  useLayoutEffect(() => {
    // Invalidate the previous account during the commit, before passive effects run.
    activeAccount.current = account
    setResult(null)
    return () => {
      activeAccount.current = null
      request.current?.abort()
      request.current = null
    }
  }, [account])

  const refresh = useCallback(async () => {
    if (!account || activeAccount.current !== account) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const { signal } = controller
    try {
      const [lessons, students] = await Promise.all([
        call("listLessons", { signal }),
        account.role === "teacher"
          ? call("listStudents", { signal })
          : Promise.resolve([]),
      ])
      if (!signal.aborted)
        setResult({ account, directory: { lessons, students, error: "" } })
    } catch (error) {
      if (signal.aborted) return
      controller.abort()
      setResult((current) => ({
        account,
        directory: {
          ...(current?.account === account
            ? current.directory
            : emptyDirectory),
          error:
            error instanceof Error
              ? error.message
              : "수업을 불러오지 못했어요.",
        },
      }))
    } finally {
      if (request.current === controller) request.current = null
    }
  }, [account])

  useEffect(() => {
    if (!account || !watchChanges) return
    const update = () => void refresh()
    update()
    const timer = window.setInterval(update, 15_000)
    window.addEventListener("focus", update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", update)
    }
  }, [account, refresh, watchChanges])

  useEffect(() => {
    if (!account || !watchChanges) return
    const socket = createAppSocket()
    let pending: ReturnType<typeof setTimeout> | undefined
    socket.on(SOCKET_EVENTS.LessonsChanged, () => {
      clearTimeout(pending)
      pending = setTimeout(() => void refresh(), 500)
    })
    return () => {
      clearTimeout(pending)
      socket.disconnect()
    }
  }, [account, refresh, watchChanges])

  const current = result?.account === account ? result.directory : undefined
  return { ...(current ?? emptyDirectory), loading: !current, refresh }
}
