# 네이티브 시스템 PiP

- 대상: Android·iOS. 웹은 네이티브 시스템 PiP 기능의 대상이 아닙니다.
- 동작: 기존 수업 연결을 유지하며 OS 영상통화 창으로 이동합니다. OS 지원 여부와 사용자 설정도 충족해야 합니다.
- 작은 영상 창에는 영상 한 명만 표시합니다. 창을 탭해 메뉴를 열고 Android·iOS 시스템의 크게 보기(전체 화면 복귀) 버튼을 누르면 같은 수업을 이어갑니다. 앱은 같은 기능의 버튼을 따로 추가하지 않습니다.
- Android 학생이 미러링 중이면 메뉴에 **화면 저장**과 **화면 공유 중지** 아이콘을 추가합니다. 시스템 메뉴는 아이콘만 그리므로 PiP 동안 화면 아래에 같은 동작의 글자 버튼 바도 띄웁니다(다른 앱 위 표시 창, 공유 화면에도 보임). 화면 공유 중지는 앱을 전체 화면으로 되돌립니다. [미러링 PiP 변경 기록](changes/mirroring-pip-actions.json), [글자 버튼 변경 기록](changes/prejoin-teacher-count-and-pip-text-actions.json)
- 권한/종료: 시스템 창을 닫으면 본인만 퇴장하고, 수업 전체 종료 권한은 기존 서버 정책을 따릅니다.
- Android·iOS의 공통 수업 상태가 PiP 닫기와 서버 종료를 처리합니다. 서버 종료가 겹치면 화면·미디어·실시간 연결을 한 번만 정리합니다. [변경 기록](changes/mobile-meeting-session.json)
- 범위: 서버/웹의 별도 새 API가 필요 없는 기존 baseline 기능입니다.
- 실행 결과는 [전체 화면 복귀 변경 기록](changes/mobile-pip-fullscreen.json)과 [기존 PiP 검증](../mobile/docs/VERIFICATION.md#pip-추가-검증--2026-11-14)에 있습니다.

`meeting.pip` 지원 협상과 OS eligibility가 모두 허용될 때만 기능을 엽니다.
