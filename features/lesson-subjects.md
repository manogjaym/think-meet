# 수업 과목 선택

선생님은 새 수업 예약과 예정된 수업의 수정 화면에서 본인에게 등록된 과목을 한 개 고를 수 있습니다. 과목 없이 예약할 수 있고, 수정에서 `선택 안 함`을 고르면 과목이 해제됩니다. 홈의 수업 목록과 수업 상세에서 저장한 과목을 확인할 수 있습니다.

**과목 선택** 버튼을 누르면 과목 카드와 선생님 본인의 과목별 최근 완료 수업이 보입니다. 카드를 누르면 선택값을 예약 폼에 적용합니다. 진행 중인 수업과 종료 요약에서 과목을 표시하고, 종료 후 **지난 수업 → 수업 상세**에서 과목과 실제 진행 시간을 볼 수 있습니다.

수업 시작과 종료 기록은 기존 수업에 저장합니다. 수업방 모드를 지원하는 방은 수업을 시작한 시각을 사용하며, 이전 방식으로 진행한 수업에는 입장 시각을 사용합니다. 준비 상태에서 종료하거나 취소한 예약은 과목 카드의 완료 기록으로 집계하지 않습니다.

- 과목 목록은 로그인한 선생님에게만 제공됩니다. 서버는 과목이 해당 수업의 선생님에게 등록되어 있는지 검사합니다.
- 목록이 비어 있거나 조회에 실패해도 과목 이외의 내용을 저장할 수 있습니다. 조회 실패 시 다시 불러올 수 있습니다.
- 기존 예약과 구버전 클라이언트의 과목 없는 예약을 지원합니다. 수정 요청에서 과목을 생략하면 저장값을 유지하고 `null`로 보내면 해제합니다.
- 로컬 개발 DB의 초기 시드는 모든 선생님에게 바로셈·수학·국어·영어를 추가합니다. 운영 마이그레이션은 스키마만 적용합니다.

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
