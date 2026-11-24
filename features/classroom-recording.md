# 수업 화면 녹화

선생님 앱(Android·iOS)과 PC 웹(Chrome·Edge)이 수업 화면과 소리를 기기에서 녹화하고, 수업에서 나오면 서버에 올립니다. 선생님은 웹과 앱의 수업 상세에서 30일 동안 다시 봅니다.

## 동작

1. 수업 소유 선생님이 앱·웹의 입장 화면에서 **수업 시작**(진행 중이면 **지금 참여하기**)을 누르면 **화면 녹화를 진행할까요?** 창이 열립니다. **녹화하고 시작** 또는 **녹화 없이 시작**을 고릅니다. 창을 닫으면 입장하지 않습니다.
2. 녹화를 고르면 앱은 영상 연결 후 OS 화면 녹화 동의 창을, 웹은 그 클릭에서 바로 Chrome 공유 창(이 탭 선택)을 엽니다. Chrome은 사용자 클릭 직후에만 공유 창을 허용하므로 웹은 입장 전에 엽니다. 거절하면 안내 후 녹화 없이 수업합니다.
3. 녹화 중에는 수업 상단에 **녹화 중**(좁은 화면 `REC`)을 표시합니다. OS·Chrome도 자체 녹화·공유 표시를 보여 줍니다. 웹 확인 창에는 "녹화 중에는 이 탭을 닫지 마세요" 안내를 덧붙이고, 녹화 중 탭을 닫으려 하면 브라우저가 확인을 묻습니다.
4. 수업 종료·퇴장·강퇴·연결 종료 시 녹화를 마치고 업로드 대기열에 넣습니다. 종료 화면과 수업 상세에 진행률을 표시합니다.
5. 업로드를 마치면 기기의 파일을 지웁니다. 실패하면 30초부터 최대 5분 간격으로 다시 시도하고, **다시 올리기**로 바로 시도할 수 있습니다. 앱이나 같은 브라우저를 다시 열면 이어서 올립니다.

학생 계정과 다른 선생님에게는 녹화 확인 창이 없습니다. Safari·Firefox와 휴대폰·태블릿 브라우저는 탭 화면과 소리를 함께 녹화할 수 없어 확인 창 없이 입장하고, 다시 보기만 제공합니다. 웹 녹화는 확장 프로그램 없이 `getDisplayMedia`(현재 탭)와 MediaRecorder를 사용합니다.

## 압축 기준

기기에서 녹화하면서 바로 압축하므로 서버의 재인코딩이 없습니다. 값은 `RecordingProfile`(Kotlin), `LessonRecorder.swift`, `web/src/lib/lessonRecording.ts`에 같게 둡니다.

| 항목 | 값 |
|---|---|
| 영상 | H.264, 긴 변 1280·짧은 변 720 이하(16의 배수), 최대 15fps, 평균 700kbps, 키프레임 4초 |
| 소리 | 64kbps. 앱은 AAC-LC 모노 48kHz로 다른 참여자 소리(LiveKit 재생 음성)와 선생님 마이크를 섞음. 웹은 탭 소리(참여자·공유 영상)와 선생님 마이크를 섞고, 브라우저가 AAC를 지원하면 AAC, 아니면 Opus(MP4 안)로 저장 |
| 크기 | 상한은 1시간 약 340MB. Android 에뮬레이터 실측 75초 2.2MB(영상 173kbps, 평균 약 9fps)로 1시간 약 110MB. 화면 변화가 많으면 커짐 |

## 권한·보관

| 항목 | 규칙 |
|---|---|
| 업로드 | 수업 소유 선생님만, 시작된 수업(`startedAt` 있음)에만 가능 |
| 조회·재생 | 녹화한 선생님 본인만. 다른 선생님·학생은 404 |
| 보관 | 업로드 시작 시각부터 30일. 서버가 1시간마다 만료 항목의 S3 객체·미완료 multipart를 지우고 행을 삭제 |
| 크기 제한 | 파일 4GiB, 길이 8시간 |

## 통신

계약 revision 14가 필요합니다. [계약 원본](../contracts/openapi.json)의 `recordings` 태그를 따릅니다.

