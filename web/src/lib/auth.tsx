import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { api, ApiError, type User } from "./api"

type AuthState = {
  user: User | null
  loading: boolean
  error: string
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  retry: () => void
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
      setUser(await api<User>("/auth/me"))
    } catch (e) {
      setUser(null)
      if (!(e instanceof ApiError && e.status === 401))
        setError(e instanceof Error ? e.message : "서버에 연결하지 못했어요.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const login = async (username: string, password: string) => {
    setUser(
      await api<User>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    )
    setError("")
  }
  const logout = async () => {
    await api("/auth/logout", { method: "POST" })
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
        retry: () => void refresh(),
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
