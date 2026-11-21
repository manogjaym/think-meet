# 수업 노트

학생은 홈에서 학습지 사진을 제출하고 **보관함**에서 제출한 사진과 첨삭을 확인합니다. **기록함**에서 자신과 선생님이 수업 중 저장한 공유 자료를 확인합니다.

- 제출 대상은 초대 전용 수업에서 학생이 강퇴되지 않은 경우에 한해 진행 중, 예정 순으로 선택합니다. 같은 상태는 시작 시간과 수업 ID 순입니다. 웹은 이미지 파일, Android/iOS는 카메라 사진을 한 장씩 미리 보고 제출합니다. 제출 중 대상이 바뀌면 다시 확인합니다.
- Android와 iOS에서 **사진 찍기**를 누르면 앱 안에서 전체 화면 카메라가 열립니다. 상단에 제출할 수업과 담당 선생님을 표시합니다. 점선에 학습지를 맞춰 가운데 버튼으로 촬영하면 사진 전체가 표시됩니다. 미리보기에서 가운데 **재촬영**을 누르면 카메라가 다시 열리고, 오른쪽 **제출하기**를 누르면 사진 한 장을 제출합니다.
- 제출한 학생과 그 수업의 담당 선생님만 학습지를 봅니다. 선생님은 수업 상세에서 원본별로 첨삭 이미지 한 장을 붙일 수 있습니다. 학생 보관함은 한국 시간의 제출 월과 날짜 및 수업명으로 구성합니다.
- 수업 중 공유 화면·PDF·영상과 확정 판서를 합성합니다. 저장자는 미리 보고 저장합니다. 원격 화면 안내, 공유 없음, 프레임 없음, 공유·페이지 변경 시에는 저장할 수 없습니다.
- 학생 캡처는 본인만 봅니다. 선생님 캡처는 해당 수업의 실제 출석 학생에게 표시됩니다. 목록과 이미지에 같은 권한을 적용합니다. 수업 종료 후에도 읽을 수 있습니다.
- JPEG·PNG를 장당 최대 10MiB까지 받습니다. 서버는 이미지를 검증하고 메타데이터를 제거한 뒤 비공개 저장소에 넣습니다. 같은 요청 ID를 재전송해도 항목은 한 번만 생깁니다.

`classroom.notes`는 계약 revision 6을 요구합니다. 서버·웹·Android·iOS 구현이 끝나면 기본 활성화하며 핵심 검사와 세 플랫폼의 휴대폰·태블릿 화면 확인을 마친 뒤 `ready`로 기록합니다.

## 검증 기록

2026-11-21 한국 시간에 격리된 PostgreSQL·MinIO·LiveKit에서 검증했습니다. 공개에는 서버의 `20261121000000_classroom_notes` 마이그레이션과 revision 6 클라이언트가 필요합니다.

| 범위 | 확인 결과 |
|---|---|
| 서버 | Prisma 마이그레이션, 진행 중 수업 우선, 취소된 제출 대상 재확인, 잘못된 이미지 거부, 동시 요청 중복 제거, 선생님·학생·출석별 목록 및 이미지 권한, 다른 출석 학생의 개인 캡처 접근 차단, 수업 종료 후 첨삭과 조회 통과 |
| 웹 | Playwright로 제출·첨삭과 공유 화면·PDF·영상의 확정 판서 합성 확인. 390×844 휴대폰·1024×900 태블릿 폭 화면 확인 |
| Android | 핵심 테스트와 Debug APK 빌드 통과. 기존 Android 35 에뮬레이터에서 가상 카메라 촬영 취소, 화면 크기·밀도 변경 뒤 미리보기 복원, 제출, 같은 학생의 학습지와 기록함 조회 확인. 1080×2400(약 411dp 너비)와 1536×1350(1024dp 너비)에서 비교. 실제 공유 화면·PDF·영상의 미리보기 및 저장을 실행했고, 서버 JPEG에서 배경과 확정 판서 픽셀을 확인 |
| iOS | Kotlin 프레임워크와 Swift 호스트 빌드 통과. iPhone 16 Pro·iPad Pro 11인치 iOS 18.4에서 앱 시작 확인. 서명 없는 검증 빌드의 Keychain 세션 저장 실패로 로그인 이후 화면 미검증. 임시 시뮬레이터 서명은 자동 심사에서 차단됨 |

