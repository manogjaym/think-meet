import { useEffect, useSyncExternalStore } from "react"
import { getCapabilityState, isFeatureEnabled, loadCapabilities, subscribeCapabilities } from "./features"

/** Unknown, unfinished and unsupported features stay off even if a server sends an extra flag. */
export function useFeature(id: string): boolean {
  useSyncExternalStore(subscribeCapabilities, getCapabilityState, getCapabilityState)
  useEffect(() => { void loadCapabilities().catch(() => undefined) }, [id])
  return isFeatureEnabled(id)
}

/** Recheck on return to the app or a restored connection without changing the existing UI. */
export function useCapabilityRefresh() {
  useEffect(() => {
    const refresh = () => { void loadCapabilities().catch(() => undefined) }
    refresh()
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadCapabilities({ force: true }).catch(() => undefined)
    }, 120_000)
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh) }
  }, [])
}
