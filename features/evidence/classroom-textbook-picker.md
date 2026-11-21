# 교재 불러오기 검증

2026-11-21, 분리된 로컬 Docker 환경에서 계약 revision 11을 적용했습니다. 이번 화면 비교에는 같은 선생님·학생 계정과 6쪽짜리 검증 PDF를 사용했습니다. Android 계측 테스트가 시작되기 전에 종료되고 iPad 로그인 직후 세션이 사라지는 문제를 재현했습니다.

| 대상 | 실행 결과 |
|---|---|
| 공통·서버·웹 | 루트에서 `npm run shared:check`, 교재 기능 변경 파일 목록을 지정한 검사, `npm run verify` 통과. 공통 12개, 서버 23개, 웹 16개 테스트와 웹 빌드 통과. 서버 테스트에서 이전 revision의 학생이 첫 공유 3쪽을 받고, 권한·수업 모드·쪽 범위 오류 시 기존 공유를 유지하는지 확인했습니다. |
| Chromium | 휴대폰·태블릿 너비에서 PDF 미리보기, 첫 공유 3쪽과 학생의 펜 획 수신을 재확인했습니다. `web/`에서 `npm run test:e2e -- e2e/meeting.spec.ts e2e/devices.spec.ts` 2건 통과. 목록·미리보기 오류 재시도, 쪽별 판서 복원, 지우개·실행 취소·다시 실행, 화면 저장 미리보기, 다른 PDF와 MP4 전환을 확인했습니다. 화면 공유 전환 검사는 브라우저 입력에 합성 화면을 사용했습니다. |
| 화면 저장 회귀 | 구현 당시 `web/`에서 `THINK_MEET_NOTES_TEST=1 npm run test:e2e -- e2e/class-notes.spec.ts` 통과. PDF와 판서 합성, 쪽 변경 시 기존 미리보기 만료, 저장 파일의 열람 범위를 확인했습니다. |
| Android 빌드 | `mobile/`에서 `./gradlew :composeApp:testDebugUnitTest :composeApp:assembleDebug :composeApp:assembleDebugAndroidTest` 통과. 단위 테스트 40개 통과. |
| Android 실행 | 기존 API 35 에뮬레이터의 휴대폰과 태블릿에서 `NativeSmokeTest#teacherSharesTextbookAndAnnotates`가 각 1건 통과했습니다. 두 열의 미리보기, 공유 3쪽, 패널 위치와 닫힘 여부, PDF 아래 판서 도구를 확인했습니다. 새 펜 획의 서버 저장과 화면 표시, 실행 취소·다시 실행을 두 크기에서 확인했습니다. |
| iOS 빌드 | `mobile/`에서 `./gradlew :composeApp:linkDebugFrameworkIosSimulatorArm64`와 ThinkMeet ARM64 시뮬레이터용 `xcodebuild` 통과. |
| iOS 실행 | iOS 26.5의 iPhone 17 Pro와 iPad Pro 13형(M5)에서 선생님 로그인과 수업 입장을 확인했습니다. 두 기기에서 두 열의 PDF 미리보기, 공유 첫 3쪽과 학생 브라우저의 펜 획 수신, 실행 취소·다시 실행을 확인했습니다. iPhone은 `TextbookSmoke.testSelectShareAndAnnotate` 1건 통과. 공유 후 패널이 닫히고 도구가 PDF 아래에서 줄을 바꿨습니다. iPad 수동 검사에서는 참가자 영상 아래에 패널이 유지되고, 지우개와 4쪽에서 3쪽으로 돌아왔을 때의 판서 복원도 확인했습니다. |

Android는 앱 시작 시 압축 DEX를 메모리에서 해제하다 응답 제한 시간을 넘겼습니다. 디버그 앱과 계측 APK의 DEX를 압축하지 않도록 변경했고, 계측 테스트는 Compose의 목록 스크롤 동작으로 쪽을 선택합니다. iOS는 시뮬레이터 Keychain의 `errSecMissingEntitlement (-34018)`로 로그인 세션을 저장하지 못했습니다. 해당 오류를 받는 디버그 시뮬레이터에서만 세션을 앱 메모리에 유지합니다. 이 환경에서는 앱을 완전히 종료하면 다시 로그인해야 합니다.

기능 상태를 `ready`로 갱신한 뒤 공통 생성, 변경 파일을 지정한 `npm run shared:check`, `npm run verify`, Android 단위 테스트와 디버그 APK 빌드, iOS 시뮬레이터 앱 빌드를 통과했습니다. 네이티브 실행 검증은 에뮬레이터와 시뮬레이터에서 진행했습니다.

## 웹 화면

| 크기 | 쪽 선택 | 하단 판서 |
|---|---|---|
| Chromium 390 × 844 | [겹침 패널](classroom-textbook-picker/web-phone-picker.png) | [3쪽 화면](classroom-textbook-picker/web-phone-annotation.png) |
| Chromium 1024 × 900 | [참가자와 우측 패널](classroom-textbook-picker/web-tablet-picker.png) | [3쪽 화면](classroom-textbook-picker/web-tablet-annotation.png) |

## Android 화면

| 크기 | 실제 실행 기록 |
|---|---|
| 1080 × 2400, 420dpi | [교재 패널](classroom-textbook-picker/android-phone-picker.png), [3쪽과 판서 시작](classroom-textbook-picker/android-phone-page-three.png), [펜 획과 하단 판서](classroom-textbook-picker/android-phone-annotation.png) |
| 1600 × 1200, 250dpi | [오른쪽 교재 패널](classroom-textbook-picker/android-tablet-picker.png), [펜 획과 하단 판서](classroom-textbook-picker/android-tablet-annotation.png) |

## iOS 화면

| 크기 | 실제 실행 기록 |
|---|---|
| iPhone 17 Pro | [겹침 패널](classroom-textbook-picker/ios-phone-picker.png), [펜 획과 하단 판서](classroom-textbook-picker/ios-phone-annotation.png) |
| iPad Pro 13형(M5) | [오른쪽 교재 패널](classroom-textbook-picker/ios-tablet-picker.png), [펜 획과 하단 판서](classroom-textbook-picker/ios-tablet-annotation.png) |
