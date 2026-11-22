import { useEffect } from "react"
import type { Location, NavigateFunction } from "react-router-dom"
import type { User } from "../lib/api"
import { loginReturnPath, type Route } from "../routes"

/** Signed-out users go to /login?next=…; signed-in users leave /login for a same-origin return path. */
export function useAuthRedirect(auth: { user: User | null; loading: boolean; error: string }, route: Route, location: Location, navigate: NavigateFunction) {
  useEffect(() => {
    if (auth.loading || auth.error) return
    if (!auth.user && route.page !== "login") {
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
      return
    }
    if (auth.user && route.page === "login") navigate(loginReturnPath(location.search, window.location.origin), { replace: true })
    // Unknown URLs are normalized instead of silently rendering the dashboard under a wrong address.
    else if (auth.user && route.page === "unknown") navigate("/", { replace: true })
  }, [auth.user, auth.loading, auth.error, route.page, location.pathname, location.search, navigate])
}
