# 미러링 PiP 버튼 검증 기록

2026-11-22, Linux 개발 컨테이너에서 검증했습니다. 다른 세션이 쓰는 기존 `test_device` 에뮬레이터는 건드리지 않고, 같은 Android 35 시스템 이미지로 만든 임시 AVD를 사용한 뒤 삭제했습니다.

| 대상 | 실행 결과 |
|---|---|
| 서버 | `server/`의 `npx tsx --test test/class-note-capture.test.ts` 1개 통과. 미러링 화면은 공유 중인 학생 본인만 저장되고 본인 기록으로 남음. 선생님·다른 학생은 `NOTE_SHARE_CHANGED`로 거부. 일반 공유의 기존 저장 권한 유지 |
| Android 빌드 | `mobile/`에서 `:composeApp:testDebugUnitTest`(47개 통과), `:composeApp:assembleDebug`, `:composeApp:assembleDebugAndroidTest` 통과 |
| Android 실행 | 1080 × 2400(420dpi)에서 `MirroringPipActionsTest` 2개 통과. 앱 PiP 컨트롤러의 실제 매개변수로 시스템 PiP를 열어 메뉴에 시스템 크게 보기 버튼 하나와 화면 저장·미러링 끄기만 있는지 확인하고, 미러링 끄기 탭이 앱에 전달되는지 확인. 90도 회전된 화면 프레임이 바른 방향의 JPEG로 바뀌는지 확인 |

[PiP 메뉴 화면](mirroring-pip-actions/android-phone-pip-menu.png)

## 미검증 범위

실제 계정으로 교사 요청 → 학생 승인 → 전체 화면 캡처 → PiP 메뉴의 화면 저장·미러링 끄기를 잇는 흐름은 검증 서버의 HTTPS 인증서를 기존 에뮬레이터가 신뢰하지 않아 실행하지 못했습니다. 기존 `PictureInPictureSmokeTest`는 시스템 크게 보기 버튼을 누르도록 바꿨지만 실제 서버가 필요해 이번에 실행하지 않았습니다. Android 태블릿 크기와 원격 CI도 미실행입니다.
