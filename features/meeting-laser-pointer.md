# Android 학생 원격 화면 안내

선생님이 Android 학생에게 화면 보기를 요청하고 학생이 직접 승인하면 전체 화면을 공유합니다. 운영체제 권한과 캡처 시작을 확인한 뒤 수업 앱이 화면 속 화면(PiP)으로 전환됩니다. 웹 선생님이 공유 영상을 누른 채 마우스를 움직이면 학생이 보고 있는 다른 앱의 원래 위치 위에 포인터가 따라갑니다. 누른 채 멈춰 있어도 표시를 유지하며, 놓으면 마지막 좌표 수신 후 1.5초 뒤 숨깁니다. 학생의 터치를 대신 실행하지 않습니다.

학생 수신은 Android부터 지원합니다. 선생님 요청·클릭 화면은 웹·Android·iOS에 구현하며, iOS·웹 학생에게 승인 버튼을 제공하지 않습니다. 기능 ID는 `meeting.remote-assistance`, 계약 revision은 4, 검증 단계는 `in-progress`이며 구현된 기능은 환경변수 없이 기본 사용합니다. `THINK_MEET_FEATURE_FLAGS`는 읽지 않습니다.

## 사용 흐름

1. 선생님이 **참석자 → 학생의 화면 보기 요청**을 누릅니다. 웹에서는 **더보기 → 학생 화면 보기**로도 참석자 패널을 열 수 있으며, 참여 중인 학생 이름 아래에 요청 버튼을 표시합니다. 현재 공유가 있다면 먼저 중지해야 하며, 승인 대기·캡처 준비·안내 진행 중에는 새 요청 버튼을 비활성화합니다. 수업마다 한 요청만 진행합니다.
2. 학생에게 승인·거절 버튼을 표시합니다. 승인창은 **전체 화면이 수업 참여자에게 공유**되며 다른 앱 위에 선생님의 포인터가 표시된다고 안내합니다. 교사 전용 비공개 영상 채널은 아닙니다.
3. 학생이 승인하면 Android의 **다른 앱 위에 표시** 설정과 **전체 화면 공유** 동의를 확인합니다. 앱의 승인 버튼만으로 운영체제 권한을 생략하지 않습니다.
4. 실제 화면 영상과 서버의 승인 세션 연결을 확인한 뒤 PiP로 전환합니다. PiP에는 선생님 영상 또는 음성 수업 표시를 보여 주고 자신의 공유 화면을 반복 표시하지 않습니다.
5. 웹 선생님은 공유 영상을 누른 채 마우스를 움직여 위치를 알려줍니다. 이동 중에는 기존 최대 20회/초 전송 제한을 사용하고, 정지 중에는 250ms마다 좌표를 갱신합니다. 손을 떼거나 입력 취소·창 포커스 상실·탭 숨김·연결/화면 방향 변경·공유 종료가 발생하면 연속 전송을 중단합니다. 학생 앱은 기존 수신 코드를 사용하며 마지막 좌표 수신 후 1.5초 뒤 포인터가 사라집니다. 학생은 직접 누릅니다.
6. 학생·선생님의 **화면 안내 중지**, 일반 공유 중지, OS 캡처 중지, 수업 퇴장·종료, 강퇴, 연결 끊김, 기능 미지원 전환에서 공유와 포인터를 정리합니다. 재접속하면 새 요청과 승인이 필요합니다.

## 권한·상태·통신

| 항목 | 규칙 |
|---|---|
| 상태 | `pending`(승인 대기 60초) → `approved`(캡처 준비 120초) → `active`. 거절·만료·중지는 세션 제거 |
| 선생님 | 인증된 해당 수업 선생님과 현재 수업 Socket만 요청·위치 전송 가능 |
| 학생 | 현재 연결된 Android 앱, feature/revision 지원, 해당 요청을 받은 학생 Socket만 승인·캡처 시작 가능 |
| 캡처 검증 | 서버는 현재 입장 ID와 실제 LiveKit 화면 트랙을 확인하고 새 공유 ID를 승인 세션에 연결 |
| 좌표 | 공유 영상의 여백을 제외한 정규화 좌표 0~1. 학생의 실제 전체 화면 px 크기·회전·geometry version과 연결 |
| 회전 | 학생의 크기/방향 변경 중 포인터 숨김. 새 캡처 프레임 비율 확인 후 version 갱신. 교사는 500ms 유예와 영상 비율 확인 후 다시 입력 가능 |
| 수신 | 포인터는 승인된 학생 Socket 하나에만 전송. 세션·공유·화면 버전·선생님 ID가 다르면 버림 |
| 저장 | 승인 상태는 서버 메모리에만 유지. 포인터는 DB·스냅샷·판서 이력에 저장하거나 재전송하지 않음 |
| 정리 | `assistance.stop`은 기능 미지원 상태에서도 기존 인증·세션 권한 아래 허용. 이전 세션의 늦은 중지가 새 공유를 지우지 않음 |

