import {
  createElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react"
import { usePresenceActive } from "./AnimatedPresence"

import { designIcons, iconStyle } from "../generated/design-vectors"

type IconProps = {
  name: string
  size?: number
}

export function Icon({ name, size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      {...iconStyle}
      aria-hidden
    >
      {designIcons[name]?.map(({ type, attributes }, index) => createElement(type, { ...attributes, key: index }))}
    </svg>
  )
}

export function Avatar({
  name,
  color = "#547c9c",
  small = false,
}: {
  name: string
  color?: string
  small?: boolean
}) {
  return (
    <span
      className={`avatar ${small ? "avatar-small" : ""}`}
      style={{ background: color }}
    >
      {name.replace(/\s*(선생님|학생)$/, "").slice(-2)}
    </span>
  )
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode
  tone?: string
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Confirm({
  title,
  copy,
  cancel,
  confirm,
  confirmText,
}: {
  title: string
  copy: string
  cancel: () => void
  confirm: () => void
  confirmText: string
}) {
  const active = usePresenceActive()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef(cancel)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    cancelRef.current = cancel
  }, [cancel])

  useLayoutEffect(() => {
    if (!active) return
    const previousFocus = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    if (!dialog) return
    cancelButtonRef.current?.focus()

    const focusableElements = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        cancelRef.current()
      }
      if (event.key !== "Tab") return
      const elements = focusableElements()
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (!first) {
        event.preventDefault()
        dialog.focus()
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) {
        const focusTarget = cancelButtonRef.current ?? dialog
        focusTarget.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("focusin", onFocusIn)
    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("focusin", onFocusIn)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [active])

  return (
    <div className="modal-backdrop" onMouseDown={cancel}>
      <div
        ref={dialogRef}
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="confirm-heading">
          <div className="confirm-icon">
            <Icon name="alert" size={19} />
          </div>
          <h2 id={titleId}>{title}</h2>
        </div>
        <p id={descriptionId}>{copy}</p>
        <div className="confirm-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="secondary"
            onClick={cancel}
          >
            취소
          </button>
          <button type="button" className="danger" onClick={confirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
