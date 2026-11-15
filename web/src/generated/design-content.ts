// Generated from design/system.json.
export const designContent = {
  "brandName": "웅진 씽크빅",
  "brandProduct": "클래스",
  "loginBrand": "웅진 씽크빅 클래스",
  "loginTitle": "우리 수업을 시작해 볼까요?",
  "loginDescription": "안내받은 아이디와 비밀번호로 로그인해 주세요.",
  "loginHelp": "계정이 필요하거나 비밀번호를 잊었다면 담당 선생님에게 문의해 주세요.",
  "homeTitle": "내 수업",
  "scheduleTitle": "수업 일정",
  "quickJoinTitle": "수업 링크가 있나요?",
  "quickJoinDescription": "수업 코드나 링크로 바로 참여하세요.",
  "quickJoinPlaceholder": "코드 또는 링크 붙여넣기",
  "liveTab": "진행 중",
  "upcomingTab": "예정된 수업",
  "historyTab": "지난 수업",
  "rootHomeTab": "내 수업",
  "rootBookingTab": "수업 예약",
  "meetingConnected": "연결됨",
  "meetingPeopleControl": "참가자",
  "meetingChatPanel": "수업 채팅",
  "meetingPeoplePanel": "참석자"
} as const;
export const screenContract = {
  "login": {
    "web": "web/src/screens/Login.tsx",
    "native": "mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/App.kt",
    "sections": [
      "book-brand",
      "heading",
      "description",
      "username",
      "password",
      "error",
      "login",
      "help"
    ],
    "layout": [
      "layout.loginCardMaxWidth",
      "layout.loginPhoneBreakpoint"
    ]
  },
  "dashboard": {
    "web": "web/src/screens/Home.tsx",
    "native": "mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/ui/HomeScreen.kt",
    "sections": [
      "greeting-and-heading",
      "session-focus",
      "quick-join",
      "schedule-heading",
      "schedule-tabs-and-search",
      "lesson-list"
    ],
    "layout": [
      "layout.dashboardMaxWidth",
      "layout.dashboardFeatureWide",
      "layout.dashboardCompact"
    ]
  },
  "lessons": {
    "web": "web/src/screens/Lessons.tsx",
    "native": "mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/ui/LessonScreens.kt",
    "sections": [
      "hierarchical-appbar",
      "lesson-or-form-card",
      "roster-or-invitation",
      "primary-action"
    ],
    "layout": [
      "layout.pageMaxWidth",
      "layout.formWide"
    ]
  },
  "prejoin": {
    "web": "web/src/screens/Join.tsx",
    "native": "mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/ui/LessonScreens.kt",
    "sections": [
      "hierarchical-appbar",
      "camera-preview-with-overlaid-toggles",
      "devices",
      "lesson-information",
      "public-access-notice-or-roster",
      "participants",
      "account",
      "device-summary",
      "join-action"
    ],
    "layout": [
      "layout.prejoinMaxWidth",
      "layout.prejoinWide",
      "layout.prejoinPhone"
    ]
  },
  "meeting": {
    "web": "web/src/screens/Meeting.tsx",
    "native": "mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/meeting/MeetingScreen.kt",
    "sections": [
      "dark-header",
      "gallery-or-shared-stage",
      "white-side-panel",
      "dark-call-controls"
    ],
    "layout": [
      "layout.meetingOverlayBreakpoint",
      "layout.meetingCompactBreakpoint",
      "layout.meetingPanelWidth"
    ]
  }
} as const;