저장소 루트에서 `npm run shared:check`와 `npm run verify`를 실행했습니다. `mobile/`에서 JDK 17·Android SDK를 설정하고 `./gradlew :composeApp:checkDesignTokens :composeApp:checkContracts :composeApp:testDebugUnitTest :composeApp:assembleDebug :composeApp:linkDebugFrameworkIosSimulatorArm64`를 실행했습니다. iOS 호스트는 [iOS 시뮬레이터 빌드 명령](../mobile/iosApp/README.md#빌드와-공통-리소스)을 사용했습니다.

웹 통합 검사는 `web/`에서 Node·Playwright Chromium·FFmpeg와 격리 서버를 준비한 뒤 실행합니다. `BASE_URL`에는 격리 HTTPS 주소, `TEST_PASSWORD`에는 `teacher1`, `teacher2`, `student1`, `student2` 테스트 계정의 비밀번호를 지정합니다. `teacher1`의 명단에 두 학생을 연결합니다.

```sh
THINK_MEET_NOTES_TEST=1 npx playwright test e2e/class-notes.spec.ts
```

카메라 복귀 수정 이후 Android 검사 40개와 APK·iOS 프레임워크·호스트 빌드를 다시 통과했습니다. 동시 작업 중인 기능의 미완료 파일과 겹친 시점에는 임시 소스 복사본으로 네이티브 검사를 실행했고, 이후 저장소 루트에서 공통 계약 및 변경 기록 검사를 통과했습니다.

화면 증거는 [웹 휴대폰 제출](evidence/classroom-notes/web-phone-submit.png), [웹 휴대폰 기록함](evidence/classroom-notes/web-phone-records.png), [웹 태블릿 학습지](evidence/classroom-notes/web-tablet-worksheet.png), [웹 태블릿 기록함](evidence/classroom-notes/web-tablet-records.png), [Android 휴대폰 제출](evidence/classroom-notes/android-phone-submit.png), [Android 휴대폰 기록함](evidence/classroom-notes/android-phone-records.png), [Android 태블릿 폭 학습지](evidence/classroom-notes/android-tablet-width-worksheets.png), [Android 태블릿 폭 기록함](evidence/classroom-notes/android-tablet-width-records.png), [Android PDF 캡처](evidence/classroom-notes/android-document-capture.png)에 남겼습니다. 앱 실기기 카메라와 원격 CI는 미검증입니다. [플랫폼별 변경 기록](changes/classroom-notes.json)을 참고합니다.

### 앱 내 학습지 카메라

2026-11-21 한국 시간에 저장소 루트의 `npm run shared:check`, 카메라 변경 파일 목록을 전달한 `shared:check`, `npm run verify`가 통과했습니다. 임시 소스 복사본의 `mobile/`에서 위 네이티브 검사 명령으로 Android 핵심 테스트 40개와 Debug APK, iOS 시뮬레이터용 Kotlin 프레임워크를 확인했습니다. iOS 호스트는 위 명령으로 서명 없이 빌드했습니다. 연결 가능한 iOS 실기기가 없어 iPhone·iPad의 학습지 촬영은 미검증입니다. [수업 노트 변경 기록](changes/classroom-notes.json)

Android 35 에뮬레이터에서 1080×2400 휴대폰 해상도로 실시간 카메라 가이드와 촬영 후 버튼을 확인했습니다. 재촬영 후 격리 서버에 한 장을 제출했고, 보관함에서 원본을 열었습니다. [휴대폰 촬영](evidence/classroom-notes/android-camera-phone-live.png) · [휴대폰 미리보기](evidence/classroom-notes/android-camera-phone-preview.png) · [제출한 사진](evidence/classroom-notes/android-camera-phone-submitted.png)

같은 에뮬레이터에서 1536×1350, 너비 1024dp로 촬영·미리보기·재촬영·닫기를 확인했습니다. Android 실기기 카메라는 미검증입니다. [태블릿 크기 촬영](evidence/classroom-notes/android-camera-tablet-live.png) · [태블릿 크기 미리보기](evidence/classroom-notes/android-camera-tablet-preview.png)
