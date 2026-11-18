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
  "meetingPeoplePanel": "참석자",
  "remoteAssistRequest": "화면 보기 요청",
  "remoteAssistStudentScreen": "학생 화면 보기",
  "remoteAssistRequestHelp": "참여 중인 Android 학생의 화면 보기를 요청하세요. 학생이 승인하면 전체 화면을 볼 수 있어요.",
  "remoteAssistStopShareFirst": "현재 공유를 중지한 뒤 학생 화면 보기를 요청해 주세요.",
  "remoteAssistApprove": "승인하고 화면 공유",
  "remoteAssistDecline": "거절",
  "remoteAssistStop": "화면 안내 중지",
  "remoteAssistWaiting": "학생의 승인을 기다리고 있어요",
  "remoteAssistPreparing": "전체 화면 공유를 준비하고 있어요",
  "remoteAssistActive": "학생 화면을 눌러 위치를 알려주세요",
  "remoteAssistUnsupported": "다른 앱 위 안내는 Android 학생 기기에서만 지원해요",
  "remoteAssistConsent": "전체 화면이 수업 참여자에게 공유돼요. 다른 앱 위에 선생님의 포인터가 표시되며 언제든 중지할 수 있어요.",
  "remoteAssistTitle": "선생님의 화면 보기 요청",
  "remoteAssistActiveStudent": "다른 앱에서도 선생님의 위치 안내를 받을 수 있어요.",
  "remoteAssistGeometryWaiting": "화면 방향을 맞추고 있어요. 잠시 기다려 주세요.",
  "remoteAssistUseApproval": "화면 보기 요청의 승인 버튼으로 공유를 시작해 주세요."
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
    ],
    "participantLayout": {
      "basis": "실제 영상 영역의 폭·높이에서 페이지 탐색 공간 52px/dp를 제외합니다.",
      "grid": "표시 인원 × 폭 / 사용 가능 높이의 제곱근을 반올림하되 기존 열·행 수용 범위를 지킵니다.",
      "speaker": "폭이 사용 가능 높이 이하면 상하, 더 넓으면 좌우로 배치합니다.",
      "resize": "웹·Android·iOS에서 회전·창 크기·옆 패널 변경 시 다시 계산합니다."
    },
    "remoteAssistance": {
      "web": "web/src/screens/Meeting.tsx",
      "native": "mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/meeting/MeetingScreen.kt",
      "sections": [
        "participant-request",
        "student-consent",
        "android-overlay-permission",
        "full-display-capture-consent",
        "shared-screen-and-pip",
        "pointer-pulse",
        "stop-and-cleanup"
      ],
      "interaction": "수업 선생님이 Android 학생에게 요청하고 학생이 승인합니다. 웹은 더보기 → 학생 화면 보기 또는 참석자 패널에서 학생별 화면 보기 요청 버튼을 사용합니다. 기존 공유·승인 대기·캡처 준비·안내 진행 중에는 새 요청을 막습니다. OS 권한과 전체 화면 캡처가 성공한 세션만 PiP로 전환하며, 선생님이 영상을 누르면 학생의 원래 화면 위에 점을 표시합니다. 웹에서는 마우스를 누른 채 이동하면 포인터가 따라오고, 정지해도 누르는 동안 표시를 유지합니다. 놓으면 전송을 중단하며 마지막 좌표 수신 후 1.5초 뒤 숨깁니다.",
      "scope": "선생님 웹·Android·iOS 지원. 학생 수신은 Android만 지원하며 보호 앱·시스템 UI는 오버레이 표시를 제한할 수 있습니다.",
      "tokens": [
        "component.remotePointerSize",
        "component.remotePointerCoreSize",
        "component.remotePointerRingWidth",
        "color.danger"
      ]
    }
  }
} as const;
