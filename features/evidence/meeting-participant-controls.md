# 참여자 제어 검증 기록

2026-11-22, Linux 개발 컨테이너에서 이 작업 트리의 서버·웹·앱을 검증했습니다. 실행 중이던 다른 작업 트리의 Docker 서비스와 기존 `test_device` 에뮬레이터는 사용하거나 변경하지 않았습니다.

| 대상 | 실행 결과 |
|---|---|
| 공통·서버·웹 | 루트에서 `npm run shared:check`, 변경 파일 목록 검사, `npm run verify` 통과. 공통 13개·서버 67개·웹 19개와 타입 검사·웹 빌드 통과 |
| 서버 권한 | `server/`의 `npx tsx --test test/remote-assistance.test.ts` 14개 통과. 학생 요청 거부, 구버전 대상 기기·오프라인·선생님 대상 거부, 대상 학생에게만 요청 전달, 수업 모드 판서 허용·해제와 미허용 판서 거부 확인 |
| Chromium | 검증 전용 PostgreSQL·LiveKit 컨테이너와 이 작업 트리의 API·Vite에서 `web/`의 `BASE_URL=<검증 주소> npx playwright test e2e/participant-controls.spec.ts` 1개 통과. 실제 LiveKit 연결로 교사·학생 버튼 표시, 학생 마이크·카메라 끄기·켜기와 안내, 학생 자신의 마이크 변경 반영, 판서 허용·해제 안내, 공유 화면에서 학생 판서 도구 표시·해제를 확인. 화면 공유는 합성 영상 사용 |
| 웹 배치 회귀 | `PAGINATION_BASE_URL=<검증 주소> npx playwright test e2e/meeting-pagination.spec.ts` 7개 통과 |
| Android | `mobile/`에서 `:composeApp:assembleDebug`, `:composeApp:assembleDebugAndroidTest` 통과. 같은 API 35 시스템 이미지로 만든 임시 AVD에서 `ParticipantControlsTest` 2개를 휴대폰 1080 × 2400(420dpi)과 태블릿 크기 1600 × 1200(240dpi)에서 통과. 실제 Compose 타일·제어 줄과 콜백을 사용하고 서버·LiveKit은 사용하지 않음. 임시 AVD는 검증 후 삭제 |
| iOS | 공통 Compose 코드를 사용하지만 Linux 환경이라 프레임워크 링크·Xcode 빌드·실행은 미실시 |

## 화면 기록

| 화면 | 웹 | Android |
|---|---|---|
| 교사 갤러리 | [데스크톱](meeting-participant-controls/web-teacher-off-desktop.png), [휴대폰](meeting-participant-controls/web-teacher-off-phone.png), [태블릿 판서 허용](meeting-participant-controls/web-teacher-annotation-tablet.png) | [휴대폰](meeting-participant-controls/android-phone-teacher-gallery.png), [태블릿](meeting-participant-controls/android-tablet-teacher-gallery.png) |
| 교사 공유 화면 | [데스크톱](meeting-participant-controls/web-teacher-stage-desktop.png), [휴대폰](meeting-participant-controls/web-teacher-stage-phone.png) | [태블릿 참여자 열](meeting-participant-controls/android-tablet-teacher-stage.png) |
| 학생 | [휴대폰 안내](meeting-participant-controls/web-student-notice-phone.png), [태블릿 판서 도구](meeting-participant-controls/web-student-stage-tablet.png) | [휴대폰](meeting-participant-controls/android-phone-student-gallery.png) |

## 미검증 범위

실제 Android·iOS 기기 사이의 요청 전달과 OS 권한 응답, iOS 빌드·실행, 원격 CI는 검증하지 않았습니다. 기능 상태는 `in-progress`입니다.
