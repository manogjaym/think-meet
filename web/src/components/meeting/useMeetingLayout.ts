import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** Capture only explicit layout changes, so the call timer never restarts motion. */
export function useMeetingLayout() {
  const gridRef = useRef<HTMLDivElement>(null)
  const previousRects = useRef(new Map<HTMLElement, DOMRect>())
  const animations = useRef(new Set<Animation>())

  const captureLayout = useCallback(() => {
    previousRects.current.clear()
    if (!reducedMotion()) {
      gridRef.current
        ?.querySelectorAll<HTMLElement>(".video-tile")
        .forEach((tile) => {
          previousRects.current.set(tile, tile.getBoundingClientRect())
        })
    }
    animations.current.forEach((animation) => animation.cancel())
    animations.current.clear()
  }, [])

  useLayoutEffect(() => {
    const before = previousRects.current
    if (!before.size) return
    if (!reducedMotion()) {
      gridRef.current
        ?.querySelectorAll<HTMLElement>(".video-tile")
        .forEach((tile) => {
          const from = before.get(tile)
          const to = tile.getBoundingClientRect()
          if (!from || !from.width || !from.height || !to.width || !to.height)
            return
          const x = from.left - to.left
          const y = from.top - to.top
          const scaleX = from.width / to.width
          const scaleY = from.height / to.height
          if (
            Math.abs(x) +
              Math.abs(y) +
              Math.abs(scaleX - 1) +
              Math.abs(scaleY - 1) <
            0.01
          )
            return
          const animation = tile.animate(
            [
              {
                transformOrigin: "top left",
                transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`,
              },
              { transformOrigin: "top left", transform: "none" },
            ],
            { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" },
          )
          animations.current.add(animation)
          const forget = () => animations.current.delete(animation)
          animation.addEventListener("finish", forget, { once: true })
          animation.addEventListener("cancel", forget, { once: true })
        })
    }
    before.clear()
  })

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)")
    const cancel = () => {
      if (!preference.matches) return
      animations.current.forEach((animation) => animation.cancel())
      animations.current.clear()
      previousRects.current.clear()
    }
    preference.addEventListener("change", cancel)
    return () => {
      preference.removeEventListener("change", cancel)
      animations.current.forEach((animation) => animation.cancel())
      animations.current.clear()
    }
  }, [])

  return { gridRef, captureLayout }
}
