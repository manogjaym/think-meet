# 앱 검증 기록

실제 실행 결과를 확인한 뒤 갱신합니다. 구현 완료, 빌드 통과, 기기 실행은 구분해서 기록합니다.

## APK 빌드 스크립트 · 2026-11-15 (Asia/Seoul)

저장소 루트의 `npm run apk`로 `shared:check`와 `:composeApp:assembleDebug`가 순서대로 통과했고, `composeApp/build/outputs/apk/debug/composeApp-debug.apk` 생성과 절대 경로 출력을 확인했습니다. `sh -n mobile/scripts/build-apk.sh`도 통과했습니다. 기존 환경변수·`mobile/.env`를 유지하며 기기 설치·실행은 하지 않았습니다. Android 개발용 빌드 스크립트 추가이므로 서버·웹·iOS 제품 코드와 통신 계약은 변경하지 않았습니다.

## 빌드 환경변수 서버 주소 · 2026-11-15 (Asia/Seoul)

Android/iOS의 주소 입력 UI를 제거하고 `mobile/.env` 또는 빌드 환경변수의 `THINK_MEET_SERVER_ORIGIN`을 사용합니다. 앱·참여 링크·Android 계측 검사가 같은 생성 주소를 사용합니다. 기존 저장 주소는 읽지 않습니다. 서버·웹 동작과 계약은 변경하지 않았습니다.

| 항목 | 이번 실행 결과 |
|---|---|
| 공통 검사·변경 기록 | `npm run shared:check` 및 `--changed-files /tmp/think-meet-mobile-server-origin-files.txt` 통과. 이번 앱 변경만 검사 |
| 공통·웹·서버 검증 | `npm run verify` 통과 · 정책·디자인 테스트 27개, 웹·서버 타입 검사, 웹 빌드 |
| Android | APK·기존 계측 테스트 소스 컴파일 통과, 핵심 테스트 19개 통과(참여 링크 3개 포함) |
| 주소 설정 | `.env`, 따옴표·포트, 환경변수 우선순위·변경 반영, 누락·잘못된 HTTPS origin 거부 등 11개 사례 통과. 원래 `.env`와 생성 주소 복원 |
| iOS | Kotlin arm64 시뮬레이터 프레임워크와 Swift 앱·Broadcast 확장 빌드 통과 · 서명 없음 |
| Android 실행 | 기존 `emulator-5554` API 35, 1080×2400 / 420dpi에 업데이트 설치·실행 성공. `am start -W`: `Status: ok`, `COLD`, `TotalTime: 21041ms` |
| 실제 화면 | UI 계층 조회가 90초 이상 응답하지 않고 캡처도 완료되지 않아 조회 프로세스만 종료. 주소 설정 제거의 실제 화면 확인과 휴대폰·태블릿 비교는 미완료 |
| 미실행 | iOS 시뮬레이터·실기기 실행, 원격 CI, 실제 서버 로그인·수업 회귀. 이번 변경은 서버·미디어 동작을 바꾸지 않음 |

네이티브 검증은 `mobile/`에서 `JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home`, `ANDROID_HOME=/Users/pang/Library/Android/sdk`로 실행했습니다. 빌드 전 공통 생성물 검사를 통과했습니다.

```sh
./gradlew :composeApp:generateServerConfig :composeApp:testDebugUnitTest \
  :composeApp:assembleDebug :composeApp:compileDebugAndroidTestKotlin \
  :composeApp:linkDebugFrameworkIosSimulatorArm64 --console=plain
xcodebuild -project iosApp/ThinkMeet.xcodeproj -scheme ThinkMeet \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' ARCHS=arm64 \
  SKIP_KOTLIN_BUILD=YES CODE_SIGNING_ALLOWED=NO \
  KMP_FRAMEWORK_DIR='$(SRCROOT)/../composeApp/build/bin/iosSimulatorArm64/debugFramework' \
  -derivedDataPath iosApp/build build
```

