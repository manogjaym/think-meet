# 기존 공통 수업 기능

현재 배포된 기능을 기록하는 baseline이며 새로운 기능의 완료 증명으로 재사용하지 않습니다.

- 대상: 웹·Android·iOS. 앱의 공통 UI와 상태는 KMP `commonMain`에서 공유합니다.
- 동작: 로그인, 수업 조회/예약/수정, 공개/초대 수업, 대기/입장, 실시간 채팅·손들기·화면/자료 공유·판서.
- 권한: 서버가 세션·수업 소유자·참여자 권한을 매 요청과 Socket 명령에서 확인합니다. 기능 플래그는 권한을 부여하지 않습니다.
- 상태/오류: `contracts/openapi.json` 및 `contracts/realtime.json`을 기준으로 합니다. 기존 구버전 클라이언트는 revision 0으로 호환합니다.
- 플랫폼 차이: 기기 선택·권한·네이티브 영상/PDF 렌더러는 플랫폼에 맞게 유지합니다.
- 참가자 영상 배치: 웹·Android·iOS는 영상 영역의 실제 가로·세로 비율과 인원수로 열 수를 정합니다. 두 명은 세로 영역에서 상하, 가로 영역에서 좌우로 표시하고 발표자 보기도 같은 비율로 전환합니다. 회전·창 크기·옆 패널 변화 시 다시 계산하며 페이지당 수용 인원과 탐색은 유지합니다. 검증 범위는 [변경 기록](changes/meeting-aspect-layout.json)을 참고합니다.
- 앱 서버 설정: Android/iOS는 [모바일 서버 설정](../mobile/README.md#서버-연결)의 빌드 환경변수에서 HTTPS 주소를 읽습니다. 로그인 브랜드·계정 메뉴의 주소 입력 UI와 저장된 `server.origin`은 사용하지 않습니다. REST·Socket·참여 링크가 같은 주소를 사용하며 주소 누락·잘못된 형식은 빌드 오류입니다. 앱 설정 변경이므로 웹·서버 API·권한·기능 플래그·계약 revision은 변경하지 않습니다. 이번 검증과 한계는 [변경 기록](changes/mobile-server-origin.json)에 남깁니다.
- 개발 서버 인증서: Android 디버그 빌드는 `THINK_MEET_SERVER_CA_FILE`에 지정한 공개 CA를 포함할 수 있습니다. 상대 경로는 `mobile/` 기준이며 개인키·CA가 아닌 인증서는 거부합니다. 릴리스 앱은 시스템 CA만 사용하고 iOS는 해당 CA를 기기 신뢰 저장소에 설치합니다. 서버 CA가 교체되면 새 공개 CA로 다시 설치·빌드해야 합니다.
- 기존 검증: `design-qa.md`, `design/VERIFICATION.md`, `mobile/docs/VERIFICATION.md`, `server/VERIFICATION.md`. iOS 실기기 실행과 시각 비교를 수행했다는 의미는 아닙니다.

새 공개 API·Socket 명령은 이 baseline에 덧붙여 자동 활성화하지 않습니다. 새 기능 ID를 등록해 기본 비활성 상태에서 개발합니다.
