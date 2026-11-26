# 수업 중 과목 변경

선생님은 진행 중인 수업에서 과목을 바꿀 수 있습니다. 넓은 화면은 오른쪽 **수업 자료** 카드의 **과목 선택**, 휴대폰 폭은 **더보기 → 과목 선택**을 씁니다(넓은 화면의 더보기에도 있음). 과목을 바꾸면 지금 수업을 마치고 같은 참여자로 새 과목의 수업을 이어 갑니다. 영상 연결과 녹화는 끊기지 않고, 화면 공유와 미러링은 끝납니다. 기능 ID는 `classroom.subject-switch`, 계약 revision은 17입니다.

## 동작

1. **과목 선택**을 누르면 수업 예약과 같은 과목 팝업이 열립니다. 현재 과목에 선택 표시가 있고 `선택 안 함`은 없습니다. 현재 과목을 다시 누르면 아무 일도 일어나지 않습니다.
2. 다른 과목을 고르면 **{과목} 수업으로 바꿀까요?** 확인 창이 열립니다. 화면 공유·미러링 중이면 "진행 중인 화면 공유와 학생 화면 보기(미러링)는 끝나요.", 녹화 중이면 "녹화는 멈추지 않고 이전 수업과 새 수업 영상으로 나눠 저장해요."를 덧붙입니다. **취소**를 누르면 과목 팝업으로 돌아갑니다. 휴대폰 폭에서는 과목 카드를 한 줄에 하나씩 보여 줍니다.
3. **과목 바꾸기**를 누르면 서버가 지금 수업을 종료하고 새 수업을 시작합니다.
4. 선생님과 수업에 연결된 학생의 화면은 그대로 유지됩니다. 머리글의 과목과 수업 시간만 바뀌고 **{과목} 수업을 시작했어요.** 안내가 나옵니다. 웹 주소는 새 수업으로 바뀝니다.

| 항목 | 새 수업 |
|---|---|
| 그대로 이어짐 | 영상 방(LiveKit)과 각 참여자의 연결·입장 정보, 마이크·카메라, 제목·내용·참여 방식, 참여자(퇴장당한 학생은 계속 입장 불가), 학생별 판서 허용, 수업 모드 |
| 새로 정함 | 과목, 참여 코드, 시작 시각(바꾼 시각), 수업 시간 표시 |
| 종료 시각 | 이전 수업의 종료 예정 시각이 아직 지나지 않았으면 유지하고, 지났으면 비웁니다. |
| 끝남·비워짐 | 화면 공유·교재 공유와 그 판서, 화면 보기(미러링) 요청과 학생 화면 공유, 채팅 |

## 자료·녹화 보관

과목을 바꾼 뒤 저장하는 화면, 학습지·첨삭, 교재 업로드, 녹화는 새 수업과 새 과목에 연결됩니다. 이전 수업은 이전 과목으로 **지난 수업**·**수업 노트**에 남습니다.

녹화는 화면 캡처를 멈추지 않고 파일만 나눕니다. 이전 파일은 이전 수업으로, 새 파일은 새 수업으로 올라가며 다시 묻지 않습니다.

| 플랫폼 | 방법 |
|---|---|
| 웹(PC Chrome·Edge) | 같은 탭 캡처로 MediaRecorder를 새로 시작합니다(`handoffRecording`). |
| Android | 같은 MediaProjection과 VirtualDisplay를 새 인코더에 연결합니다(`VirtualDisplay.setSurface`). OS 동의를 다시 받지 않습니다. |
| iOS | ReplayKit 캡처를 유지하고 AVAssetWriter만 새 파일로 바꿉니다. |

파일을 나누지 못하면(예: Android에서 OS가 이미 캡처를 끝낸 상태) 이전 녹화를 마치고 **화면 녹화를 진행할까요?** 창을 다시 띄웁니다.

## 계약·서버

- `POST /api/v1/lessons/{id}/subject-switch`(`switchLessonSubject`), 요청 `LessonSubjectSwitchInput { subjectId }`, 응답은 새 `Lesson`입니다.
- 종료된 수업의 `Lesson.nextLessonId`가 새 수업을 가리킵니다. DB는 `Lesson.nextLessonId`(고유, 마이그레이션 `20261126100000_lesson_subject_switch`)에 저장합니다.
- 서버(`server/src/lessons.ts`의 `switchSubject`)는 수업 잠금 안에서 **한 트랜잭션**으로 처리합니다.
  1. 이전 수업을 종료하고 방 이름을 놓습니다.
  2. 새 수업이 같은 방 이름을 이어받습니다. 참여자의 입장 ID·접속 상태와 열린 출석(LiveKit 참여자 SID 포함)을 옮깁니다. 공유는 옮기지 않습니다.
  3. LiveKit 방은 지우지 않으므로 토큰 검사·재연결·웹훅이 새 수업으로 이어집니다.
