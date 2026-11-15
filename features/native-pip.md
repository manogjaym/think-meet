# 네이티브 시스템 PiP

- 대상: Android·iOS. 웹은 네이티브 시스템 PiP 기능의 대상이 아닙니다.
- 동작: 기존 수업 연결을 유지하며 OS 영상통화 창으로 이동합니다. OS 지원 여부와 사용자 설정도 충족해야 합니다.
- 권한/종료: 시스템 창을 닫으면 본인만 퇴장하고, 수업 전체 종료 권한은 기존 서버 정책을 따릅니다.
- 범위: 서버/웹의 별도 새 API가 필요 없는 기존 baseline 기능입니다.
- 검증: `mobile/docs/VERIFICATION.md`. Android의 이전 PiP 실행 검증과 iOS 빌드 검증을 구분합니다.

`meeting.pip` 지원 협상과 OS eligibility가 모두 허용될 때만 기능을 엽니다.
