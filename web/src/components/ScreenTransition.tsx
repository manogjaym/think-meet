import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import type { Screen } from "../models"

export type ScreenMotion = "none" | "forward" | "back" | "tab-forward" | "tab-back" | "fade"

export function ScreenTransition({
  screen,
  motion,
  scrollTop,
  children,
}: {
  screen: Screen
  motion: ScreenMotion
  scrollTop: number
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [entered, setEntered] = useState(false)

  useLayoutEffect(() => {
    if (screen !== "meeting") {
      // This runs after Suspense resolves and the real page has its full height.
      window.scrollTo({ top: scrollTop, behavior: "instant" })
    }
    const container = containerRef.current
    const complete = (event: AnimationEvent) => {
      if (
        event.target === container &&
        event.animationName === "screen-enter"
      ) {
        setEntered(true)
      }
    }
    container?.addEventListener("animationend", complete)
    container?.addEventListener("animationcancel", complete)
    return () => {
      container?.removeEventListener("animationend", complete)
      container?.removeEventListener("animationcancel", complete)
    }
  }, [screen, scrollTop])

  return (
    <div
      ref={containerRef}
      className="screen-content"
      data-screen={screen}
      data-motion={motion}
      data-entered={entered}
    >
      {children}
    </div>
  )
}