- 공유가 없는 새 수업 스냅숏을 받으면 클라이언트가 화면 공유·미러링 캡처를 멈춥니다. 영상 연결(카메라·마이크)은 유지합니다.
- 웹(`useMeeting`)과 앱(`MeetingSession`·`MeetingRealtime`)은 ENDED에 `nextLessonId`가 있는 스냅숏을 받으면 같은 소켓을 새 수업에 구독합니다. 그 뒤 `connectedLesson`·`getSnapshot`으로 확인하고 영상 연결은 그대로 둡니다. 이 과정이 실패하면 새 수업에 다시 입장합니다(잠깐 끊김).
- 이전 수업의 참여 코드·링크는 새 수업을 엽니다(`resolveLesson`이 `nextLessonId`를 따라감).

| 요청 | 결과 |
|---|---|
| 수업 소유 선생님이 아님 | `FORBIDDEN` 403 |
| 진행 중(LIVE)이 아니거나 이미 과목을 바꾼 수업 | `CONFLICT` 409 |
| 현재 과목과 같음, 잘못된 ID | `VALIDATION` 400 |
| 선생님에게 등록되지 않은 과목 | `FORBIDDEN` 403 |
| revision 16 이하 클라이언트 | `CLIENT_UPDATE_REQUIRED` 426 |

## 화면

웹 `web/src/components/meeting/SubjectSwitch.tsx`와 앱 `MeetingScreen.kt`가 같은 과목 팝업(`LessonSubjectDialog`·`LessonSubjectPickerDialog`)과 문구(`design/system.json`의 `meetingSubjectSwitch*`)를 사용합니다.

수업 화면이 같은 영상 방을 유지하도록 화면을 처음 입장한 수업 기준으로 둡니다. 웹은 `AppScreen`의 `meetingKey`, 앱은 `Route.Meeting.continued`와 입장 수업 ID의 `key`를 씁니다.

## 한계

- 화면 공유와 미러링(학생 화면 보기)은 끝나므로 새 수업에서 다시 시작해야 합니다.
- 과목을 바꾼 순간 연결이 끊겨 있던 참여자는 다시 접속하면 이전 수업이 끝났다고 보입니다. 홈의 진행 중인 수업이나 기존 링크로 새 수업에 들어올 수 있습니다.
- revision 16 이하 앱의 학생은 새 수업으로 이어지지 않고 종료 화면을 봅니다. 영상 방에서 나간 뒤 홈에서 새 수업에 다시 들어와야 합니다.

## 검증

검사 명령과 결과는 [변경 기록](changes/lesson-subject-switch.json)에 있습니다. 공용 DB를 복제한 격리 환경에서 서버·웹·Android를 실제로 실행해 확인했습니다. iOS는 Kotlin 컴파일만 했고, Swift 녹화 코드는 이 Linux 환경에서 컴파일하지 못했습니다. 실제 iPhone·iPad 실행 전까지 `in-progress`로 둡니다.

| 화면 | 휴대폰 | 태블릿·PC |
|---|---|---|
| 더보기 메뉴 | [웹 선생님 390×844](evidence/lesson-subject-switch/web-phone-teacher-more.png) | |
| 과목 팝업 | [웹](evidence/lesson-subject-switch/web-phone-teacher-picker.png) | [웹 1280×800](evidence/lesson-subject-switch/web-desktop-picker.png) · [Android 180dpi](evidence/lesson-subject-switch/android-tablet-picker.png) |
| 확인 창 | [웹](evidence/lesson-subject-switch/web-phone-teacher-confirm.png) | [웹(공유·녹화 안내)](evidence/lesson-subject-switch/web-desktop-confirm.png) · [Android](evidence/lesson-subject-switch/android-tablet-confirm.png) |
| 변경 후 | [웹 선생님](evidence/lesson-subject-switch/web-phone-teacher-after.png) | |
| 화면 공유 중 변경 전·후 | [웹 학생 전](evidence/lesson-subject-switch/web-phone-before.png) · [후(공유 끝남)](evidence/lesson-subject-switch/web-phone-after.png) | [웹 선생님 전](evidence/lesson-subject-switch/web-desktop-before.png) · [후](evidence/lesson-subject-switch/web-desktop-after.png) · [웹 학생 834×1194](evidence/lesson-subject-switch/web-tablet-after.png) |
| 녹화 이어짐 | | [Android 선생님 변경 후 녹화 중](evidence/lesson-subject-switch/android-tablet-after.png) · [웹 종료·업로드](evidence/lesson-subject-switch/web-desktop-ended.png) |