로컬 증거: `artifacts/server-origin/config-checks.log`, `artifacts/server-origin/ios-build.log`, `composeApp/build/test-results/testDebugUnitTest/TEST-*.xml`. 에뮬레이터 설정·기존 계정·서버 데이터는 변경하지 않았습니다. 기기 임시 파일 `/data/local/tmp/thinkmeet-server-origin.xml`의 삭제도 5초 안에 응답하지 않아 생성·잔존 여부는 미확인입니다. 웹·Compose의 공통 UI 계약은 `design/system.json`에 기록했으며 새로운 기능의 ready 검증으로 집계하지 않습니다.

### 서버 CA 불일치 후속 검증 · 2026-11-15

`.env`와 생성 코드에는 `https://115.68.2.13`이 반영되어 있었으나 서버의 현재 CA와 앱의 기존 번들 CA가 달랐습니다. 기존 CA로 TLS 검증이 실패했고, 검증된 SSH 호스트 `aimos`를 통해 서버 컨테이너의 공개 루트 CA만 읽어 확인했습니다. 서버 설정·비밀키는 변경하지 않았습니다.

| 항목 | 이번 실행 결과 |
|---|---|
| 서버 CA 신뢰 확인 | 공개 루트 DER SHA-256 `89:05:05:54:1F:D8:D9:5F:D6:0D:85:DD:D7:FF:20:57:4D:29:9D:95:B3:75:52:4B:BF:FC:04:CA:1C:91:82:A5`. 이 CA로 curl `/api/v1/health`: HTTP 200, TLS verify 0 |
| Android 구성 | `THINK_MEET_SERVER_CA_FILE=certs/server-root.crt`로 공개 CA 선택. 앱·검사 APK 빌드 통과, APK에 정확한 CA 포함 |
| 릴리스 범위 확인 | `:composeApp:mergeReleaseResources` 통과. 디버그 CA 리소스 없음, `androidMain`의 시스템 CA 설정 사용. 릴리스 전체 빌드는 미실행 |
| 설정 경계 검사 | `.env` CA 선택, 빈 설정의 기본 CA, 누락 파일 거부, 개인키 포함 거부 4개 사례 통과. 현재 서버 CA로 생성물 복원 |
| 실제 Android HTTPS | `ServerConnectionSmokeTest` 1개 통과. `healthStatus=200`, `authStatus=401`, `serverOrigin=https://115.68.2.13`. 인증 정보 없이 정상 응답 확인 |
| 최종 Android 화면 | 동일 에뮬레이터 복구 후 앱 실행 `Status: ok`, `COLD`, 1,272ms. 로그인 화면 표시·서버 연결 오류 없음·로딩 종료를 UI XML과 실제 PNG로 확인. 계정 로그인과 태블릿 비교는 미실행 |
| 공통 검사 | `npm run verify` 통과. 계약·정책·디자인 검사와 웹·서버 타입 검사·웹 빌드 |
| 제외 범위 | Android 디버그 신뢰 설정 수정이므로 iOS 빌드·실행, 실기기·원격 CI·수업 회귀는 반복하지 않음. iOS는 해당 CA를 시스템에 설치해야 함 |

`mobile/`에서 JDK 17로 실제 연결 검사를 실행했습니다.

```sh
./gradlew :composeApp:connectedDebugAndroidTest :composeApp:mergeReleaseResources \
  -Pandroid.testInstrumentationRunnerArguments.class=com.woongjin.thinkmeet.ServerConnectionSmokeTest \
  --console=plain
```

첫 실행의 Android 검사 도구가 `uninstall_after_test: true`로 앱·검사 APK를 자동 제거했습니다. 앱을 다시 설치했으며 이전 로컬 로그인·기기 설정이 초기화됐을 수 있습니다. 같은 문제가 반복되지 않도록 `mobile/gradle.properties`에 `android.injected.androidTest.leaveApksInstalledAfterRun=true`를 설정했습니다. 후속 실행도 검사 1개·빌드가 통과했고 `healthStatus=200`, `authStatus=401`, UTP 로그에 대상 앱 제거가 없음을 확인했습니다.

