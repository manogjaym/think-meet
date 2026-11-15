import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { Icon } from "./ui"
import { usePresenceActive } from "./AnimatedPresence"

export function ScreenShareDialog({
  cancel,
  confirm,
}: {
  cancel: () => void
  confirm: (target: "browser" | "screen") => void
}) {
  const active = usePresenceActive()
  const [target, setTarget] = useState<"browser" | "screen">("browser")
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

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        cancelRef.current()
      }
      if (event.key !== "Tab") return
      const elements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0)
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
        className="screen-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="share-dialog-heading">
          <div className="confirm-icon">
            <Icon name="screen" size={19} />
          </div>
          <h2 id={titleId}>화면 공유</h2>
        </div>
        <p id={descriptionId}>공유할 화면 유형을 선택하세요. 최종 화면은 브라우저 선택기에서 지정합니다.</p>
        <div className="share-targets">
          <button
            type="button"
            className={target === "browser" ? "selected" : ""}
            aria-pressed={target === "browser"}
            onClick={() => setTarget("browser")}
          >
            <span>
              <Icon name="browser" />
            </span>
            <div>
              <strong>특정 브라우저 탭</strong>
              <small>선택한 탭만 안전하게 공유합니다.</small>
            </div>
            <i>{target === "browser" && <Icon name="check" size={14} />}</i>
          </button>
          <button
            type="button"
            className={target === "screen" ? "selected" : ""}
            aria-pressed={target === "screen"}
            onClick={() => setTarget("screen")}
          >
            <span>
              <Icon name="screen" />
            </span>
            <div>
              <strong>전체 화면</strong>
              <small>화면에 표시되는 모든 내용을 공유합니다.</small>
            </div>
            <i>{target === "screen" && <Icon name="check" size={14} />}</i>
          </button>
        </div>
        <div className="share-security-note">
          <Icon name="alert" size={16} />
          알림이나 개인 정보가 보이지 않는지 공유 전에 확인해 주세요.
        </div>
        <footer>
          <button
            ref={cancelButtonRef}
            type="button"
            className="secondary"
            onClick={cancel}
          >
            취소
          </button>
          <button type="button" className="primary" onClick={() => confirm(target)}>
            화면 공유하기
          </button>
        </footer>
      </div>
    </div>
  )
}
