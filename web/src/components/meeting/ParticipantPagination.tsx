import { useCallback, useLayoutEffect, useState, type RefCallback } from "react"
import { Icon } from "../ui"

export function useParticipantPagination(count: number, pageSize: number) {
  const total = Math.max(0, Math.floor(count))
  const size = Math.max(1, Math.floor(pageSize))
  const pageCount = Math.max(1, Math.ceil(total / size))
  const [selection, setSelection] = useState({ page: 0, size })
  const page =
    selection.size === size ? Math.min(selection.page, pageCount - 1) : 0

  // Persist corrections so departed participants cannot restore a stale page.
  if (selection.page !== page || selection.size !== size) {
    setSelection({ page, size })
  }

  const setPage = useCallback(
    (next: number) => {
      const page = Number.isFinite(next)
        ? Math.max(0, Math.min(Math.floor(next), pageCount - 1))
        : 0
      setSelection({ page, size })
    },
    [pageCount, size],
  )
  const start = total ? page * size : 0
  return { page, pageCount, start, end: Math.min(total, start + size), setPage }
}

export function useParticipantArea(): {
  areaRef: RefCallback<HTMLDivElement>
  width: number
  height: number
} {
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const areaRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    setArea(node)
  }, [])

  useLayoutEffect(() => {
    if (!area) {
      setDimensions((current) =>
        current.width || current.height ? { width: 0, height: 0 } : current,
      )
      return
    }
    let active = true
    const measure = () => {
      if (!active) return
      const { width, height } = area.getBoundingClientRect()
      setDimensions((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      )
    }
    measure()
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(area)
    if (!observer) window.addEventListener("resize", measure)
    return () => {
      active = false
      observer?.disconnect()
      if (!observer) window.removeEventListener("resize", measure)
    }
  }, [area])

  return { areaRef, ...dimensions }
}

export function ParticipantPagination({
  page,
  pageCount,
  start,
  end,
  total,
  onPageChange,
  compact = false,
  controlsId,
}: {
  page: number
  pageCount: number
  start: number
  end: number
  total: number
  onPageChange: (page: number) => void
  compact?: boolean
  controlsId?: string
}) {
  if (pageCount <= 1) return null
  return (
    <nav
      className={`participant-pagination${compact ? " is-compact" : ""}`}
      aria-label="참가자 영상 페이지"
    >
      <button
        type="button"
        aria-label="이전 참가자 페이지"
        aria-controls={controlsId}
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        <Icon name="back" size={18} />
      </button>
      <span
        className="participant-page-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span>
          {page + 1} / {pageCount}
        </span>
        <span className="participant-page-range">
          전체 {total}명 중 {total ? start + 1 : 0}–{end}명
        </span>
      </span>
      <button
        type="button"
        aria-label="다음 참가자 페이지"
        aria-controls={controlsId}
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(page + 1)}
      >
        <Icon name="chevron" size={18} />
      </button>
    </nav>
  )
}
