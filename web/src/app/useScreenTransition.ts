import { useCallback, useLayoutEffect, useRef, useState } from "react"
import type { ScreenMotion } from "../components/ScreenTransition"
import type { Screen } from "../models"

/** Screen-change animation, meeting viewport lock, and per-URL scroll restoration. */
export function useScreenTransition(screen: Screen, pathname: string) {
  const previousScreen = useRef<Screen>(screen), previousLocation = useRef(pathname)
  const scrollPositions = useRef<Record<string, number>>({})
  const [motion, setMotion] = useState<ScreenMotion>("none")
  useLayoutEffect(() => {
    const lock = screen === "meeting"
    document.documentElement.classList.toggle("meeting-viewport", lock)
    document.body.classList.toggle("meeting-viewport", lock)
    if (previousLocation.current !== pathname) {
      const from = previousScreen.current
      const tabs: Screen[] = ["home", "form", "students", "class-notes"]
      const tabMove = tabs.includes(from) && tabs.includes(screen) ? tabs.indexOf(screen) - tabs.indexOf(from) : 0
      setMotion(lock ? "none" : from === "meeting" ? "fade" : tabMove ? (tabMove > 0 ? "tab-forward" : "tab-back") : screen === "home" ? "back" : "forward")
      previousScreen.current = screen
      previousLocation.current = pathname
    }
    return () => {
      document.documentElement.classList.remove("meeting-viewport")
      document.body.classList.remove("meeting-viewport")
    }
  }, [screen, pathname])
  /** Call before navigating away so returning to this URL restores its scroll position. */
  const rememberScroll = useCallback(() => { if (screen !== "meeting") scrollPositions.current[pathname] = window.scrollY }, [screen, pathname])
  return { motion, rememberScroll, scrollTop: scrollPositions.current[pathname] || 0 }
}
