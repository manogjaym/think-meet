# 웹·앱 공통 디자인 검증

2026-11-14 · Asia/Seoul

웹 기준으로 KMP 화면·브랜드·글꼴·반응형을 맞춘 검증 기록입니다. 기존 토큰 추출 검증 기록을 대체합니다.

| 항목 | 결과 / 증거 |
|---|---|
| 공통 원본 | `tokens.json`, `assets/vectors.json`, `fonts/manifest.json`, `system.json` 사용. 비어 있지 않은 시각적 `platformOverrides` 거부 |
| 생성물 최신 여부 | `node design/scripts/generate.mjs --check` 통과. 웹·Kotlin·글꼴·라이선스 20개 출력 검사 |
| 생성기 핵심 테스트 | 5개 통과: 공통 값·변환, 잘못된 원본 거부, 검사/원자적 쓰기, 공유 반응형 분기, SVG 사각형 반경 fallback |
| 로고·아이콘 | 웹 원본 책 로고 2개 path와 39개 아이콘을 같은 좌표·선 스타일로 생성. Compose Material icon 확장 의존성 제거 |
| 글꼴 | Pretendard v1.3.9 400/500/600/700의 WOFF2·OTF와 라이선스 보관. 매 생성 시 SHA-256 검사 |
| 웹 | TypeScript 검사·Vite 배포 빌드 통과. 로그 `mobile/artifacts/design-parity-web-build.log` |
| Android | `assembleDebug`, `assembleDebugAndroidTest` 통과. 로그 `mobile/artifacts/design-parity-build.log` |
| 핵심 상태 테스트 | `AppStateSafetyTest` 3개 통과(중복 입장·세션 만료·대기실 복귀 중 자동 입장 차단). `mobile/composeApp/build/test-results/testDebugUnitTest/` |
| iOS 공통 UI | `linkDebugFrameworkIosSimulatorArm64` 통과 |
| iOS 앱 번들 | 전체 Swift 호스트 빌드·재링크 및 OTF 4종·라이선스 실제 포함 검증. `mobile/artifacts/ios-font-resources.json` |
| 실제 화면 비교 | 휴대폰·태블릿 실제 비교 통과. 최종 판정과 전체/부분 비교 증거는 저장소 루트 `design-qa.md` |

## 화면 비교 방법

- 기존 Android 에뮬레이터 한 대에서 휴대폰·태블릿 크기로 앱을 실행했습니다.
- 웹은 같은 계정·데이터·카메라/마이크 상태로 캡처했습니다.
- OS 안전 영역을 제외하고 같은 크기로 맞춘 두 캡처를 나란히 비교했습니다.

## 플랫폼 차이·검증 한계

- 웹의 기기 선택·실제 마이크 미터, 앱의 카메라 전환·기기 안내는 플랫폼 방식을 따릅니다.
- OS 안전 영역·날짜/시간 선택기·권한·시스템 PiP·글꼴 렌더링 차이는 허용합니다.
- PiP·네이티브 영상/화면 공유·자료 명령은 기존 구현을 유지했습니다. 이번 스타일 변경에서는 전체 서버·미디어·PDF 통합 검사를 반복하지 않았습니다.
- iOS는 공통 UI 컴파일과 `.app` 패키징을 확인했습니다. 기기·시뮬레이터 화면 실행은 하지 않았습니다.

토큰·자산·문구·분기 값은 자동 생성됩니다. 화면 구성·상호작용은 React·Compose에 각각 반영하고 실제 화면을 비교해야 합니다. `system.json`만으로 화면 변환·시각적 일치가 보장되지는 않습니다.
