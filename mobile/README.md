# Think Meet Mobile

Android·iPhone·iPad용 Kotlin Multiplatform 앱입니다. 웹과 같은 NestJS API·Socket.IO·LiveKit 서버와 데이터를 사용합니다. Android 최소 API는 26, iOS 최소 버전은 17.2입니다.

## 폴더와 화면 구성

| 경로 | 역할 |
|---|---|
| `composeApp/src/commonMain/` | Compose 화면, 수업 상태, REST, Socket.IO, 판서 |
| `composeApp/src/androidMain/` | LiveKit Android, 카메라, MediaProjection, PDF, Media3 |
| `composeApp/src/iosMain/` | ComposeUIViewController, Swift 브리지 |
| `iosApp/` | iPhone/iPad 호스트, LiveKit Swift, PDFKit, AVPlayer |
| `scripts/` | 로컬 서버 실행·검증 도구 |

화면 순서와 반응형 기준은 웹과 같습니다. 작은 화면은 하단 탐색·단일 열, 넓은 화면은 상단 탐색·다열을 사용합니다. 수업 보조 패널은 창 크기에 따라 옆 패널 또는 오버레이로 열립니다. 가로·세로 전환과 창 크기 변경에도 대응합니다.

## 주요 기능

- 교사·학생 로그인, 안전한 세션 복원·로그아웃
- 진행 중·예정·지난 수업 조회, 검색, 코드·링크 참여
- 수업 소유 교사의 예약·수정·취소, 공개·초대 전용 수업, 종료 시간 없는 수업
- 카메라 미리보기, 마이크·카메라 설정, 대기실 자동 입장
- LiveKit 영상·음성, 카메라 전환, 스피커, 화면 공유, 참가자 보기
- 시스템 화면 속 화면(PiP), 이동 가능한 앱 내부 미니 영상
- 채팅·손들기, 학생 초대·강퇴·전체 종료, 개인 퇴장·재입장
- PDF·MP4 업로드·삭제·공유, 페이지·재생 위치 동기화
- 정규화 좌표 공동 판서, 펜·형광펜·지우개·실행 취소·다시 실행·삭제
- 출결 구간을 합산한 참여 시간

관리 권한은 **해당 수업을 만든 교사의 ID**로 판단합니다. LiveKit 연결이 완료된 뒤 서버에 입장 완료를 보냅니다. 실시간 재연결 시에는 서버 스냅샷을 복원하고, 변경 명령을 임의로 재전송하지 않습니다.

## Android 실행

