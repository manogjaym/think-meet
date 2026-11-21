# 수업 모드 검증 기록

2026-11-21, 기능 개발 중인 작업 트리의 검증 전용 Docker Compose 환경에서 계약 revision 10과 새 DB 마이그레이션 1건을 적용했습니다.

| 대상 | 실행 결과 |
|---|---|
| 공통 계약·서버·웹 | 저장소 루트에서 `npm run shared:check`와 `npm run verify` 통과. 공통 12개, 서버 22개, 웹 16개 테스트 및 서버·웹 타입 검사와 웹 빌드 통과 |
| 변경 기록 | 수업 모드 변경 기록을 대상으로 `npm run shared:check -- --changed-files <파일 목록>` 통과. 작업 트리 전체 목록은 기존 `classroom-notes-camera` 변경 기록의 서버 범위 검사에서 실패 |
| Chromium | `web/`에서 `SCREEN_SHARE_TEST_CAPTURE=synthetic npm run test:e2e -- e2e/devices.spec.ts e2e/prejoin.spec.ts` 3개 통과. 교사·학생 동시 입장, 공용 화면 공유와 실제 LiveKit 영상 프레임, 전환 취소·확인과 캡처 정리, 교사 재입장 후 모드 복원을 확인. OS 화면 선택 입력에는 합성 영상을 사용 |
| Android 빌드 | `mobile/`에서 `./gradlew :composeApp:testDebugUnitTest :composeApp:assembleDebug :composeApp:assembleDebugAndroidTest` 통과. 단위 테스트 40개 통과 |
| Android 실행 | API 35 에뮬레이터에서 교사 로그인, 수업 시작 전 공유 숨김, 기본 수업방 모드, 태블릿 크기 재입장 후 상태 복원과 모드 전환을 확인. 학생 화면에서 교사 버튼 숨김과 iPad에서 온 요청의 승인·거절 창, 거절과 모드 전환 후 요청 정리를 확인 |
| iOS 빌드 | `mobile/`에서 `./gradlew :composeApp:linkDebugFrameworkIosSimulatorArm64`와 `xcodebuild`의 ThinkMeet iOS Simulator 빌드 통과 |
| iOS 실행 | iPad 시뮬레이터에서 같은 수업에 교사로 재입장해 수업방 모드와 누적 시간 복원, 미러링 모드의 참석자 패널, 학생 선택·승인 대기·학생 거절, 전환 확인 뒤 대기 요청 정리를 확인. iPhone 시뮬레이터에서는 학생 로그인과 입장 전 장치 점검까지 확인 |

## 화면 기록

Chromium에서 같은 교사·학생과 수업 데이터로 수업방 모드에 있는 화면을 확인했습니다.

| 화면 크기 | 교사 | 학생 |
|---|---|---|
| 390 × 844 | [휴대폰](classroom-lesson-modes/lesson-modes-teacher-phone.png) | [휴대폰](classroom-lesson-modes/lesson-modes-student-phone.png) |
| 1024 × 820 | [태블릿](classroom-lesson-modes/lesson-modes-teacher-tablet.png) | [태블릿](classroom-lesson-modes/lesson-modes-student-tablet.png) |

웹·Android·iPad에서 같은 교사와 수업의 수업방 모드를 확인했습니다. 촬영 시점에 따라 통화 연결, 카메라와 참가자 상태가 달랐습니다. Android 휴대폰은 1080 × 2400, 태블릿 크기는 1600 × 1200으로 확인했습니다.

- 웹 [휴대폰](classroom-lesson-modes/web-teacher-phone-native-fixture.png), [태블릿](classroom-lesson-modes/web-teacher-tablet-native-fixture.png)
- Android [시작 전](classroom-lesson-modes/android-teacher-phone-preparing.png), [휴대폰 수업방](classroom-lesson-modes/android-teacher-phone-classroom.png), [태블릿 수업방](classroom-lesson-modes/android-teacher-tablet-classroom.png), [태블릿 미러링](classroom-lesson-modes/android-teacher-tablet-mirroring.png)
- Android 학생 [미팅](classroom-lesson-modes/android-student-phone-meeting.png), [미러링 승인 창](classroom-lesson-modes/android-student-phone-mirroring-consent.png)
- iPad 1668 × 2420 [수업방](classroom-lesson-modes/ios-teacher-tablet-classroom.png), [미러링](classroom-lesson-modes/ios-teacher-tablet-mirroring.png), [승인 대기](classroom-lesson-modes/ios-teacher-tablet-mirroring-pending.png)

iPhone 미팅 화면, 실제 iOS 기기의 ReplayKit 송출, 원격 CI는 미검증입니다. Android의 실제 미러링 송출 검증은 다른 앱 위에 표시 권한 자동 부여가 자동 승인 검토에서 거부되어 진행하지 못했습니다. 기능 상태는 `in-progress`입니다.

## 수업 모드 분리 브랜치 검증

다른 미커밋 기능을 제외한 브랜치에서 `npm run verify`, 변경 파일 목록을 사용한 `npm run shared:check`, Android 단위 테스트·APK·테스트 APK, iOS 시뮬레이터 프레임워크 빌드를 다시 통과했습니다.

현재 LAN 주소의 검증 전용 서버를 사용해 `web/`에서 `SCREEN_SHARE_TEST_CAPTURE=synthetic npm run test:e2e -- e2e/devices.spec.ts` 1건을 다시 통과했습니다.
