# 입장 전 장치 점검 검증

2026-11-21에 별도 로컬 PostgreSQL과 LiveKit 테스트 환경에서 실행했습니다.

| 대상 | 검사 | 결과 |
|---|---|---|
| 공통·서버 | 루트에서 `npm run shared:check`, 변경 파일 검사, `npm run verify` | 통과. 임시 DB에서 대기 기록 마이그레이션 적용 |
| 웹 | `web/`에서 테스트 서버 `BASE_URL`과 테스트 계정 `TEST_PASSWORD`로 `npm run test:e2e -- e2e/prejoin.spec.ts` | 2개 통과. 대기 등록·해제·만료·중복 집계, 이름 조회 권한, 자동 입장, 공개 수업 취소, 카메라 권한 오류, 서버 재시도, 테스트음 확인 |
| Android 빌드 | `mobile/`에서 `./gradlew :composeApp:testDebugUnitTest :composeApp:assembleDebug :composeApp:assembleDebugAndroidTest` | 핵심 테스트 40개 및 앱·테스트 APK 빌드 통과 |
| Android 화면 | 기존 에뮬레이터 설정으로 `DesignParityCaptureTest`의 `captureUntil=prejoin` 실행 | 휴대폰 학생·태블릿 선생님 2회 통과. 카메라 미리보기, 테스트음, 응답 시간, 학생 대기·점검 복귀와 선생님 대기 패널 확인 |
| iOS 빌드 | `mobile/`에서 `./gradlew :composeApp:linkDebugFrameworkIosSimulatorArm64`과 시뮬레이터 대상 `xcodebuild` | 프레임워크와 앱 빌드 통과 |
| iOS 화면 | iPhone·iPad 테스트 복제본에서 `xcrun simctl keychain` 및 `xcrun simctl install` | 테스트 CA 등록과 앱 설치가 응답 제한 시간을 초과해 화면 확인 미실행 |

웹 412px·1024px와 Android 약 411dp·1024dp에서 같은 예약 수업의 학생·선생님 화면을 비교했습니다. 카메라 영상에는 브라우저 테스트 장치와 에뮬레이터를 사용했습니다. 마이크 입력 막대는 브라우저 테스트 장치에서 확인했습니다. iOS 화면과 실기기 카메라 전환·입출력은 미검증입니다.

이번 기능의 변경 파일 검사는 통과했습니다. 전체 작업 트리를 한 목록으로 검사하면 같은 작업 트리의 별도 `classroom-notes-camera` 변경 기록과 서버 파일 분류가 충돌합니다.
