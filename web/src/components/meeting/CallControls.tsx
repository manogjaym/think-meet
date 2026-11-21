import { designContent } from "../../generated/design-content"
import type { Panel, Role } from "../../models"
import { Icon } from "../ui"

export function CallControls({
  role,
  raised,
  setRaised,
  panel,
  setPanel,
  screenSharing,
  showShare = true,
  showMaterials = role === "teacher",
  onShareScreen,
  onEnd,
  mic,
  cam,
  setMic,
  setCam,
  participantCount,
  unreadChatCount = 0,
}: {
  role: Role
  raised: boolean
  setRaised: (x: boolean) => void
  panel: Panel
  setPanel: (p: Panel) => void
  screenSharing: boolean
  showShare?: boolean
  showMaterials?: boolean
  onShareScreen: () => void
  onEnd: () => void
  mic: boolean
  cam: boolean
  setMic: (value: boolean) => void
  setCam: (value: boolean) => void
  participantCount: number
  unreadChatCount?: number
}) {
  const togglePanel = (next: Panel) => setPanel(panel === next ? null : next)
  const chatUnread = panel === "chat" ? 0 : unreadChatCount
  return (
    <footer className="call-controls" aria-label="수업 조작">
      <div className="control-group device-controls">
        <button
          className={!mic ? "off" : ""}
          onClick={() => setMic(!mic)}
          aria-label={mic ? "마이크 끄기" : "마이크 켜기"}
          aria-pressed={mic}
        >
          <span className="control-icon">
            <Icon name={mic ? "mic" : "micOff"} size={22} />
          </span>
          <small>{mic ? "마이크" : "음소거 해제"}</small>
        </button>
        <button
          className={!cam ? "off" : ""}
          onClick={() => setCam(!cam)}
          aria-label={cam ? "카메라 끄기" : "카메라 켜기"}
          aria-pressed={cam}
        >
          <span className="control-icon">
            <Icon name={cam ? "video" : "videoOff"} size={22} />
          </span>
          <small>{cam ? "카메라" : "카메라 켜기"}</small>
        </button>
      </div>
      <span className="control-divider" />
      <div className="control-group meeting-tools">
        {showShare && <button
          className={screenSharing ? "selected sharing" : ""}
          onClick={onShareScreen}
          aria-pressed={screenSharing}
          aria-label={screenSharing ? "화면 공유 중지" : "화면 공유"}
        >
          <span className="control-icon">
            <Icon name="screen" size={22} />
          </span>
          <small>{screenSharing ? "공유 중지" : "화면 공유"}</small>
        </button>}
        <button
          className={panel === "people" ? "selected" : ""}
          onClick={() => togglePanel("people")}
          aria-expanded={panel === "people"}
          aria-controls="meeting-side-panel"
          aria-label={`${designContent.meetingPeopleControl} ${participantCount}명`}
        >
          <span className="control-icon">
            <Icon name="users" size={22} />
            <span className="control-count">{participantCount}</span>
          </span>
          <small>{designContent.meetingPeopleControl}</small>
        </button>
        <button
          className={panel === "chat" ? "selected" : ""}
          onClick={() => togglePanel("chat")}
          aria-expanded={panel === "chat"}
          aria-controls="meeting-side-panel"
          aria-label={chatUnread ? `채팅, 읽지 않은 메시지 ${chatUnread}개` : "채팅"}
          data-panel-trigger="chat"
        >
          <span className="control-icon">
            <Icon name="chat" size={22} />
            {chatUnread > 0 && <span className="control-chat-unread" aria-hidden="true">{chatUnread > 99 ? "99+" : chatUnread}</span>}
          </span>
          <small>채팅</small>
        </button>
        {role === "teacher" ? showMaterials && (
          <button
            className={panel === "content" ? "selected" : ""}
            onClick={() => togglePanel("content")}
            aria-expanded={panel === "content"}
            aria-controls="meeting-side-panel"
          >
            <span className="control-icon">
              <Icon name="folder" size={22} />
            </span>
            <small>수업 자료</small>
          </button>
        ) : (
          <button
            className={raised ? "selected" : ""}
            onClick={() => setRaised(!raised)}
            aria-pressed={raised}
          >
            <span className="control-icon">
              <Icon name="hand" size={22} />
            </span>
            <small>{raised ? "손 내리기" : "손들기"}</small>
          </button>
        )}
        <button
          className={panel === "more" ? "selected" : ""}
          onClick={() => togglePanel("more")}
          aria-expanded={panel === "more"}
          aria-controls="meeting-side-panel"
          data-panel-trigger="more"
        >
          <span className="control-icon">
            <Icon name="more" size={22} />
          </span>
          <small>더보기</small>
        </button>
      </div>
      <button
        className="hangup"
        onClick={onEnd}
        aria-label={role === "teacher" ? "수업 종료" : "수업 나가기"}
      >
        <Icon name="phone" size={23} />
        <small>{role === "teacher" ? "수업 종료" : "나가기"}</small>
      </button>
    </footer>
  )
}