JDK 17 이상, Node.js, Android SDK 35를 준비하고 [서버 주소](#서버-연결)를 설정합니다. **저장소 루트**에서 다음 명령 하나로 공통 검사와 테스트용 APK 빌드를 실행합니다. APK 빌드에는 에뮬레이터가 필요 없습니다.

```sh
npm run apk
```

완료되면 APK의 절대 경로를 출력합니다. 기존 `mobile/.env`와 환경변수를 사용하며, macOS에서는 설정되지 않은 JDK 17·기본 Android SDK 경로를 자동으로 찾습니다. 다른 설치 경로는 `JAVA_HOME`·`ANDROID_HOME` 또는 `mobile/local.properties`의 `sdk.dir`로 지정합니다. 스크립트는 기기에 설치하지 않습니다.

직접 빌드하거나 연결한 기기에 설치하려면 저장소 루트에서 `npm run shared:check`를 먼저 실행한 뒤 **`mobile/`**에서 아래 명령을 사용합니다. Android Studio에서 `mobile/`을 열어 Device Manager로 에뮬레이터를 실행할 수 있습니다.

```sh
./gradlew :composeApp:assembleDebug
./gradlew :composeApp:installDebug
adb shell am start -n com.woongjin.thinkmeet/.MainActivity
```

- SDK를 찾지 못하면 Git에서 제외된 `local.properties`에 `sdk.dir=/사용자/Android/sdk`를 설정합니다.
- APK 위치: `composeApp/build/outputs/apk/debug/composeApp-debug.apk`

## iOS 실행

[서버 주소](#서버-연결)를 설정한 뒤 Xcode에서 `iosApp/ThinkMeet.xcodeproj`를 열고 `ThinkMeet` 스킴과 iPhone/iPad를 선택합니다. Swift Package Manager가 LiveKit을 가져오고, Xcode가 공통 Kotlin 프레임워크를 생성합니다. 실기기 설치에는 Apple Development Team과 앱·Broadcast 확장의 App Group 설정이 필요합니다. 자세한 절차는 [iOS 설정 안내](iosApp/README.md)를 따릅니다.

서명 없는 시뮬레이터용 빌드:

```sh
./gradlew :composeApp:linkDebugFrameworkIosSimulatorArm64
xcodebuild -project iosApp/ThinkMeet.xcodeproj -scheme ThinkMeet \
  -configuration Debug -sdk iphonesimulator \
  -derivedDataPath iosApp/build CODE_SIGNING_ALLOWED=NO build
```

## 서버 연결

Android/iOS 앱은 **빌드할 때** `mobile/.env`의 공개 서버 주소를 읽습니다. 앱 안에는 주소 입력 화면이 없습니다. 처음에는 `mobile/`에서 예제를 복사하고, `.env`의 주소를 웹과 같은 HTTPS 주소로 수정합니다. 기존 `.env`가 있으면 복사하지 않습니다.

```sh
cp .env.example .env
```

```dotenv
THINK_MEET_SERVER_ORIGIN=https://192.168.0.64
```

주소에는 `/api` 등 경로·계정·쿼리를 붙이지 않습니다. 값은 따옴표 없이 쓰거나 작은따옴표·큰따옴표로 감쌀 수 있습니다. 셸 변수 치환과 값 뒤 주석은 지원하지 않습니다. 값이 없거나 HTTPS origin 형식이 아니면 빌드를 중단합니다.

셸의 `THINK_MEET_SERVER_ORIGIN` 환경변수가 `.env`보다 우선합니다. CI와 일회성 Android 빌드는 다음처럼 지정할 수 있습니다.

```sh
THINK_MEET_SERVER_ORIGIN=https://meet.example.com ./gradlew :composeApp:installDebug
```

주소를 바꾸면 Android는 다시 빌드·설치하고, iOS는 Xcode에서 다시 빌드·실행합니다. `SKIP_KOTLIN_BUILD=YES`를 쓰는 iOS 빌드는 먼저 Kotlin 프레임워크를 다시 생성해야 합니다. 기존 앱에 저장된 주소는 사용하지 않으며, 참여 링크도 빌드에 설정된 서버 주소를 기준으로 확인합니다. `.env`는 Git에서 제외되고 공개 주소만 앱에 포함됩니다. 비밀번호·LiveKit API secret·서버 `.env`는 앱에 넣지 않습니다.

로컬 서버는 `infra/local/`에서 `./scripts/start.sh`로 실행합니다. 현재 Mac IP를 적용하려면 `./scripts/start.sh --lan`을 사용하세요. 실행 결과에 표시된 HTTPS 주소를 `mobile/.env`에 넣고 앱을 다시 빌드합니다. [로컬 실행 안내](../infra/local/README.md#서비스-실행접속)

자체 서명 개발 서버는 해당 서버의 공개 루트 CA를 신뢰해야 합니다. 로컬 서버의 공개 CA는 `../infra/local/certs/think-meet-root.crt`입니다.

- Android: 디버그 앱에만 개발 CA를 포함합니다. 서버가 다른 CA를 사용하면 검증된 서버 관리자·SSH 경로로 공개 루트 인증서만 받아 `mobile/certs/server-root.crt`에 저장하고 `.env`에 아래 설정을 추가한 뒤 다시 빌드·설치합니다. 상대 경로는 `mobile/` 기준이며 셸 환경변수가 우선합니다. 설정이 없으면 기존 번들 개발 CA를 사용합니다. 릴리스 앱은 시스템 CA를 사용합니다.
- iOS: 프로파일 설치 후 **설정 → 일반 → 정보 → 인증서 신뢰 설정**에서 전체 신뢰를 켭니다.

```dotenv
THINK_MEET_SERVER_CA_FILE=certs/server-root.crt
```

CA가 바뀌면 주소가 같아도 기존 앱이 연결되지 않을 수 있습니다. 주소 반영 여부는 `composeApp/build/generated/serverConfig/commonMain/kotlin/com/woongjin/thinkmeet/config/ServerConfig.kt`에서 확인하고, Android 디버그 빌드가 선택한 공개 CA는 `composeApp/build/generated/serverTrust/debug/res/raw/think_meet_server_root.crt`에서 확인합니다. `certs/`는 Git에서 제외됩니다. CA 파일에는 개인키를 넣지 않습니다. 공인 인증서 서버에는 별도 CA 설정이 필요 없습니다.

TLS 검증은 끄지 않습니다.

## 공통 디자인과 API

### 디자인

[공통 디자인 원본](../design/README.md)에서 색상·크기·반응형 값, 책 로고·아이콘·Pretendard 파일·주요 문구를 관리합니다. `design/`, `web/`, `mobile/`을 같은 상위 폴더에 유지합니다. 생성된 `DesignTokens.kt`는 직접 편집하지 않습니다. 테마·컴포넌트 정책은 `composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/design/`에 있습니다.

Kotlin 컴파일 전 `generateDesignTokens`가 실행됩니다. 빌드가 생성물을 덮어쓰기 전에 검사합니다.

```sh
./gradlew :composeApp:checkDesignTokens  # 파일을 수정하지 않는 검사
./gradlew :composeApp:generateDesignTokens
```

Node.js가 필요합니다. GUI IDE는 표준 Homebrew 경로도 찾습니다. 다른 Node는 `-PdesignNodeExecutable=/절대/경로/node` 또는 로컬 Gradle 설정으로 지정합니다.

### API 계약과 기능 활성화

HTTP·Socket.IO 모델과 기능 메타데이터의 원본은 [contracts](../contracts/)와 [features/catalog.json](../features/catalog.json)입니다. 실제 통신은 생성된 `data/generated/ContractModels.kt`와 `ContractProtocol.kt`를 사용합니다.

```sh
./gradlew :composeApp:checkContracts  # 파일을 수정하지 않는 검사
./gradlew :composeApp:generateContracts
```

Kotlin 컴파일 전에 생성하며, `check`에도 검사가 연결되어 있습니다. 같은 실행에 둘 다 있으면 검사를 먼저 합니다. Node 경로는 `-PcontractNodeExecutable=/절대/경로/node`로 지정할 수 있습니다.

기능 활성화 규칙:

- HTTP·Socket 업그레이드에 `X-ThinkMeet-Platform: android|ios`와 생성된 계약 revision을 보냅니다.
- 로그인과 별도로 capabilities를 조회하고 120초마다 갱신합니다.
- 조회 실패·캐시 만료 시 해당 플랫폼의 baseline 중 서버가 거부하지 않은 기능만 허용합니다. 알 수 없는 새 기능은 끕니다.
- 서버의 명시적 `false`는 해당 키의 명시적 `true` 또는 명시적 404 legacy 전환까지 유지합니다. 응답에서 키가 빠져도 거부 상태를 유지합니다.
- 서버가 허용해도 앱의 플랫폼·구현 상태·계약 revision 조건을 모두 충족해야 합니다.

새 UI는 `api.capabilities` 또는 `AppState.capabilities`를 Compose 상태로 수집하고 `capabilities.supports(ContractProtocol.FeatureIds.기능명)`으로 제어합니다. 명령 실행 시에도 `supportsFeature`를 확인합니다. PiP 메뉴·직접 진입·자동 진입에는 기능 정책과 OS 지원 조건을 함께 적용합니다.

HTTP method/path와 Socket 이벤트·command는 생성된 카탈로그로 검사합니다. 서버 인증·수업 권한 검사는 별도로 유지합니다. 새 기능에는 공통 카탈로그 등록과 실제 플랫폼 구현이 모두 필요합니다.

## 변경에 맞는 검증

핵심 상태 테스트와 영향받는 플랫폼 빌드·에뮬레이터 흐름을 확인합니다. Socket.IO 계약, 스냅샷 순서, 무제한 수업, 중복 입장 방지가 핵심 대상입니다. 전체 서버·웹 회귀 테스트를 매번 반복하지 않습니다.

```sh
./gradlew :composeApp:testDebugUnitTest
```

### 실제 수업 흐름

1. `node scripts/companion-smoke.mjs`로 별도 검증 수업을 만듭니다. 브라우저 학생이 실제 LiveKit 카메라·음성을 송출합니다.
2. `artifacts/smoke-lesson.json`의 값으로 에뮬레이터 테스트를 실행합니다.
3. 종료 후 이번 검증에서 만든 수업·자료만 정리합니다.

```sh
./gradlew :composeApp:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.lessonCode=생성된_코드 \
  -Pandroid.testInstrumentationRunnerArguments.lessonId=생성된_수업_ID \
  -Pandroid.testInstrumentationRunnerArguments.materialId=생성된_자료_ID
```

| 검증 목적 | 추가 인자·확인 내용 |
|---|---|
| 태블릿 영상·레이아웃 | `lessonCode`, `-Pandroid.testInstrumentationRunnerArguments.mediaOnly=true` |
| PiP | 별도 수업의 `lessonCode`·`lessonId`, `-Pandroid.testInstrumentationRunnerArguments.class=com.woongjin.thinkmeet.PictureInPictureSmokeTest` |

PiP 테스트는 진입·복귀, 채팅 초안·입장 기록 유지, Home 자동 진입, 교사가 PiP를 닫은 뒤 수업 유지를 확인합니다. 테스트 화면 증거는 `composeApp/build/outputs/connected_android_test_additional_output/`에 저장됩니다.

### 디자인 변경

`DesignParityCaptureTest`로 로그인·홈·상세·예약·입장·수업·채팅·자료 패널을 캡처합니다. 인자는 `captureLabel=phone|tablet`, `lessonCode`, `lessonId`이며 앱 내부 `files/design-parity`에 저장할 수 있습니다.

검증 수업은 저장소 루트에서 `node mobile/scripts/design-parity-fixtures.mjs create`로 만듭니다. 완료 후 `cleanup`으로 도구가 기록한 수업만 종료·취소합니다. 다음 검증 전에는 기존 `artifacts/design-parity/fixtures.json`을 보관용으로 옮기고 새 쌍을 만듭니다. 실제 비교 기록은 [design-qa.md](../design-qa.md)에 있습니다.

로컬 브라우저 비교에는 개발용 Vite 프록시를 선택할 수 있습니다. `web/`에서 다음 값을 지정합니다.

```sh
export THINK_MEET_LIVEKIT_ORIGIN=https://서버주소
export THINK_MEET_CA_FILE=../infra/local/certs/think-meet-root.crt
export VITE_THINK_MEET_LIVEKIT_PROXY=true
```

프록시는 개발 CA를 검증하며 개발 모드에서만 동작합니다. 배포 빌드는 서버 입장 응답의 LiveKit 주소를 사용합니다.

## 화면 속 화면(PiP)

| 동작 | 시스템 PiP | 앱 내부 미니 영상 |
|---|---|---|
| 열기 | **더보기 → 화면 속 화면**, 지원 기기에서는 Home 이동 시 자동 진입 | **더보기 → 미니 영상** |
| 표시 영상 | 다른 참여자의 화면 공유 우선, 없으면 교사·참여자 카메라 | 카메라 |
| 닫기 | 본인만 퇴장하고 카메라·마이크 해제. 교사도 전체 수업은 종료하지 않음 | 영상창만 숨김 |
| 이동 | 운영체제 제어 | 상단 손잡이로 이동 |

내 화면 공유는 반복 캡처를 막기 위해 PiP에 표시하지 않습니다. 자료 공유 중에는 웹과 같은 참가자 영역을 기본으로 표시하며 미니 영상은 직접 켭니다. PDF·판서·채팅은 수업 화면에서 사용합니다.

전체 화면으로 복귀하려면 작은 영상 창을 탭한 뒤 시스템의 크게 보기(전체 화면 복귀) 버튼을 누릅니다. Android 학생이 미러링 중이면 같은 메뉴의 아이콘이나, PiP 동안 화면 아래에 뜨는 글자 버튼 바(다른 앱 위 표시 권한 필요)에서 **화면 저장**과 **화면 공유 중지**도 누를 수 있습니다. 화면 공유 중지는 앱을 전체 화면으로 되돌립니다. 같은 수업 연결과 화면 상태를 이어갑니다. 수업 종료·강퇴·세션 만료 시 PiP도 정리합니다.

- Android: API 26 이상에서 기기 지원·설정에 따라 제공하며, API 31 이상에서 자동 진입합니다.
- iOS: AVKit 영상통화용 PiP와 기존 LiveKit 트랙을 사용합니다. 기기 지원·시스템 설정을 따르고, 지원 기기에서만 멀티태스킹 카메라를 켭니다.

## 플랫폼별 장치 동작과 확인 범위

- 내장 카메라는 전면·후면을 전환합니다. 유선·Bluetooth 출력은 OS 오디오 경로를 따릅니다.
- 소음 억제는 네이티브 WebRTC·iOS 음성 처리 기본값을 사용합니다.
- Android 8·9는 화면 영상만 공유합니다. 재생 소리 캡처는 Android 10 이상에서 OS·원본 앱이 허용한 콘텐츠에 한해 지원합니다.
- iOS 전체 화면 방송에는 서명된 ReplayKit 확장과 App Group이 필요합니다.

[검증 기록](docs/VERIFICATION.md)에서 Android 실행, iOS 빌드, iOS 실기기 확인을 구분합니다. 실제 카메라·마이크 음질, Bluetooth 경로, 운영 인증서·스토어 서명은 실기기와 배포 환경에서 확인해야 합니다.
