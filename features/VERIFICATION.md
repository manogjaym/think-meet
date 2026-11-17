# 공통 기능 개발 기반 검증

## Android 원격 화면 안내 2026-11-17

사용자가 Android 학생 우선 범위를 선택한 뒤 `meeting.remote-assistance`를 구현했습니다. 선생님 요청·학생 승인·전체 화면 캡처·PiP 전환·외부 앱 포인터·종료 정리를 연결했습니다. 선생님 화면은 웹·Android·iOS에 구현하고, iOS/웹 학생 수신은 제외합니다. 계약 revision은 4이며 신규 기능은 **`in-progress`·기본 OFF**입니다.

같은 날 사용자의 에뮬레이터 캡처 요청으로 위 두 Android 검사 클래스를 다시 실행했습니다. **4개 통과, 실패/생략 0개, 2분 11초**이며 [이번 실행 로그](evidence/remote-assistance/emulator-recheck-2026-11-17/run.log)·[결과 XML](evidence/remote-assistance/emulator-recheck-2026-11-17/results.xml)을 보관했습니다. 새 [학생 승인 화면](evidence/remote-assistance/emulator-recheck-2026-11-17/student-consent.png)·[다른 앱 위 포인터와 PiP](evidence/remote-assistance/emulator-recheck-2026-11-17/other-app-pointer-pip.png)·[포인터 자동 만료 후 아래 앱 터치 성공](evidence/remote-assistance/emulator-recheck-2026-11-17/other-app-pointer-expired.png)을 직접 확인했습니다. 임시 오버레이 권한은 `default`로 복원됐습니다. 아래에 설명한 테스트 객체·별도 UID 앱을 사용했으며 실제 회의/MediaProjection 전체 흐름 검증을 추가한 것은 아닙니다.

| 대상 | 이번 실행 결과 |
|---|---|
| 공통 계약·기능 | `npm run shared:check`와 이번 변경 파일 목록 검사 통과. 배포 호환성 기준 보존 |
| 서버 | 신규 승인/포인터 검사 10개 포함 관련 검사 50개 통과. 기본 OFF·권한·Android/계약 지원·거절/만료·공유 연결·화면 버전·한 학생 전달·연결 교체·종료/재시작/비동기 경합 정리 확인 |
| 웹 | 핵심/기능 지원 8개, Playwright 화면 9개 통과. 요청·취소·승인 상태·좌표·90/180도 변경·연결/기능 OFF·웹 학생 미지원 확인 |
| 통합 검사 | `npm run verify` 통과: 계약/디자인 12개, 서버 필수 검사 21개, 웹 8개, 서버/웹 TypeScript와 웹 production 빌드 |
| KMP 공통 | 단위 검사 26개, 실패/생략 0. 포인터 권한/좌표 4개와 실제 승인 순서·지연 응답 중 취소·늦은 OS 권한 응답 회귀 3개 포함 |
| Android 빌드 | debug APK와 instrumentation APK 빌드 성공 |
| Android 실행 | 기존 `emulator-5554`, Android 15(API 35)에서 승인 UI 2개 + 실제 OS 오버레이/PiP/터치/정리 2개, 총 4개 통과. 실패/생략 0 |
| iOS | 최종 Simulator arm64 프레임워크 링크 및 서명 없는 Swift 호스트 빌드 성공, 공통 폰트·리소스 연결 확인. 실제 iOS 실행은 미실시 |

웹 증거는 가상 선생님·Android 학생의 같은 세션/portrait 영상과 `(0.5, 0.52)` 위치를 사용하는 실제 React 컴포넌트 테스트입니다. 휴대폰 390×844, 태블릿 1024×1366, 데스크톱 1440×1000 CSS px로 캡처했습니다. [휴대폰 요청](evidence/remote-assistance/web-phone-teacher-request.png)·[활성](evidence/remote-assistance/web-phone-teacher-active.png), [태블릿 요청](evidence/remote-assistance/web-tablet-teacher-request.png)·[활성](evidence/remote-assistance/web-tablet-teacher-active.png), [데스크톱 요청](evidence/remote-assistance/web-desktop-teacher-request.png)·[활성](evidence/remote-assistance/web-desktop-teacher-active.png)을 확인했습니다. 로컬 Vite 준비 전에 실패한 요청 검사 1개는 준비 후 재실행하여 통과했습니다. 제품 정책을 바꾸지 않고 테스트 브라우저에서만 ready 응답을 사용했습니다.

