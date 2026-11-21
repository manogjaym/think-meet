# 출결 화면 검증

2026-11-21에 격리한 PostgreSQL과 로컬 API로 확인했습니다. 윤지아 테스트 선생님의 담당 학생 박서준에게 11월 종료 수업 다섯 건을 배정했습니다. 월별 집계는 출석 3건, 지각 1건, 결석 1건, 출석률 60%입니다. 지각 기록에는 기기 문제와 메모가 저장되어 있습니다.

## 화면 비교

| 환경 | 화면 | 검증 |
|---|---|---|
| 웹 393 × 852 px | [목록](web-phone-list.png), [수정](web-phone-edit.png) | 2 × 2 요약과 줄을 나눈 수업 카드. 실제 API로 목록·빈 달·수정 화면을 열었습니다. |
| 웹 1024 × 768 px | [목록](web-tablet-list.png), [수정](web-tablet-edit.png) | 가로 요약과 수업 행, 가운데 수정창. 실제 API에서 저장과 월 이동을 확인했습니다. |
| Android 1080 × 2400 px, 420 dpi | [목록](android-phone-list.png), [수정](android-phone-edit.png) | 휴대폰 폭에서 같은 데이터와 2 × 2 요약을 확인했습니다. |
| Android 2048 × 1536 px, 320 dpi | [목록](android-tablet-list.png), [수정](android-tablet-edit.png) | 태블릿 폭에서 가로 요약·수업 행과 수정창을 비교했습니다. |

첨부 이미지의 태블릿 화면에서 기기 테두리를 제외하고 실제 웹 화면과 나란히 비교했습니다. 화면 제목, 요약, 월 이동, 목록, 수정창 순서를 확인했습니다. 실제 수업 이름과 날짜를 사용했고, 메모에 입력 항목 이름을 표시했습니다. 비교 중 출결 제목 위치를 화면 가운데로 수정했고 두 폭에서 새 캡처를 확인했습니다.

웹 자동 검사에서 저장 실패 시 상태·사유·메모 보존과 재시도, 새로고침 후 수정값 조회, 수정창을 닫은 뒤 포커스 복원을 확인했습니다.

Android도 같은 API에서 두 화면 폭으로 월 이동, 빈 달, 수정, 저장 실패와 재시도를 확인했습니다. 테스트 중 학생 연결을 잠시 해제해 저장을 실패시키고, 입력이 유지되는지 확인한 뒤 연결을 복원해 저장을 재시도했습니다. 다시 연 수정 화면과 DB에 선택 사유가 저장되었음을 확인했습니다. 첫 조회 직후 요약 카드가 화면 위로 밀리는 문제를 수정한 후 다시 캡처했습니다. 기존 AVD를 읽기 전용으로 실행했고 테스트 화면 크기와 밀도를 복원했습니다.

## 핵심 검사

- 저장소 루트에서 `npm run shared:check`, `npm run verify`를 실행했습니다. 계약 호환성, 경로 연결, 생성물, 공통 테스트, 서버·웹 타입 검사와 웹 빌드가 통과했습니다.
- `server/`에서 `ATTENDANCE_TEST_DATABASE_URL`과 `ATTENDANCE_TEST_ORIGIN`을 별도 테스트 DB·API로 지정하고 `node --test test/student-attendance.integration.mjs`를 실행했습니다. 새 DB에 마이그레이션을 적용한 뒤 월 경계, 조회 범위, 접근 차단, 구간 합산, 수정 저장과 재시도를 확인했습니다.
- `web/`에서 `BASE_URL`을 로컬 웹 주소로 지정하고 `npm run test:e2e -- student-attendance.spec.ts`를 실행했습니다. 두 화면 폭에서 통과했습니다.
- `mobile/`에서 JDK 17, Android SDK와 검증용 HTTPS 서버 주소를 설정했습니다. `./gradlew :composeApp:checkDesignTokens :composeApp:checkContracts :composeApp:testDebugUnitTest :composeApp:assembleDebug :composeApp:linkDebugFrameworkIosSimulatorArm64`가 통과했습니다. Xcode에서 `ThinkMeet` 스킴의 서명 없는 iOS 시뮬레이터용 호스트 앱 빌드도 통과했습니다.
- 출결 변경 파일 목록으로 `npm run shared:check -- --changed-files <목록>`을 실행했습니다. 같은 작업 폴더의 다른 기능까지 합친 목록에서는 수업 노트 카메라 변경 기록의 범위 검사에 걸렸습니다.
- iOS 18.4에서 iPhone 16e 부팅 완료와 iPad mini 앱 시작 요청이 응답하지 않아 출결 화면 실행은 확인하지 못했습니다. iPad에 추가한 앱과 임시 테스트 CA를 제거했고, 두 시뮬레이터를 종료 상태로 복원했습니다. 실기기와 원격 CI는 미실행입니다.

웹·Android 화면 비교는 통과했습니다. iOS 화면 증거가 없어 전체 화면 검증은 `final result: blocked`로 기록합니다.
