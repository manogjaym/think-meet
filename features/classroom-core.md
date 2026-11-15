# 기존 공통 수업 기능

현재 배포된 기능을 기록하는 baseline이며 새로운 기능의 완료 증명으로 재사용하지 않습니다.

- 대상: 웹·Android·iOS. 앱의 공통 UI와 상태는 KMP `commonMain`에서 공유합니다.
- 동작: 로그인, 수업 조회/예약/수정, 공개/초대 수업, 대기/입장, 실시간 채팅·손들기·화면/자료 공유·판서.
- 권한: 서버가 세션·수업 소유자·참여자 권한을 매 요청과 Socket 명령에서 확인합니다. 기능 플래그는 권한을 부여하지 않습니다.
- 상태/오류: `contracts/openapi.json` 및 `contracts/realtime.json`을 기준으로 합니다. 기존 구버전 클라이언트는 revision 0으로 호환합니다.
- 플랫폼 차이: 기기 선택·권한·네이티브 영상/PDF 렌더러는 플랫폼에 맞게 유지합니다.
- 기존 검증: `design-qa.md`, `design/VERIFICATION.md`, `mobile/docs/VERIFICATION.md`, `server/VERIFICATION.md`. iOS 실기기 실행과 시각 비교를 수행했다는 의미는 아닙니다.

새 공개 API·Socket 명령은 이 baseline에 덧붙여 자동 활성화하지 않습니다. 새 기능 ID를 등록해 기본 비활성 상태에서 개발합니다.
