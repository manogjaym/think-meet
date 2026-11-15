import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

const PresenceActiveContext = createContext(true)

/** Dialog focus traps stop as soon as the closing animation begins. */
export function usePresenceActive() {
  return useContext(PresenceActiveContext)
}

/** Retains the last visible content briefly, so closing can animate too. */
export function AnimatedPresence({
  show,
  children,
  duration = 180,
}: {
  show: boolean
  children: ReactNode
  duration?: number
}) {
  const parentActive = usePresenceActive()
  const active = show && parentActive
  const [mounted, setMounted] = useState(show)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const visibleChildren = useRef(children)
  if (show) visibleChildren.current = children

  useEffect(() => {
    if (show) {
      setMounted(true)
      return
    }
    if (!mounted) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false)
      return
    }
    const timeout = window.setTimeout(() => setMounted(false), duration)
    return () => window.clearTimeout(timeout)
  }, [show, mounted, duration])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Dialog layout cleanups restore focus before the closing tree becomes inert.
    container.inert = !active
    if (active) container.removeAttribute("aria-hidden")
    else container.setAttribute("aria-hidden", "true")
  }, [active])

  if (!show && !mounted) return null

  return createPortal(
    <PresenceActiveContext.Provider value={active}>
      <div
        ref={(container) => {
          containerRef.current = container
          // Reopening must release inert before the dialog's autofocus runs.
          if (container && active) {
            container.inert = false
            container.removeAttribute("aria-hidden")
          }
        }}
        className="animated-presence meeting-dialog-presence"
        data-state={show ? "enter" : "exit"}
        style={
          {
            "--presence-duration": `${duration}ms`,
            pointerEvents: active ? undefined : "none",
          } as CSSProperties
        }
      >
        {visibleChildren.current}
      </div>
    </PresenceActiveContext.Provider>,
    document.body,
  )
}
