# iPhone · iPad

`ThinkMeet.xcodeproj`에서 `ThinkMeet` 스킴을 엽니다. 화면·권한 규칙·API·실시간 상태는 `composeApp`의 KMP 코드에서 공유합니다. Swift는 LiveKit·AVKit·ReplayKit·AVFoundation·PDFKit·Keychain을 담당합니다.

## 실행 전 설정

1. Xcode 26 이상, JDK 17 이상, iOS 17.2 이상을 준비합니다.
2. 앱과 `Broadcast` target에 같은 Apple 개발 팀을 지정합니다.
3. 두 target의 App Groups에 `group.com.woongjin.thinkmeet`를 등록합니다. bundle ID를 바꾸면 앱·확장의 ID와 두 entitlements의 그룹도 함께 바꿉니다.

앱에는 `Broadcast.appex`가 포함됩니다. ReplayKit 전체 화면 방송에는 앱·확장의 올바른 서명과 App Group 권한이 필요합니다.

### 로컬 HTTPS 인증서

`infra/local/certs/think-meet-root.crt` 공개 CA를 기기에 설치한 뒤 **설정 → 일반 → 정보 → 인증서 신뢰 설정**에서 전체 신뢰를 켭니다. TLS 검증을 우회하지 않습니다.

이미 실행 중인 시뮬레이터에는 `mobile/iosApp/`에서 설치할 수 있습니다.

```sh
xcrun simctl keychain booted add-root-cert ../../infra/local/certs/think-meet-root.crt
```

## 빌드와 공통 리소스

Xcode는 `embedAndSignAppleFrameworkForXcode`로 대상에 맞는 KMP 프레임워크를 생성합니다. `Build Kotlin and Compose Resources` 단계는 공식 `syncComposeResourcesForIos`로 공통 리소스를 앱에 넣습니다.

Apple Silicon에서 서명 없이 컴파일을 확인하려면 저장소 루트에서 실행합니다.

```sh
cd mobile
./gradlew :composeApp:linkDebugFrameworkIosSimulatorArm64
xcodebuild -project iosApp/ThinkMeet.xcodeproj -scheme ThinkMeet \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' ARCHS=arm64 \
  SKIP_KOTLIN_BUILD=YES CODE_SIGNING_ALLOWED=NO \
  KMP_FRAMEWORK_DIR='$(SRCROOT)/../composeApp/build/bin/iosSimulatorArm64/debugFramework' build
```

`SKIP_KOTLIN_BUILD=YES`는 기존 Kotlin 프레임워크의 재컴파일만 생략합니다. `generateComposeResClass`와 리소스 동기화는 계속 실행됩니다.

리소스 규칙:

- Gradle은 Xcode의 `PLATFORM_NAME`·`ARCHS`로 대상 리소스를 선택하고 `BUILT_PRODUCTS_DIR/UNLOCALIZED_RESOURCES_FOLDER_PATH/compose-resources/`에 복사합니다.
- 앱 내부 경로는 `compose-resources/composeResources/thinkmeetmobile.composeapp.generated.resources/`입니다.
- `font/`에는 Pretendard Regular·Medium·SemiBold·Bold OTF 4개, `files/`에는 `Pretendard-LICENSE.txt`가 포함됩니다. 빌드 중 공통 생성 원본과 비교하므로 글꼴 누락 시 성공 처리하지 않습니다.
- 리소스를 프레임워크 옆이나 앱 루트에 임의로 복사하지 않습니다.
- Compose는 `Font(Res.font...)`로 글꼴을 읽습니다. UIKit 시스템 글꼴로 대체하거나 Compose 글꼴용 `UIAppFonts`를 따로 등록하지 않습니다.

[공식 리소스 설정](https://kotlinlang.org/docs/multiplatform/compose-multiplatform-resources-setup.html)을 유지합니다. 네이티브 권한 창과 시스템 PiP 제어는 OS UI를 사용합니다.

## 권한·화면 공유·저장

- 카메라·마이크 권한은 실행 시 요청합니다. 거절해도 영상 수신·채팅으로 참여할 수 있으며, 영구 거절은 iOS 설정에서 변경합니다.
- 화면 공유를 누르면 ReplayKit 방송 선택기를 엽니다. 사용자가 시작을 승인한 뒤 영상 트랙과 공유 상태를 게시합니다.
- ReplayKit이 허용하는 앱 소리도 전송합니다. SDK 믹서에서 마이크 볼륨을 별도로 제어하므로 공유 소리를 보내면서 내 마이크를 끌 수 있습니다.
- 음성 캡처 권한을 거절하면 안내 후 화면 영상 공유를 계속합니다. DRM 등 캡처 제한은 iOS 정책을 따릅니다.
- 업로드 파일은 임시 파일로 복사해 64KiB씩 전송합니다. 500MiB 영상 전체를 메모리에 올리지 않고, 완료·실패·취소 후 임시 파일을 지웁니다.
- 로그인 세션은 현재 기기의 Keychain에만 저장합니다.

전체 화면 방송과 Bluetooth 오디오 경로는 실제 iPhone/iPad에서 확인해야 합니다.

## 시스템 화면 속 화면(PiP)

수업 버튼과 Home·다른 앱 전환 시 자동 진입은 AVKit 영상통화용 PiP를 사용합니다.

- `AVPictureInPictureController.ContentSource(activeVideoCallSourceView:contentViewController:)`를 연결합니다.
- `AVPictureInPictureVideoCallViewController`의 별도 LiveKit `VideoView`가 기존 수업 트랙을 표시합니다. 영상이 꺼진 음성 수업에는 진행 중 표시를 보여 줍니다.
- 방·입장 토큰을 새로 만들거나 기존 화면의 렌더러를 이동하지 않습니다. RTC 영상에 `AVPlayerLayer`를 대신 사용하지 않습니다.
- 전체 공통 수업 UI와 Compose 루트 UIView를 유지합니다. 이 UIView가 AVKit 전환 소스이므로 PiP 중 다른 작은 화면으로 교체하지 않습니다.
- 공유 화면·참여자 선택이 바뀌면 같은 PiP 렌더러의 트랙만 갱신합니다.

| 사용자 동작·상태 | 처리 |
|---|---|
| 시스템 창 닫기 | 본인 미디어를 즉시 끊고 공통 UI에서 본인 퇴장 API 호출. 수업 소유자도 전체 수업은 종료하지 않음 |
| 확장 버튼·앱 아이콘·앱 전환기로 복귀 | PiP 표시만 끝내고 기존 수업 연결 유지 |
| 로그아웃·퇴장·수업 종료·강퇴 | 자동 진입을 끄고 AVKit content source 해제 |

`audio`/`voip` 백그라운드 모드를 사용하며 LiveKit의 일괄 백그라운드 영상 중지는 사용하지 않습니다. 카메라는 `CameraCapturer.isMultitaskingAccessSupported`가 참일 때만 멀티태스킹 접근을 켭니다. 미지원 기기·OS의 카메라 제한을 따르되 원격 영상·음성은 기존 방을 사용합니다.

PiP 진입 여부는 기기 지원, 시스템 PiP 설정, 현재 앱 상태에 달려 있습니다. 빌드 통과와 Android 에뮬레이터 테스트는 iOS 실기기 검증을 대신하지 않습니다. 실제 iPhone/iPad에서 다음을 확인해야 합니다.

- Home 자동 진입, 카메라 켜짐·꺼짐, 공유 화면 전환, 마이크
- 확장 버튼·앱 아이콘 복귀, 창 닫기
- 강퇴·전체 종료 후 재진입 차단
