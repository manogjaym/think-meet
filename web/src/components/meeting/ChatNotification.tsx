import { useLayoutEffect, useRef } from "react"
import { colorFor } from "../../lib/api"
import type { MeetingSnapshot } from "../../lib/meeting"
import { Avatar, Icon } from "../ui"

export function ChatNotification({ message, onOpen, onDismiss }: {
  message: MeetingSnapshot["messages"][number]
  onOpen: () => void
  onDismiss: () => void
}) {
  const notificationRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => () => {
    const notification = notificationRef.current
    if (notification?.contains(document.activeElement)) {
      notification.closest(".meeting")?.querySelector<HTMLButtonElement>('[data-panel-trigger="chat"]')?.focus()
    }
  }, [])
  return (
    <div className="chat-notification-region">
      <div ref={notificationRef} className="meeting-chat-notification" data-testid="chat-notification" role="status" aria-live="polite" aria-atomic="true">
        <button className="chat-notification-open" onClick={onOpen} aria-label="채팅 열기">
          <Avatar name={message.userName} color={colorFor(message.userId)} small />
          <span className="chat-notification-content">
            <span className="chat-notification-heading"><strong>{message.userName}</strong><small>새 메시지</small></span>
            <span className="chat-notification-preview">{message.text}</span>
            <span className="chat-notification-action">채팅 열기<Icon name="chevron" size={14} /></span>
          </span>
        </button>
        <button className="chat-notification-dismiss" onClick={onDismiss} aria-label="채팅 알림 닫기"><Icon name="close" size={16} /></button>
      </div>
    </div>
  )
}