이후 기기 패키지 조회가 시간 초과되어 기존 에뮬레이터를 복구했습니다. `adb reboot` 후에도 offline이 지속되어 동일 AVD를 정상 종료하고 원래 인자 `-avd TIF_Card_OCR_API35_12GB -port 5554 -no-snapshot-load`로 다시 열었습니다. 부팅 14.049초, `sys.boot_completed=1`, 앱 패키지 보존과 기존 1080×2400 / 420dpi를 확인했습니다. 데이터 초기화 옵션은 사용하지 않았으며 서버 계정·수업·파일은 변경하지 않았습니다. 로그는 `artifacts/server-origin/emulator-restart.log`입니다.

로컬 증거는 `artifacts/server-origin/ca-instrumentation.log`, `artifacts/server-origin/ca-instrumentation-retained.log`, `artifacts/server-origin/ca-config-checks.log`, `artifacts/server-origin/ca-fixed-login-final.png`, `artifacts/server-origin/ca-fixed-login.xml`, `composeApp/build/outputs/androidTest-results/connected/debug/`의 XML·`test-result.textproto`입니다. 후속 실행을 감싼 Python 도구는 검사 통과 뒤의 패키지 조회 시간 초과로 종료 코드 1을 반환했으며, 이것을 Gradle·HTTPS 검사 실패로 집계하지 않습니다. 이전 검증 결과와 구분하며 휴대폰·태블릿 전체 화면 비교나 iOS 실행 완료로 집계하지 않습니다.

## 기본 수업 흐름 · 2026-11-13 (Asia/Seoul)

| 항목 | 결과 |
|---|---|
| Android 컴파일·APK | 통과 |
| iOS Kotlin·Swift 앱·Broadcast 확장 | 통과 · Apple Silicon 시뮬레이터용, 서명 없는 빌드 |
| 핵심 상태·프로토콜 | 5개 통과 · 중복 입장 방지, 세션 만료, Socket.IO, snapshot 순서, 무제한 수업 |
| 서버 입장 인증 호환성 | 2개 통과 · 기존 query JWT·네이티브 Bearer JWT, 강퇴·교체·종료 검증 유지 |
| Android 휴대폰 수업 흐름 | 통과 · 로그인, Ktor WSS, 실제 LiveKit, 채팅 ACK, 손들기, 네이티브 PDF 1→2페이지, 터치 판서 서버 저장, 실행 취소·다시 실행 |
| 휴대폰 레이아웃 | 통과 · 기존 API 35 에뮬레이터, 1080×2400 / 420dpi |
| 태블릿 레이아웃·원격 영상 | 통과 · 같은 에뮬레이터, 1600×1000 / 160dpi, 대시보드·가로 영상 갤러리 |
| 실제 iPhone·iPad 권한·음질·화면 방송 | 미검증 · 별도 기기 확인 필요 |

### 실행 결과와 증거

- **휴대폰:** 실제 서버의 수업 1개에서 45.54초 실행, 실패·오류·건너뜀 없이 통과. 증거는 `artifacts/phone-check/`. 화면용 모형 데이터나 테스트 전용 입장 우회는 사용하지 않았습니다.
- **태블릿:** 영상·레이아웃 경로 37.992초, 테스트 1개 통과(`artifacts/tablet-instrumentation.log`). 브라우저 학생에서 앱 카메라의 720×1280 영상 5프레임 디코딩·6,685바이트 수신을 기록했습니다(`artifacts/rtc-video-evidence.json`). 앱에서도 원격 학생 영상이 보였습니다.
- 검증 후 에뮬레이터 해상도·밀도를 복원하고 앱은 설치된 상태로 남겼습니다. 검증 수업·PDF와 브라우저 학생을 정리했으며 기존 수업·파일은 변경하지 않았습니다.

### 실행 중 문제와 조치

| 문제 | 조치·기록 |
|---|---|
| 메모리·I/O 압박으로 초기 키보드 입력 ANR | Compose 의미 구조로 직접 입력하고 안정된 실행에서 재검증 |
| 초기 태블릿 실행기가 메모리 압박으로 시작 전 종료 | 앱·실행기를 사전 컴파일한 뒤 재설치 없이 실행 |
| 다른 앱의 ANR 대화상자가 일부 태블릿 캡처를 가림 | 원본 캡처의 기기 환경 한계로 기록 |
| LiveKit의 이전 RTC 광고 IP로 영상 연결 실패 | `scripts/compose.local.yml`의 `--rtc.node_ip.ipv4`에 현재 LAN 주소를 적용한 뒤 통과. 서버 `.env`·원본 LiveKit 설정 유지 |