1. `POST /lessons/{id}/recordings`: 크기·길이·해상도와 `requestId`로 업로드를 만듭니다. 같은 `requestId`는 저장된 진행 상태를 돌려줍니다.
2. `PUT /recordings/{id}/content?offset=N`: `chunkSize`(8MiB) 단위로 순서대로 올립니다. 이미 받은 조각을 다시 보내면 현재 상태를, 위치가 다르면 `RECORDING_OFFSET`(409)을 돌려줍니다. 마지막 조각에서 S3 multipart를 완료합니다. 첫 조각은 MP4(`ftyp`)인지 확인합니다.
3. `GET /recordings?lessonId=`: 본인 녹화 목록(업로드 중 포함).
4. `GET /recordings/{id}/content`: Range 재생. 브라우저 `<video>`는 헤더를 보낼 수 없으므로 GET에 한해 `platform`·`contractRevision` 쿼리를 기능 확인에 사용합니다. 헤더가 있으면 헤더가 우선합니다. 쿼리는 권한을 주지 않습니다.

## 플랫폼별 구현

| 플랫폼 | 구현 |
|---|---|
| 서버 | `server/src/recordings.ts`, `LessonRecording` 테이블(`20261124000000_lesson_recordings`) |
| 웹 | 입장 화면 녹화 확인 창, 현재 탭 캡처(`getDisplayMedia`)·WebAudio 소리 섞기·MediaRecorder(H.264 MP4) → 브라우저 전용 저장소(OPFS) → 조각 업로드. 수업 상세의 **수업 녹화** 목록·재생 창, 종료 화면 업로드 상태 |
| Android | MediaProjection → 하드웨어 H.264 인코더, LiveKit 재생 음성 콜백·마이크 sink → AAC, MediaMuxer. 녹화 중 `mediaProjection` 포그라운드 서비스와 알림 |
| iOS | ReplayKit 앱 내 캡처 → AVAssetWriter, LiveKit `AudioManager`의 원격·로컬 오디오 렌더러 → AAC. 재생은 AVPlayerViewController |

## 한계

- Android에서 선생님이 기기 화면 공유를 시작하면 OS가 녹화용 화면 캡처를 끝냅니다. 소리는 계속 녹음되고 영상은 마지막 화면에서 멈춥니다. 공유를 끝낸 뒤 **이어서 녹화**로 다시 허용합니다.
- Android 14 이상에서는 동의 창에서 "앱 하나"를 고르면 이 앱만 녹화합니다. "전체 화면"을 고르면 알림·다른 앱도 녹화됩니다.
- iOS 앱 내 캡처는 앱이 백그라운드(PiP 포함)일 때 화면 프레임을 받지 못합니다. 그동안 영상은 멈추고 소리는 계속 기록되도록 구현했으나 실제 기기에서 확인하지 않았습니다.
- 녹화 중 앱이 강제 종료되면 MP4를 마무리하지 못해 그 녹화는 남지 않습니다.
- 업로드는 앱이 실행 중일 때만 진행합니다. 앱을 닫으면 다음 실행 때 이어서 올립니다.
- 웹은 녹화 중 탭을 닫거나 브라우저가 종료되면 그 녹화가 남지 않습니다. 업로드는 같은 브라우저·같은 계정으로 사이트를 다시 열 때 이어서 진행합니다. Chrome의 **공유 중지**를 누르면 그때까지의 녹화를 마치고 올립니다(이어서 녹화 없음).
- 웹에서 스피커를 "음소거"로 바꾸면 탭 소리가 나오지 않아 참여자 소리도 녹음되지 않습니다.

## 검증 기록

2026-11-24 한국 시간, 로컬 스택(PostgreSQL·MinIO·LiveKit)의 API·웹 컨테이너를 새 이미지로 재배포해 확인했습니다. 마이그레이션 `20261124000000_lesson_recordings`가 적용됩니다. [변경 기록](changes/classroom-recording.json)