Android 승인 UI는 실제 Compose `RemoteAssistanceControls`와 테스트 콜백을 사용합니다. [승인 전](evidence/remote-assistance/android-student-consent.png)·[준비 중](evidence/remote-assistance/android-student-preparing.png)·[거절](evidence/remote-assistance/android-student-refused.png)·[미지원](evidence/remote-assistance/android-student-unsupported.png)을 확인했습니다. UI 테스트 자체는 계정·통신·미디어·운영체제 캡처 권한을 생성하지 않습니다.

Android OS 검사는 **다른 UID로 실행되는 별도 테스트 앱** 위에 실제 `TYPE_APPLICATION_OVERLAY`를 띄웠습니다. [외부 앱 포인터와 실제 PiP](evidence/remote-assistance/android-other-app-pointer-pip.png), [자동 만료](evidence/remote-assistance/android-other-app-pointer-expired.png), [캡처 중지 정리](evidence/remote-assistance/android-capture-stopped.png)를 확인했습니다. 포인터 아래 버튼의 터치 횟수가 0→1로 바뀌는 것과 중지 후 500ms 안의 제거를 검사해 1.5초 TTL과 구분했습니다. 캡처 geometry는 테스트 객체에 주입했으므로 실제 MediaProjection/LiveKit 전체 흐름 통과로 해석하지 않습니다.

처음 선택한 Android 설정 앱은 OS 보호 정책으로 포인터를 숨겼습니다. 보호 정책을 바꾸지 않고 비보호 테스트 앱으로 표시·터치 검사를 수행했습니다. 이는 설정·결제 등 보호 앱 위 표시를 보장할 수 없다는 제한입니다. 테스트 앱은 Android SDK만 사용하는 Java Activity로 독립 실행 의존성을 해결했습니다.

Android 해상도 1080×2400 px·밀도 420 dpi를 유지하고 안전 영역을 적용했습니다. 테스트가 임시 변경한 `SYSTEM_ALERT_WINDOW` AppOp는 `default`로 복원된 것을 읽기 전용으로 확인했습니다. 회전·해상도·다른 권한 설정은 바꾸지 않았고 기존 계정·수업 데이터도 사용하거나 수정하지 않았습니다.

