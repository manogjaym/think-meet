import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { call, ApiError, setUnauthorizedHandler, type User } from "./api"

type AuthState = {
  user: User | null
  loading: boolean
  error: string
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  retry: () => void
  /** Re-checks the session in the background without replacing the current screen. */
  revalidate: () => void
}
const AuthContext = createContext<AuthState | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setUser(await call("authMe"))
    } catch (e) {
      setUser(null)
      if (!(e instanceof ApiError && e.status === 401))
        setError(e instanceof Error ? e.message : "서버에 연결하지 못했어요.")
    } finally {
      setLoading(false)
    }
  }, [])
  const retry = useCallback(() => void refresh(), [refresh])
  const revalidating = useRef<Promise<void> | null>(null)
  const signedIn = useRef(false)
  signedIn.current = user !== null
  const revalidate = useCallback(() => {
    // A late 401 after logout has nothing to sign out and must not re-check authentication.
    if (!signedIn.current) return
    // A 401 from one request must not unmount a live meeting while the session is still valid.
    revalidating.current ??= call("authMe")
      .then((next) => setUser((current) =>
        // Never sign back in after logout; keep the same object so user-keyed effects do not restart.
        !current || JSON.stringify(current) === JSON.stringify(next) ? current : next,
      ), (e) => {
        // Only a confirmed expiry signs out; network errors keep the current screen.
        if (e instanceof ApiError && e.status === 401) setUser(null)
      })
      .finally(() => {
        revalidating.current = null
      })
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    setUnauthorizedHandler(revalidate)
    return () => setUnauthorizedHandler(null)
  }, [revalidate])
  const login = async (username: string, password: string) => {
    setUser(
      await call("authLogin", { body: { username, password } }),
    )
    setError("")
  }
  const logout = async () => {
    await call("authLogout")
    setUser(null)
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        logout,
        retry,
        revalidate,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("AuthProvider is required")
  return context
}