| 범위 | 결과 |
|---|---|
| 공통·서버·웹 검사 | 저장소 루트 `npm run shared:check`, `npm run verify` 통과(공통 13, 서버 73, 웹 19, 서버·웹 타입 검사, Vite 빌드). 서버 `test/recordings.test.ts` 4개: 조각 업로드·재전송·위치 오류·완료 1회, 소유자 외 차단, 30일 만료 정리, 미디어 GET 쿼리 기능 확인 |
| 서버 실환경 | 10MB MP4로 생성·같은 `requestId` 재요청·8MiB 조각·재전송·`RECORDING_OFFSET`·완료, 목록, 헤더 없는 Range 재생(206), 전체 다운로드 바이트 일치, 비로그인 401, 학생 목록 403·재생 404 |
| 웹 | Vite 개발 서버와 로컬 API, teacher1 계정. 1280×800·390×844에서 수업 녹화 목록과 재생 창 확인, `<video>` 재생 진행(40초, 720×1280) |
| Android | 기존 Android 35 에뮬레이터(1080×2400, 420dpi). 녹화 확인 창 → OS 동의(전체 화면) → `REC` 표시·`mediaProjection` 포그라운드 서비스 → 모두 종료 → 종료 화면 업로드 진행·완료 → 기기 파일 삭제. 서버 파일 ffprobe: H.264 576×1280, AAC 모노 48kHz, 75초. 수업 상세 목록·앱 내 재생 확인. 1536×1350·240dpi 태블릿 폭 확인 후 원래 설정 복원. 단위 테스트 50개(업로드 대기열 2개 포함)·Debug APK 통과 |
| 웹 녹화 | Playwright Chromium 159(Xvfb, 탭 공유 자동 허용·가짜 카메라/마이크, 로컬 CA 대신 인증서 검사 해제)로 teacher1 흐름 실행. 1280×800·390×844에서 확인 창 → 녹화 중 표시 → 모두 종료 → 종료 화면 업로드 완료 → 브라우저 저장소 파일 삭제. 서버 파일 ffprobe: H.264 1152×720, Opus(이 Chromium은 AAC 인코딩 미지원), 17초, 소리 평균 -17.5dB |
| iOS | Linux 환경이라 Kotlin iOS 프레임워크·Swift 호스트 빌드와 실행 모두 미실행 |

화면 증거: [웹 태블릿 목록](evidence/classroom-recording/web-tablet-detail.png) · [웹 태블릿 재생](evidence/classroom-recording/web-tablet-player.png) · [웹 휴대폰 목록](evidence/classroom-recording/web-phone-detail.png) · [웹 휴대폰 재생](evidence/classroom-recording/web-phone-player.png) · [웹 태블릿 녹화 확인 창](evidence/classroom-recording/web-tablet-prompt.png) · [웹 태블릿 녹화 중](evidence/classroom-recording/web-tablet-recording.png) · [웹 태블릿 업로드 완료](evidence/classroom-recording/web-tablet-ended-uploaded.png) · [웹 휴대폰 녹화 확인 창](evidence/classroom-recording/web-phone-prompt.png) · [웹 휴대폰 녹화 중](evidence/classroom-recording/web-phone-recording.png) · [웹 휴대폰 업로드 완료](evidence/classroom-recording/web-phone-ended-uploaded.png) · [Android 녹화 확인 창](evidence/classroom-recording/android-phone-prompt.png) · [Android 녹화 중](evidence/classroom-recording/android-phone-recording.png) · [Android 업로드 중](evidence/classroom-recording/android-phone-uploading.png) · [Android 업로드 완료](evidence/classroom-recording/android-phone-uploaded.png) · [Android 휴대폰 목록](evidence/classroom-recording/android-phone-detail.png) · [Android 재생](evidence/classroom-recording/android-phone-player.png) · [Android 태블릿 폭 목록](evidence/classroom-recording/android-tablet-detail.png)

미검증: iOS 빌드·실행 전체, 실제 Chrome·Edge의 공유 창 수동 선택과 AAC 녹음, 웹 공유 창 거절, 공유 영상 소리의 웹 녹음, Android 실기기, 다른 참여자가 있는 수업의 소리 섞임(에뮬레이터에는 원격 참여자가 없음), 녹화 중 기기 화면 공유 후 **이어서 녹화**, 업로드 중 앱 종료 후 재개, 30일 만료 정리의 실제 시간 경과, 원격 CI. 이 항목을 확인하기 전까지 `in-progress`로 둡니다.