재실행 명령입니다. iOS 호스트 빌드는 [iOS 안내](../mobile/iosApp/README.md#빌드와-공통-리소스)를 따릅니다.

```sh
# 저장소 루트
npm run shared:check
npm run verify
# web/ — 실행 중인 로컬 개발 서버가 없다면 별도 터미널에서 시작
npm run dev -- --host 127.0.0.1 --port 8443
ASSISTANCE_BASE_URL=http://127.0.0.1:8443 npx playwright test e2e/remote-assistance.spec.ts
# mobile/ — shared:check 통과 후
./gradlew :composeApp:testDebugUnitTest :composeApp:assembleDebug \
  :composeApp:assembleDebugAndroidTest :composeApp:linkDebugFrameworkIosSimulatorArm64
./gradlew :composeApp:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.woongjin.thinkmeet.RemoteAssistanceOverlayTest,com.woongjin.thinkmeet.RemoteAssistanceConsentTest
```

남은 검증은 실제 계정으로 교사 요청→학생 OS 동의→실제 전체 화면 캡처/LiveKit→자동 PiP→교사 클릭→학생 표시를 잇는 교차 단말 흐름, 실제 앱별 캡처/오버레이 정책, 휴대폰/태블릿·회전·글자 확대의 동일 화면 비교, iOS 선생님 실제 실행과 원격 CI입니다. 이 항목을 통과한 것으로 표시하지 않고 `ready`나 운영 활성화를 하지 않았습니다. 실행 중인 서비스를 재시작·재배포하지 않았습니다. [기능 명세](meeting-laser-pointer.md)를 따릅니다.

## 원격 화면 안내 요구 정정 2026-11-17

학생이 다른 앱을 보고 있을 때도 원래 화면 위에 점이 표시되어야 한다는 요구에 맞지 않아, 이전 앱 내부 포인터 구현을 제거했습니다. 서버·웹·Android/iOS 포인터 코드, 미배포 기능 등록과 전용 계약·검사를 제거하고 기존 판서·화면 공유·PiP는 보존했습니다. 계약 revision은 3이며 배포 호환성 기준은 변경하지 않았습니다.

Android는 별도 오버레이 권한으로 구현할 수 있으나 iOS 일반 앱의 타 앱 위 임의 좌표 표시 공개 API 경로를 확인하지 못했습니다. 이 제거 작업 시점에는 새 구현을 시작하지 않았으며, 이후 사용자의 Android 우선 선택에 따른 구현·검사는 위 항목에 기록했습니다. [요청 흐름·플랫폼 제약](meeting-laser-pointer.md)을 확인합니다.

제거 후 이번에 실행한 검사는 다음과 같습니다. 이전 날짜의 결과를 재사용하지 않았습니다.

| 대상 | 2026-11-17 실행 결과 |
|---|---|
| 공통 계약·기능 | `npm run shared:check` 통과. 호환성 기준 보존, 미배포 포인터 등록·명령 제거 확인 |
| 서버·웹 | `npm run verify` 통과. 계약/디자인 12개·서버 정책 11개·웹 기능 지원 4개, TypeScript와 웹 production 빌드 통과 |
| Android/KMP | `mobile/`에서 `./gradlew :composeApp:testDebugUnitTest :composeApp:assembleDebug :composeApp:linkDebugFrameworkIosSimulatorArm64` 성공. 단위 검사 19개, 실패/생략 0개 |
| iOS | Simulator arm64 공통 프레임워크 링크 성공. Swift 호스트 재빌드·실제 iOS 실행은 이번 제거 검사에서 반복하지 않음 |
| 실행·화면 | 제거 작업에 새 UI가 없어 Android 에뮬레이터·웹 크기별 화면 비교·원격 CI는 이 검사에서 실행하지 않음. 이후 오버레이 구현·실행 결과는 위 항목에 별도 기록 |

## 폐기한 앱 내부 포인터 2026-11-16

**다음 내용은 2026-11-16에 수행한 이전 구현의 과거 기록입니다.** 해당 기능은 2026-11-17에 제거했으며, 아래 명령·테스트·화면을 현재 존재하거나 새 요구를 충족한 결과로 해석하지 않습니다.

`meeting.laser-pointer`의 서버·React 웹·Android/iOS 공통 Compose 구현을 추가했습니다. 계약 revision은 2이며 `pointer.move`는 DB·스냅샷·판서 이력에 저장하지 않습니다. 기존 baseline과 배포 호환성 기준은 유지했습니다.

| 대상 | 이번 실행 결과 |
|---|---|
| 계약·기능·디자인 | `npm run shared:check` 통과. 계약/디자인 테스트 12개 통과 |
| 서버 | 포인터 7개 + 기존 기능 정책 11개, 총 18개 통과. 선생님 권한, 현재 공유/페이지, 좌표, 기본 OFF, 만료 세션, 구 클라이언트, 비동기 이동/해제 순서 경합 확인 |
| 웹 | 핵심/기능 지원 7개, Playwright 6개 통과. 선생님 토글·누르기/드래그/해제·판서 분리·학생 수신·TTL·공유/연결/기능 OFF와 3개 화면 크기 확인 |
| 서버·웹 빌드 | `npm run verify`의 서버/웹 TypeScript 검사와 Vite production 빌드 통과 |
| KMP·Android 빌드 | `:composeApp:testDebugUnitTest` 23개(포인터 4개 포함), `assembleDebug`, `assembleDebugAndroidTest` 통과 |
| iOS 공통 코드 | `linkDebugFrameworkIosSimulatorArm64` 통과. 실제 iOS 실행 결과와 구분 |
| Android 실행 | 기존 `emulator-5554`의 Android 15(API 35)에서 포인터 화면 검사 2개 통과, 실패/생략 0. 설정·수업 데이터 변경 없음 |
| iOS 호스트 | `mobile/iosApp/README.md`의 서명 없는 Simulator arm64 `xcodebuild` 통과. 최종 KMP 프레임워크와 Pretendard 4개·라이선스 연결 확인. 실제 iOS 실행은 미실시 |

웹 화면 증거는 동일한 가상 선생님·학생, 학생 공유 화면, 정규화 좌표 `(0.5, 0.56)`로 만들었습니다. 휴대폰 390×844, 태블릿 1024×1366, 데스크톱 1440×1000 CSS px이며 Chromium 기본 글자 크기를 사용했습니다. [휴대폰 선생님](evidence/laser-pointer/web-phone-teacher.png)·[학생](evidence/laser-pointer/web-phone-student.png), [태블릿 선생님](evidence/laser-pointer/web-tablet-teacher.png)·[학생](evidence/laser-pointer/web-tablet-student.png), [데스크톱 선생님](evidence/laser-pointer/web-desktop-teacher.png)·[학생](evidence/laser-pointer/web-desktop-student.png)을 확인했습니다. 안내와 도구의 겹침을 수정하고 다시 캡처했습니다.

웹 검사는 실제 `SharedStage`를 렌더하는 테스트 화면이며, 가상 영상 트랙·테스트 상태를 사용합니다. 테스트 브라우저에서만 기능 정책 응답을 준비 상태로 바꿨고 제품의 `in-progress` 정책은 유지했습니다. `useMeeting`의 실제 회의 연결·단말 간 송수신·실제 ReplayKit 영상은 검증하지 않았습니다.

Android도 실제 `SharedStage`를 쓰되 테스트 전용 객체의 기능 지원·연결·수신 상태를 주입했습니다. 네이티브 영상 대신 빈 9:16 표면에 `(0.25, 0.75)` 점을 표시하고 콘텐츠 좌표의 픽셀 색을 확인했습니다. 실제 화면은 1080×2400 px, 420 dpi, 글자 확대 1.0이며 기존 안전 영역을 적용했습니다. [선생님 터치](evidence/laser-pointer/android-existing-emulator-teacher-down.png)·[학생 수신](evidence/laser-pointer/android-existing-emulator-student-received.png), [선생님 OFF](evidence/laser-pointer/android-existing-emulator-teacher-disabled.png)·[학생 OFF](evidence/laser-pointer/android-existing-emulator-student-disabled.png)를 확인했습니다. 웹과 계정·콘텐츠·좌표가 같은 비교가 아니므로 플랫폼 간 화면 일치 완료로 처리하지 않습니다. Android 태블릿·회전·글자 확대 비교도 남아 있습니다.

변경 파일 목록 검사 `npm run shared:check -- --changed-files /private/tmp/think-meet-laser-changed.txt`도 통과했습니다. 이 목록은 이번 포인터 원본·생성물·구현·검사·변경 기록만 포함하며, 작업 시작 전부터 있던 다른 수정은 그대로 유지했습니다.

재실행은 저장소 루트에서 `npm run shared:check`, `npm run verify` 순서로 진행합니다. 웹 화면 검사는 로컬 Vite가 필요합니다.

```sh
# web/ — 실행 중인 개발 서버가 없을 때만 시작
npm run dev -- --host 127.0.0.1 --port 8443
# web/ — 별도 터미널
POINTER_BASE_URL=http://127.0.0.1:8443 npx playwright test e2e/laser-pointer.spec.ts

# mobile/ — shared:check 통과 후
./gradlew :composeApp:testDebugUnitTest :composeApp:assembleDebug \
  :composeApp:assembleDebugAndroidTest :composeApp:linkDebugFrameworkIosSimulatorArm64
./gradlew :composeApp:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.woongjin.thinkmeet.LaserPointerFixtureTest \
  -Pandroid.testInstrumentationRunnerArguments.captureLabel=existing-emulator
```

다음 검증은 남아 있습니다. 실제 계정·수업에서 웹↔Android↔iOS 포인터 송수신, PDF 페이지/확대·영상 콘텐츠 정합성, 각 플랫폼 휴대폰/태블릿·회전·글자 확대 비교, 실제 iPhone/iPad 실행과 원격 CI입니다. 모든 완료 조건을 충족하지 않았으므로 카탈로그는 **`in-progress`·기본 OFF**로 유지하며 운영 서버를 재시작하거나 기능을 켜지 않았습니다. 다른 앱 위 오버레이·원격 터치·시스템 PiP 포인터는 지원 범위 밖입니다. 자세한 범위는 [기능 명세](meeting-laser-pointer.md)를 따릅니다.

---

검증일: 2026-11-14. 기존 웹·앱 디자인과 실행 중인 서버 데이터는 유지했습니다.

| 대상 | 실제 결과 | 기록 |
|---|---|---|
| 공통 명세/기능 상태 | 생성물 7개 read-only 검사, 구버전 호환, REST/Socket handler coverage, catalog 및 변경 기록 검사 통과 | `npm run shared:check`; 대표 변경 파일 목록을 사용한 change-record gate도 통과 |
| 생성기·정책 핵심 검사 | 계약 7개 + 디자인 5개, 서버 availability/권한/cleanup 11개, 웹 capability 4개 통과 | [통합 로그](../mobile/artifacts/feature-foundation-verify.log) |
| 웹·서버 | TypeScript 검사와 웹 production 빌드 통과 | 같은 통합 로그 |
| 웹 Docker | 공통 contracts/features/design와 필요한 native source를 포함한 root build context로 build stage 성공 | [Docker 로그](../mobile/artifacts/feature-foundation-docker.log) |
| KMP 공통 로직 | Android JVM 단위테스트 16개, 실패/오류/skip 0 | [모바일 검증](../mobile/artifacts/contracts-mobile-build-verification.json) |
| Android | 최신 debug APK 및 instrumentation APK 빌드 성공 | [빌드 로그](../mobile/artifacts/contracts-mobile-final-build.log) |
| 기존 Android 에뮬레이터 | 최종 APK로 읽기 전용 smoke 1개 통과: teacher1 세션, 생성 모델로 수업 16개 decode, 구 서버 baseline 협상, 미등록 기능 차단 | [실행 로그](../mobile/artifacts/feature-foundation-emulator.log) |
| iOS | Simulator arm64 KMP framework 및 Swift host 앱 빌드 성공, 폰트/라이선스·연결 바이너리 확인 | [iOS 빌드 로그](../mobile/artifacts/contracts-ios-build.log), [모바일 검증](../mobile/artifacts/contracts-mobile-build-verification.json) |

추가 확인 사항:

- 누락된 inbound Socket handler와 잘못된 query schema 참조를 검사합니다.
- 웹 visible 탭의 120초 갱신과 강제 갱신 중 유효 응답 보존을 확인했습니다. 핵심 검사·타입 검사·Vite 빌드를 통과했습니다.
- 네이티브는 응답에서 키가 빠지거나 캐시가 만료·일시 장애가 생겨도 이전의 명시적 false를 유지합니다. 해당 키의 true 또는 구 서버 404에서만 해제하는 동작을 핵심 테스트로 확인했습니다.
- Docker는 공통 폴더를 포함한 build context를 확인했습니다. 실행 중인 서비스 이미지는 교체하지 않았습니다.

## Android 실행 방법

기존 `emulator-5554`에서 검증했습니다. 앱 주소 `192.168.0.64`가 개발 PC 주소와 달라 최초 연결은 실패했습니다.

최종 검사는 instrumentation의 TCP 주소만 `10.0.2.2`로 바꿔 통과했습니다. 저장된 로그인·앱 서버 설정·TLS 검증과 일반 화면 통신 경로는 유지했습니다. 이 모드에서는 화면 표시 검사를 생략했습니다. 에뮬레이터 해상도·밀도·서버 데이터도 변경하지 않았습니다.

기존 teacher1 세션을 사용하는 읽기 전용 재실행 명령입니다.

```sh
adb -s emulator-5554 shell am instrument -w -r \
  -e class com.woongjin.thinkmeet.ContractCompatibilitySmokeTest \
  -e contractRouteAddress 10.0.2.2 \
  com.woongjin.thinkmeet.test/androidx.test.runner.AndroidJUnitRunner
```

## 검증 범위

- **기능 정책:** 새 기능의 준비 상태·플랫폼·양쪽 revision·서버 설정을 검사했습니다. 명시적 false, 캐시 만료·일시 장애, 취소, 구 서버 404, cleanup 권한도 핵심 테스트로 확인했습니다.
- **서버:** 실행 중인 Docker API는 재배포하지 않았습니다. 신규 정책은 로컬 테스트·빌드, 기존 서버 호환성은 에뮬레이터로 확인했습니다.
- **화면·미디어:** 디자인 변경이 아니므로 영상·PDF·PiP 전체 흐름과 크기별 화면 비교는 반복하지 않았습니다. 기존 기록은 [design/VERIFICATION.md](../design/VERIFICATION.md)에 있습니다.
- **iOS:** 빌드·리소스 연결만 확인했습니다. 기기·시뮬레이터 실행은 하지 않았습니다.
- **원격 CI:** 루트가 Git 저장소가 아니므로 workflow 실행·branch protection 설정은 하지 않았습니다. `.github/workflows/cross-platform.yml`과 PR gate는 공통 폴더가 같은 checkout에 포함된 저장소에 연결해야 합니다.
- **기존 경고:** Vite config·dynamic import·chunk 크기 경고는 빌드를 막지 않았습니다. 번들 구조는 변경하지 않았습니다.
