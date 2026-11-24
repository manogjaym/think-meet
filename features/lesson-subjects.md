# 수업 과목 선택

선생님은 새 수업 예약과 예정된 수업의 수정 화면에서 본인에게 등록된 과목을 한 개 고를 수 있습니다. revision 15 이상 웹·앱에서는 과목이 필수입니다([과목별 자료 보관](#과목-필수-선택과-과목별-자료-보관)). 그 이전 클라이언트는 과목 없이 예약하고 `선택 안 함`으로 과목을 해제할 수 있습니다. 홈의 수업 목록과 수업 상세에서 저장한 과목을 확인할 수 있습니다.

보라색 **과목 선택** 버튼을 누르면 과목 카드와 선생님 본인의 과목별 최근 완료 수업이 보입니다. 카드를 누르면 선택한 과목이 버튼 옆에 표시됩니다. 진행 중인 수업과 종료 요약에서 과목을 표시하고, 종료 후 **지난 수업 → 수업 상세**에서 과목과 실제 진행 시간을 볼 수 있습니다.

수업 시작과 종료 기록은 기존 수업에 저장합니다. 수업방 모드를 지원하는 방은 수업을 시작한 시각을 사용하며, 이전 방식으로 진행한 수업에는 입장 시각을 사용합니다. 준비 상태에서 종료하거나 취소한 예약은 과목 카드의 완료 기록으로 집계하지 않습니다.

- 과목 목록은 로그인한 선생님에게만 제공됩니다. 서버는 과목이 해당 수업의 선생님에게 등록되어 있는지 검사합니다.
- 목록이 비어 있거나 조회에 실패해도 과목 이외의 내용을 저장할 수 있습니다. 조회 실패 시 다시 불러올 수 있습니다.
- 기존 예약과 구버전 클라이언트의 과목 없는 예약을 지원합니다. 수정 요청에서 과목을 생략하면 저장값을 유지하고 `null`로 보내면 해제합니다.
- 로컬 개발 DB의 초기 시드는 모든 선생님에게 바로셈·수학·국어·영어를 추가합니다. 운영 마이그레이션은 스키마만 적용합니다.

## 과목 필수 선택과 과목별 자료 보관

`classroom.subject-storage`(계약 revision 15)를 지원하는 웹·앱에서는 선생님이 수업을 만들 때 과목을 반드시 골라야 합니다. 수업에서 올리거나 저장한 자료는 그 수업의 과목 아래에 보관합니다.

| 항목 | 동작 |
|---|---|
| 수업 예약·수정 | 라벨은 **과목 (필수)**이고 `선택 안 함`이 없습니다. 과목 없이 저장하면 오류를 표시하고 요청을 보내지 않습니다. 서버도 revision 15 요청에서 과목 없는 생성, 과목 해제, 과목 없는 기존 수업을 과목 없이 수정하는 요청을 `VALIDATION`(400)으로 거부합니다. |
| 교재(PDF·MP4) | 수업방 교재 패널에서 올리면 수업 과목에 저장합니다. 패널은 **{과목} 교재** 제목과 함께 그 과목 교재와 미분류 교재만 보여 주며, 미분류 교재에는 **미분류** 표시를 붙입니다. |
| 학습지·첨삭·화면 저장 | 학생 학습지, 선생님 첨삭, 수업 중 저장한 화면은 수업 과목에 저장합니다. 예정된 수업의 과목을 바꾸면 이미 제출한 학습지도 새 과목으로 옮깁니다. |
| 수업 노트 | 목록에 과목이 둘 이상이면 **전체 과목**·과목명·**미분류** 칩을 수업명 칩 위에 표시합니다. 과목 칩을 고르면 카드와 수업명 칩을 그 과목으로 거릅니다. |

- **저장 위치:** DB의 `Material.subjectId`·`ClassNoteImage.subjectId`에 과목을 기록합니다. 새 파일의 저장소 키는 `subjects/<과목 ID>/materials/…`, `subjects/<과목 ID>/class-notes/…`입니다. 과목이 없는 수업의 파일은 기존 키(`<선생님 ID>/…`, `class-notes/…`)를 사용합니다. 과목을 옮겨도 이미 저장한 파일의 키는 바꾸지 않습니다.
- **기존 데이터:** 마이그레이션 `20261124100000_subject_storage`는 기존 수업 노트 이미지를 수업 과목으로 채우고, 기존 교재는 미분류로 둡니다. 미분류 교재는 모든 수업에서 계속 보입니다.
- **구버전 호환:** revision 14 이하 앱은 지금처럼 과목 없이 수업을 만들고 수정할 수 있습니다. 이 수업은 미분류이며 교재 패널에 선생님의 모든 교재를 보여 줍니다. 구버전이 `lessonId`로 교재를 조회·업로드하면 `CLIENT_UPDATE_REQUIRED`(426)를 받습니다.
- **권한:** 과목은 선생님별로 등록됩니다. 다른 선생님의 수업에서 교재를 올리면 미분류로 저장합니다. 학생은 수업 교재 목록을 조회할 수 없습니다.
- **한계:** 과목을 등록·관리하는 화면은 없습니다. 등록된 과목이 없는 선생님은 revision 15 웹·앱에서 수업을 만들 수 없으므로, 운영 배포 전에 선생님별 과목을 DB에 등록해야 합니다.

### 과목별 자료 보관 검증

2026-11-24 한국 시간에 로컬 서비스(`infra/local/`의 API만 새 이미지로 재배포, 마이그레이션 적용)에서 확인했습니다. 화면 검증은 임시 선생님·학생 계정과 수학·영어 과목, 수업 2개, 교재 3개(수학·영어·미분류), 과목별 학습지·저장 화면으로 진행했고 검증 후 계정·수업·교재·이미지와 저장소 파일을 모두 삭제했습니다.

| 범위 | 확인 결과 |
|---|---|
| 공통·서버 | 저장소 루트에서 `npm run shared:check`, `npm run verify` 통과(공통 13, 서버 75, 웹 19, 타입 검사, 웹 빌드). `server/`에서 `npx tsx --test test/subject-storage.test.ts test/class-note-capture.test.ts` 4개 통과 |
| API 통합 | `infra/local/`에서 `docker compose exec -T api node --input-type=module - < ../../server/test/subject-storage.integration.mjs` 통과. revision 15의 과목 없는 생성·해제 거부, revision 14 생성·수정 허용, 교재 과목 저장·목록 범위·구버전 426, 학습지·첨삭·화면 저장의 과목과 저장소 키, 과목 변경 시 학습지 이동 확인. 기존 `lesson-subjects.integration.mjs`(revision 7)도 다시 통과 |
| 웹 | Vite 개발 서버(`http://127.0.0.1:8443`)와 로컬 API로 390×844·834×1194에서 필수 과목 오류(요청 미전송)·`선택 안 함` 없는 팝업, 학생 수업 노트 과목 칩 필터, 390×844·1280×800에서 수학 수업의 교재 패널(수학·미분류 교재만, 미분류 표시) 확인 |
| Android | 기존 `emulator-5554`(1080×2400, 420dpi)와 임시 180dpi(태블릿 폭)에서 웹과 같은 계정·데이터로 수업 예약 오류·팝업, 수업 노트 과목 칩, 휴대폰 교재 패널 확인. 수학 과목을 골라 실제 예약 저장 확인. `mobile/`에서 JDK 17로 `./gradlew :composeApp:checkDesignTokens :composeApp:checkContracts :composeApp:testDebugUnitTest :composeApp:assembleDebug :composeApp:compileKotlinIosSimulatorArm64 --offline` 통과(단위 테스트 50개). 검증 후 화면 밀도를 원래대로 되돌리고 기존 teacher1 로그인을 복원 |
| iOS | 공통 Compose 코드 사용. Linux 환경이라 Kotlin iOS 컴파일만 실행했고 Swift 호스트 빌드와 iPhone·iPad 실행은 미검증 |

화면 증거(`evidence/subject-storage/`):

| 화면 | 휴대폰 | 태블릿 |
|---|---|---|
| 수업 예약 필수 오류 | [웹](evidence/subject-storage/web-phone-form-required.png) · [Android](evidence/subject-storage/android-phone-form-required.png) | [웹](evidence/subject-storage/web-tablet-form-required.png) · [Android](evidence/subject-storage/android-tablet-form-required.png) |
| 과목 팝업 | [웹](evidence/subject-storage/web-phone-form-picker.png) · [Android](evidence/subject-storage/android-phone-form-picker.png) | [웹](evidence/subject-storage/web-tablet-form-picker.png) · [Android](evidence/subject-storage/android-tablet-form-picker.png) |
| 수업 노트 과목 칩 | [웹 학습지](evidence/subject-storage/web-phone-notes-worksheets.png) · [웹 기록 영어](evidence/subject-storage/web-phone-notes-records-english.png) · [Android 학습지](evidence/subject-storage/android-phone-notes-worksheets.png) · [Android 기록 수학](evidence/subject-storage/android-phone-notes-records-math.png) | [웹 학습지](evidence/subject-storage/web-tablet-notes-worksheets.png) · [웹 기록 영어](evidence/subject-storage/web-tablet-notes-records-english.png) · [Android 학습지](evidence/subject-storage/android-tablet-notes-worksheets.png) · [Android 기록 영어](evidence/subject-storage/android-tablet-notes-records-english.png) |
| 수업방 교재 패널 | [웹](evidence/subject-storage/web-phone-textbook-panel.png) · [웹 미디어 탭](evidence/subject-storage/web-phone-media-tab.png) · [Android](evidence/subject-storage/android-phone-textbook-panel.png) | [웹 1280×800](evidence/subject-storage/web-wide-textbook-panel.png) |

미검증: Android 태블릿 폭 교재 패널, iOS 빌드·실행, 원격 CI. 웹 검증 브라우저에는 카메라·마이크가 없어 장치 오류 안내가 함께 보입니다. iOS 실행 검증 전까지 기능은 `in-progress`로 둡니다.

## 초기 과목 선택 검증

| 검사 | 결과 |
|---|---|
| 저장소 루트에서 `npm run shared:check`, `npm run verify` | 공통 계약·호환성, 서버·웹 타입 검사 및 웹 빌드 통과 |
| `infra/local/`에서 `docker compose exec -T api npm run seed` 두 번 실행 | 마이그레이션 적용 후 기존 선생님 1명에 예시 과목 4개를 등록. 재실행 후에도 4개 유지 |
| `infra/local/`에서 `docker compose exec -T api node --input-type=module - < ../../server/test/lesson-subjects.integration.mjs` | 로컬 PostgreSQL과 실제 API에서 권한 분리, 과목 생략·저장·변경·해제, 구버전 수정 시 과목 보존 통과 |
| `web/`에서 `BASE_URL=https://localhost ./node_modules/.bin/playwright test e2e/lesson-subjects.spec.ts` | 조회 재시도, 실예약, 목록·상세 표시, 수정·해제 통과. 같은 예약으로 402×874·834×1210 화면도 확인 |
| 과목 변경만 담은 검증본의 `mobile/`에서 Gradle 공통 검사, `testDebugUnitTest`, `assembleDebug`, `linkDebugFrameworkIosSimulatorArm64` | Android 핵심 테스트·APK 및 iOS 시뮬레이터 프레임워크 빌드 통과 |
| 과목 검증본의 `mobile/`에서 Xcode Simulator 호스트 빌드 | iPhone·iPad용 앱 빌드 통과 |

같은 선생님 계정으로 같은 예약의 목록·상세·수정을 확인했습니다. 캡처는 목록, 상세, 신규 예약, 수정 순서입니다.

- [웹 휴대폰 402×874](evidence/lesson-subjects/web-phone.png)
- [웹 태블릿 834×1210](evidence/lesson-subjects/web-tablet.png)
- [Android 휴대폰 1080×2400, 420dpi](evidence/lesson-subjects/android-phone.png)

Android 태블릿 화면 검증은 에뮬레이터가 입력과 APK 설치에 응답하지 않아 중단했습니다. iPhone·iPad 화면 검증은 CoreSimulator의 부팅·장치 조회 시간 초과로 완료하지 못했습니다. 기능은 지원 버전에서 기본 활성화되며, 화면 검증이 남아 카탈로그는 `in-progress`로 기록합니다.

## 과목 팝업과 종료 기록 검증

- 공통 계약 검사와 `npm run verify`를 통과했습니다. 분리한 PostgreSQL에서 API 통합 검사를 실행해 종료 후 과목과 실제 시작·종료 시각이 다시 조회되는 것을 확인했습니다.
- 분리한 로컬 서비스에서 Playwright 2건을 통과했습니다. 과목 조회 재시도·선택·해제, 실제 영상 수업 시작·종료, 지난 수업 상세와 팝업의 완료 기록을 확인했습니다. 갱신한 기존 로컬 웹에서도 과목 팝업을 열었습니다.
- 같은 선생님 계정과 완료 기록으로 웹 휴대폰·태블릿 및 Android 휴대폰·태블릿 폭을 비교했습니다. Android는 기존 에뮬레이터의 화면 밀도를 검증 후 복원했습니다.
- Android 핵심 테스트·APK 빌드와 iOS 시뮬레이터 앱 빌드를 통과했습니다. iPhone·iPad의 팝업 실행 검증은 남아 있습니다.

| 휴대폰 | 태블릿 |
|---|---|
| [웹 402×874](evidence/lesson-subjects/picker/web-phone.png) | [웹 834×1194](evidence/lesson-subjects/picker/web-tablet.png) |
| [Android 1080×2400, 420dpi](evidence/lesson-subjects/picker/android-phone.png) | [Android 태블릿 폭 1080×2400, 180dpi](evidence/lesson-subjects/picker/android-tablet.png) |

## 과목 버튼 검증

로컬 웹에서 같은 선생님 계정으로 과목 버튼, 팝업, 선택한 과목 표시를 확인했습니다. [웹 휴대폰 402×874](evidence/lesson-subjects/picker/button-web-phone.png) · [웹 태블릿 834×1194](evidence/lesson-subjects/picker/button-web-tablet.png)

`web/`에서 타입 검사와 빌드가 통과했습니다. `mobile/`에서 `./gradlew :composeApp:compileDebugKotlinAndroid :composeApp:compileKotlinIosSimulatorArm64 --offline`이 통과했습니다. 변경된 Android·iOS 화면 실행은 검증하지 못했습니다.