계약은 `assistance.request/respond/start/geometry/stop` 명령과 `assistance.pointer` 이벤트입니다. `MeetingSnapshot.assistance`와 `Share.assistanceId`는 기존 클라이언트에 영향을 주지 않는 optional 추가이며 배포 호환성 기준은 유지합니다. capability 정보는 권한을 부여하지 않습니다.

## 플랫폼 조건과 한계

- Android 오버레이는 `SYSTEM_ALERT_WINDOW` 허가와 전체 화면 캡처 동의가 필요합니다. 작은 `TYPE_APPLICATION_OVERLAY` 창에 터치 불가·포커스 불가·허용 투명도를 적용해 아래 앱의 터치를 통과시킵니다.
- 보호된 앱은 오버레이나 화면 캡처를 숨길 수 있습니다. 이번 Android 15 실행에서 설정 앱 홈이 외부 포인터를 숨기는 동작을 확인했습니다. [AOSP 구현](https://android.googlesource.com/platform/packages/apps/Settings/+/refs/tags/android-15.0.0_r5/src/com/android/settings/homepage/SettingsHomepageActivity.java)은 `HideNonSystemOverlayMixin`을 사용합니다. 상태 표시줄·키보드·권한 창 등 모든 시스템 UI 위 표시도 보장하지 않습니다.
- Android 14 이상은 전체 디스플레이 캡처 설정을 요청합니다. 기기가 앱 단위 공유로 바꾸거나 캡처 크기와 실제 화면이 계속 다르면 안내 세션을 중단합니다.
- 회전 버전과 영상 비율을 검사하지만 서로 다른 미디어·Socket 전송 경로의 모든 프레임을 완전히 동기화하는 것은 아닙니다. 같은 비율의 180도 회전은 500ms 유예 후에도 실제 기기·망 조건에서 확인해야 합니다.
- iOS 일반 앱이 다른 앱·홈 화면의 임의 좌표에 마크를 그리는 공개 API 구현 경로를 확인하지 못했습니다. 사용자가 Android 우선 범위를 선택했으므로 iOS 학생 수신은 제외합니다. FaceTime 자체의 화면 가리키기와 Think Meet의 공개 API 지원을 구분합니다.

근거: [Android MediaProjection](https://developer.android.com/media/grow/media-projection), [오버레이 계층](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY), [터치 통과 조건](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_NOT_TOUCHABLE), [보호 앱 오버레이 차단](https://developer.android.com/security/fraud-prevention/activities#hide_overlay_windows), [Apple 비디오콜 PiP](https://developer.apple.com/documentation/avkit/adopting-picture-in-picture-for-video-calls).

## 검증·공개

2026-11-18 웹 드래그 입력의 변경 범위와 실행 결과는 [변경 기록](changes/web-assistance-pointer-drag.json)에 남깁니다. 기존 학생 수신 코드를 사용하며 실제 Android 단말 송수신 재검증과 구분합니다.

서버의 동의·연결·권한 검사, 웹·앱 선생님 화면, Android 학생의 승인·실제 전체 화면 캡처·PiP·외부 앱 터치와 포인터·종료 처리를 검증합니다. 휴대폰/태블릿, 회전, 글자 확대, 실제 계정·동일 화면으로의 비교를 구분해 기록합니다. 검사·빌드만으로 실제 교차 단말 검증을 통과 처리하지 않습니다.

[이번 검증 기록](VERIFICATION.md#android-원격-화면-안내-2026-11-17)에 실행 결과와 남은 항목을 남깁니다. 모든 대상 검증 완료 조건을 충족하기 전에는 `in-progress`를 유지합니다. 2026-11-18 사용자 요청에 따라 구현된 기능은 환경변수 없이 기본 사용하며, 공개 상태와 검증 완료 기록을 구분합니다.

2026-11-16의 앱 내부 전용 포인터는 이번 요청과 달라 제거했습니다. [과거 기록](VERIFICATION.md#폐기한-앱-내부-포인터-2026-11-16)은 새 기능의 증거로 사용하지 않습니다.
