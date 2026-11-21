# 네이티브 시스템 PiP

- 대상: Android·iOS. 웹은 네이티브 시스템 PiP 기능의 대상이 아닙니다.
- 동작: 기존 수업 연결을 유지하며 OS 영상통화 창으로 이동합니다. OS 지원 여부와 사용자 설정도 충족해야 합니다.
- 작은 영상 창을 탭해 메뉴를 엽니다. Android에서 **전체 화면으로 돌아가기**, iOS에서 시스템 전체 화면 복귀 버튼을 누르면 같은 수업을 이어갑니다.
- 권한/종료: 시스템 창을 닫으면 본인만 퇴장하고, 수업 전체 종료 권한은 기존 서버 정책을 따릅니다.
- Android·iOS의 공통 수업 상태가 PiP 닫기와 서버 종료를 처리합니다. 서버 종료가 겹치면 화면·미디어·실시간 연결을 한 번만 정리합니다. [변경 기록](changes/mobile-meeting-session.json)
- 범위: 서버/웹의 별도 새 API가 필요 없는 기존 baseline 기능입니다.
- 실행 결과는 [전체 화면 복귀 변경 기록](changes/mobile-pip-fullscreen.json)과 [기존 PiP 검증](../mobile/docs/VERIFICATION.md#pip-추가-검증--2026-11-14)에 있습니다.

`meeting.pip` 지원 협상과 OS eligibility가 모두 허용될 때만 기능을 엽니다.