미검증 범위는 실제 Bluetooth·스피커 음질, 각 OS의 전체 화면·소리 공유 권한 선택기, iOS 실기기 카메라·서명된 App Group 방송, 모든 MP4 코덱·대용량 파일 경계입니다. PDF·MP4 형식과 크기는 기존 서버가 최종 검증합니다.

## PiP 추가 검증 · 2026-11-14

| 항목 | 결과 |
|---|---|
| Android 앱·전용 테스트 APK | 빌드 통과 |
| PiP 영상 선택·미니 창 경계 계산 | 핵심 테스트 5개 통과, 실패·건너뜀 0 |
| 앱 내부 미니 영상 | 같은 Android 에뮬레이터에서 이동·닫기, 닫은 뒤 실제 수업 연결 유지 확인 |
| Android 시스템 PiP | OS pinned 창 진입·전체 화면 복귀, 채팅 초안·입장 기록 유지, 채팅 시트가 열린 상태의 Home 자동 진입 확인 |
| 교사의 시스템 PiP 닫기 | 교사만 오프라인·영상 트랙 해제, 수업은 LIVE 유지 |
| 카메라 해제 | 시스템 닫기 후 `Active Camera Clients: []`, 앱 카메라 DISCONNECT 로그 확인 |
| iOS 공통 코드·Swift 앱·Broadcast 확장 | 최종 빌드 통과, Swift 컴파일 진단 없음 |
| 실제 iPhone·iPad 시스템 PiP | 미검증 · 기기 실행 확인 필요 |

### Android 실행과 증거

기존 `emulator-5554`(API 35, 1080×2400 / 420dpi)에서 최종 OS 수명주기 테스트 **220.321초, 1개 통과**를 확인했습니다.

- 수평 툴바 스크롤과 OS 전환을 분리해 실제 플랫폼 컨트롤러로 진입했습니다. 복귀·닫기는 System UI의 `expand_button`·`dismiss`로 수행했습니다.
- PiP 전후 출결 구간이 같아 재입장이 없었습니다. 창을 닫은 뒤 교사만 퇴장하고 브라우저 학생·LIVE 수업은 유지됐습니다.
- 로그·상태 증거: `artifacts/pip-instrumentation.log`, `artifacts/pip-lifecycle/`, `artifacts/pip-after-system-close.json`
- 실제 원격 영상 표시: `artifacts/pip-check/02-native-pip-video.png`
- 미니 창 이동: `artifacts/pip-check/01-mini-dragged.png`

진입 직후 OS 캡처는 렌더러 첫 프레임보다 빠를 수 있어, 창 전환과 영상 표시의 증거를 구분했습니다.

초기 Compose 테스트는 미니 이동·닫기와 PiP 버튼 진입까지 확인했지만, 숨겨 보존한 화면의 의미 구조·테스트 프레임 시계 때문에 OS 단계에서 대기가 끝나지 않았습니다. 최종 검증은 실제 앱 프레임 시계를 쓰는 ActivityScenario·UIAutomator로 진행했습니다. 선택자·스크롤 보정 중 실패한 실행은 통과로 집계하지 않았고, 웹·서버 전체 테스트는 반복하지 않았습니다.

### iOS 빌드와 한계

시뮬레이터를 추가 부팅하지 않고 arm64 시뮬레이터용 전체 앱을 빌드했습니다. 최종 앱 재링크 시각이 현재 KMP 정적 라이브러리 입력보다 이후임을 확인했습니다(`artifacts/pip-ios-build.log`).

실기기의 PiP 허용 설정, 멀티태스킹 카메라, 잠금·전화 인터럽트, 실제 음질은 실행 검증하지 않았습니다.

### 검증 후 정리

전용 도구로 검증 수업·PDF를 정리하고 기존 수업·자료는 유지했습니다. 에뮬레이터 해상도·밀도는 바꾸지 않았으며 최종 Android 앱을 설치된 상태로 남겼습니다.
