import { designContent } from "../generated/design-content"
import { useEffect, useRef, useState } from "react"
import type { Role, Screen } from "../models"
import { Avatar, Icon } from "./ui"
import { BrandSymbol } from "./BrandSymbol"
import { colorFor, type User } from "../lib/api"

export function TopBar({
  role,
  user,
  onLogout,
  screen,
  setScreen,
  isEditing = false,
  onBack,
  backLabel = "이전 화면으로 돌아가기",
}: {
  role: Role
  user: User
  onLogout: () => Promise<void>
  screen: Screen
  isEditing?: boolean
  onBack?: () => void
  backLabel?: string
  setScreen: (s: Screen) => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [])
  if (screen === "meeting") return null
  const isRoot = screen === "home" || (screen === "form" && !isEditing)
  if (!isRoot) {
    const canGoBack =
      screen === "detail" ||
      screen === "prejoin" ||
      (screen === "form" && isEditing)
    const titles: Partial<Record<Screen, string>> = {
      detail: "수업 상세",
      prejoin: "입장 준비",
      form: "수업 일정 수정",
      waiting: "입장 대기",
      created: "예약 완료",
      ended: "수업 종료",
      exception: "안내",
    }
    return (
      <header className="screen-appbar" aria-label="화면 내비게이션">
        {canGoBack && (
          <button
            className="appbar-back"
            onClick={onBack || (() => setScreen("home"))}
            aria-label={backLabel}
          >
            <Icon name="back" size={24} />
          </button>
        )}
        <span className="appbar-title">{titles[screen]}</span>
        {!canGoBack && (
          <button
            className="appbar-close"
            onClick={() => setScreen("home")}
            aria-label="닫고 내 수업으로 이동"
          >
            <Icon name="close" size={23} />
          </button>
        )}
      </header>
    )
  }
  return (
    <header className="topbar topbar-home">
      <button
        className="brand"
        onClick={() => setScreen("home")}
        aria-label="웅진 씽크빅 홈"
      >
        <span className="brand-mark">
          <BrandSymbol />
        </span>
        <strong>{designContent.brandName}</strong>
        <span className="brand-product">{designContent.brandProduct}</span>
      </button>
      <nav
        className={`topbar-nav ${role === "student" ? "single-tab" : ""}`}
        aria-label="주요 화면"
      >
        <button
          className={screen === "home" ? "active" : ""}
          onClick={() => setScreen("home")}
          aria-current={screen === "home" ? "page" : undefined}
        >
          <span className="root-tab-icon">
            <Icon name="calendar" size={22} />
          </span>
          <span>{designContent.rootHomeTab}</span>
        </button>
        {role === "teacher" && (
          <button
            className={screen === "form" ? "active" : ""}
            onClick={() => setScreen("form")}
            aria-current={screen === "form" ? "page" : undefined}
          >
            <span className="root-tab-icon">
              <Icon name="plus" size={22} />
            </span>
            <span>{designContent.rootBookingTab}</span>
          </button>
        )}
      </nav>
      <div className="account-menu" ref={menu}>
        <button
          className="profile"
          aria-expanded={open}
          aria-controls="account-options"
          onClick={() => setOpen(!open)}
        >
          <Avatar name={user.name} color={colorFor(user.id)} small />
          <span>
            {user.name} {role === "teacher" ? "선생님" : "학생"}
          </span>
          <span className="profile-chevron">
            <Icon name="chevron" size={16} />
          </span>
        </button>
        {open && (
          <div id="account-options" className="profile-menu">
            <p>{user.username}</p>
            <button
              onClick={async () => {
                setError("")
                try {
                  await onLogout()
                  setOpen(false)
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "로그아웃하지 못했어요.",
                  )
                }
              }}
            >
              <span>로그아웃</span>
            </button>
            {error && (
              <p className="service-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
