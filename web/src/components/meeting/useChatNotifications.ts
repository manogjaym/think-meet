import { useCallback, useEffect, useRef, useState } from "react"
import type { MeetingSnapshot } from "../../lib/meeting"

type Message = MeetingSnapshot["messages"][number]
type ChatNotificationsOptions = {
  lessonId: string
  userId: string
  messages?: MeetingSnapshot["messages"]
  chatOpen: boolean
}
type NotificationState = {
  lessonId: string
  userId: string
  unreadCount: number
  notification: Message | null
}

export function useChatNotifications({
  lessonId,
  userId,
  messages,
  chatOpen,
}: ChatNotificationsOptions) {
  const received = useRef({
    lessonId,
    userId,
    initialized: false,
    ids: new Set<string>(),
  })
  const [state, setState] = useState<NotificationState>({
    lessonId,
    userId,
    unreadCount: 0,
    notification: null,
  })

  useEffect(() => {
    const changed =
      received.current.lessonId !== lessonId ||
      received.current.userId !== userId
    if (changed) {
      received.current = {
        lessonId,
        userId,
        initialized: false,
        ids: new Set<string>(),
      }
      setState({ lessonId, userId, unreadCount: 0, notification: null })
    }

    const history = received.current
    if (messages) {
      if (!history.initialized) {
        // The first snapshot is restored history, not a batch of new messages.
        messages.forEach((message) => history.ids.add(message.id))
        history.initialized = true
      } else {
        const incoming: Message[] = []
        for (const message of messages) {
          if (history.ids.has(message.id)) continue
          history.ids.add(message.id)
          if (message.userId !== userId) incoming.push(message)
        }
        if (!chatOpen && incoming.length) {
          setState((current) => ({
            lessonId,
            userId,
            unreadCount:
              (current.lessonId === lessonId && current.userId === userId
                ? current.unreadCount
                : 0) + incoming.length,
            notification: incoming[incoming.length - 1],
          }))
        }
      }
    }

    if (chatOpen) {
      setState((current) =>
        current.unreadCount || current.notification
          ? { lessonId, userId, unreadCount: 0, notification: null }
          : current,
      )
    }
  }, [lessonId, userId, messages, chatOpen])

  useEffect(() => {
    const notificationId = state.notification?.id
    if (!notificationId) return
    const timer = window.setTimeout(() => {
      setState((current) =>
        current.lessonId === state.lessonId &&
        current.userId === state.userId &&
        current.notification?.id === notificationId
          ? { ...current, notification: null }
          : current,
      )
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [state.notification?.id, state.lessonId, state.userId])

  const dismissNotification = useCallback(() => {
    // Dismissing the preview leaves the unread count until chat is opened.
    setState((current) =>
      current.notification ? { ...current, notification: null } : current,
    )
  }, [])

  const sameSession = state.lessonId === lessonId && state.userId === userId
  return {
    unreadCount: sameSession && !chatOpen ? state.unreadCount : 0,
    notification: sameSession && !chatOpen ? state.notification : null,
    dismissNotification,
  }
}
