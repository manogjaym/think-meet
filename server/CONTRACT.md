# API·실시간 계약

REST·공유 모델의 원본은 `../contracts/openapi.json`, Socket.IO는 `../contracts/realtime.json`, 기능 공개 정책은 `../features/catalog.json`입니다. 원본을 수정한 뒤 생성하세요. `src/generated/`는 직접 수정하지 않습니다. 생성 타입은 컨트롤러, Swagger, 전송 모델, 기능 guard가 함께 사용합니다.

## 인증

- 기준 주소는 `PUBLIC_ORIGIN`입니다. 브라우저 API·Socket.IO는 같은 HTTPS 주소와 HttpOnly `think_meet_session` 쿠키를 사용합니다.
- 비밀번호는 Argon2id, 세션 쿠키는 SHA-256 해시로 저장합니다. 세션 만료는 12시간입니다.
- 데이터를 변경하는 HTTP 요청은 외부 `Origin`을 거부합니다.
- 모든 Socket.IO 명령은 저장된 세션과 수업 참여 권한을 다시 확인합니다.

## HTTP API

공통 경로는 `/api/v1`입니다. 자료 본문을 제외한 응답은 JSON이며 오류 형식은 `{code,message}`입니다. 오류 상태는 400·401·403·404·409·413·429·500이며, 클라이언트 갱신이 필요하면 426을 사용합니다. POST 성공은 201일 수 있습니다.

아래에서 **수업 교사**는 수업을 만든 `teacherId` 계정입니다. 다른 교사 계정에는 일반 참여자 권한만 있습니다.

| 메서드 | 경로 | 입력·응답·권한 |
|---|---|---|
| GET | `/health` | DB·비공개 버킷·LiveKit 준비 상태 |
| GET | `/capabilities` | 공개 `{contractRevision,features:{featureId:boolean}}`; 세션 불필요 |
| POST | `/auth/login` | `{username,password}` → User·세션 쿠키 |
| GET | `/auth/me` | User, 미인증이면 401 |
| POST | `/auth/logout` | 쿠키 세션 폐기 |
| GET | `/students` | 교사의 담당 User[] |
| GET | `/lessons` | 현재 계정의 수업 + 예정·진행 중인 모든 OPEN 수업 |
| POST | `/lessons` | LessonInput → ApiLesson |
| GET / PATCH | `/lessons/:id` | ApiLesson 조회 / LessonInput → ApiLesson 수정 |
| POST | `/lessons/:id/cancel` | 수업 교사, 예정 수업만 취소 |
| GET | `/join/:code` | 초대된 계정 또는 OPEN의 로그인 계정 → ApiLesson |
| POST | `/lessons/:id/join` | `{waiting,lesson,token?,livekitUrl?}` |
| POST | `/lessons/:id/connected` | 실제 LiveKit 접속 확인; 수업 교사가 시작하며 중복 호출 가능 |
| POST | `/lessons/:id/leave` | 현재 계정만 퇴장, 수업 유지 |
| POST | `/lessons/:id/end` | 수업 교사가 수업·전체 미디어 연결 종료 |
| POST | `/lessons/:id/kick` | `{userId}`; 수업 교사가 해당 수업 재입장 차단 |
| POST | `/lessons/:id/invites` | `{studentIds}`; 담당 학생만 초대 |
| GET | `/lessons/:id/snapshot` | Snapshot |
| GET | `/materials` | 교사의 Material[] |
| POST | `/materials` | multipart `file` → Material |
| DELETE | `/materials/:id` | 자료 소유자만 삭제, 공유 중이면 충돌 |
| GET | `/materials/:id/content?lessonId=…` | 인증된 파일 조회; 단일 byte Range·206·416 지원 |
| POST | `/webhooks/livekit` | 서명된 LiveKit 원본 webhook |

Swagger UI는 `/api/docs`, OpenAPI JSON은 `/api/openapi.json`입니다.

### LiveKit 내부 인증

`/internal/livekit-auth`는 게이트웨이 전용입니다.

- `X-Proxy-Secret`이 필요하며 원래 시그널 URI는 `X-Forwarded-Uri`로 전달합니다.
- 브라우저의 `access_token` 쿼리 또는 네이티브 SDK의 `Authorization: Bearer`를 받습니다. 두 토큰이 충돌하면 거부합니다.
- 토큰 서명과 현재 admission ID를 검사합니다. 강퇴·취소·종료·새 접속으로 대체된 입장은 차단합니다.
- 클라이언트가 LiveKit 원본 시그널 포트에 직접 접근할 수 없게 유지합니다.

## 클라이언트 호환성과 기능 공개

클라이언트는 다음 헤더를 보냅니다.

```text
X-ThinkMeet-Platform: web|android|ios
X-ThinkMeet-Contract-Revision: 1
```

플랫폼이 없거나 지원하지 않거나 형식이 틀리면 legacy revision `0`으로 처리합니다. revision이 없거나 잘못된 경우도 `0`입니다. 브라우저 WebSocket은 사용자 지정 업그레이드 헤더를 보낼 수 없으므로 Socket.IO `auth: {platform,contractRevision}`을 대신 쓸 수 있습니다. HTTP 헤더가 있으면 우선합니다.

이 값은 호환성 정보입니다. 보호된 요청의 쿠키·저장 세션·수업 참여·교사/소유자 권한 검사는 그대로 적용합니다.

| 기능 종류 | 사용 조건 |
|---|---|
| baseline | 기본 활성, legacy 클라이언트도 지원 |
| 새 기능 | 기본 비활성. catalog의 `ready`, 지원 플랫폼, 필요한 계약 revision, 서버의 명시적 활성 설정을 모두 충족 |

`THINK_MEET_FEATURE_FLAGS`에는 알려진 ID와 boolean만 지정합니다. 예: `{"meeting.pip":false}`. 생략한 항목은 baseline 기본값을 유지합니다. 잘못된 JSON·알 수 없는 ID·boolean이 아닌 값·미완성 기능 활성화는 서버 시작을 실패시킵니다.

UI를 우회해도 HTTP·실시간 명령에 같은 정책이 적용됩니다.

- 비활성·미지원 기능: `FEATURE_UNAVAILABLE` / HTTP 409
- 활성 기능이지만 클라이언트 revision 부족: `CLIENT_UPDATE_REQUIRED` / HTTP 426
- Socket 명령 ack: 같은 오류 코드 사용
- 거부된 임시 판서 미리보기: `room:error` 전송

`GET /capabilities`는 현재 계약 revision과 해당 클라이언트의 기능별 사용 가능 여부만 공개합니다. 내부 플래그 설정, 준비 상태 메모, 환경값, 인증 정보는 노출하지 않습니다. health·로그인/로그아웃·세션 조회·capabilities는 공통 계약에서 기능 제한 대상에서 제외합니다. 새 클라이언트용 HTTP 핸들러는 먼저 공통 계약에 등록해야 합니다.

`classroom.core`를 꺼도 정리 동작인 `leaveLesson`, `endLesson`, `share.stop`은 허용합니다. 기존 인증과 수업 소유자·공유자 권한은 계속 필요합니다. 입장·채팅 등은 기능 제한을 받습니다.

## 데이터 모델

### 계정·수업

- **User:** `{id,username,name,role:'teacher'|'student'}`
- **LessonInput:** `{title,description?,startsAt,endsAt,accessMode?,studentIds?}`
  - `accessMode`: `INVITE_ONLY|OPEN`. 기존 클라이언트의 기본값은 `INVITE_ONLY`입니다.
  - 예약에는 제목과 미래의 시작 시각이 필요합니다. 입력 ISO8601 시각에는 offset이 있어야 합니다.
  - `INVITE_ONLY`에는 담당 학생이 1명 이상 필요합니다. `OPEN`은 `studentIds` 생략·빈 배열을 허용합니다. 전달한 학생 ID는 모두 생성자의 담당 학생이어야 합니다.
  - `endsAt`은 필수입니다. `startsAt`보다 늦은 ISO8601 시각 또는 명시적 `null`을 받습니다. `null`이면 수업 소유자가 종료할 때까지 유지합니다.
- **ApiLesson:** `{id,title,description,accessMode,teacher:User,students:User[],startsAt,endsAt,status,code,startedAt,endedAt,participants,attendance}`
  - `accessMode`: `INVITE_ONLY|OPEN`, `status`: `SCHEDULED|LIVE|ENDED|CANCELLED`
  - `participants`: `{userId,joinedAt}[]`
  - `attendance`: 모든 입퇴장 구간 `{userId,joinedAt,leftAt:null|string}[]`. 재입장 시간도 계산할 수 있습니다.
  - `endsAt:null`은 예정 종료 없음입니다. 그 외 시각은 UTC ISO 문자열입니다.
  - OPEN의 `students`에는 입장해 등록된 계정이 포함되며, 다른 교사 계정도 포함됩니다.

### 공유·판서·상태

| 모델 | 필드·의미 |
|---|---|
| Material | `{id,name,type:'media'\|'document',size,duration?,pages?,createdAt}` |
| Share | `{id,type:'screen'\|'media'\|'document',ownerId,materialId?,material?,page,playing,position,updatedAt}`. 영상 `position`은 초 단위이며 서버 `updatedAt` 기준 |
| Stroke | `{id,authorId,shareId,page,tool:'pen'\|'highlighter',color,points:{x,y}[],deleted}`. 좌표는 여백을 뺀 원본 콘텐츠 영역 기준 `[0,1]` |
| Snapshot | `{lessonId,lesson,participants:{user,online,raised}[],messages,share,strokes,seq,serverTime}` |

Snapshot의 `messages`는 최신 100개를 시간순으로 담습니다. 각 메시지는 `{id,clientId,userId,userName,text,createdAt}`입니다. 저장되는 수업별 `seq`는 변경이 확정될 때마다 증가합니다.

## Socket.IO

기본 경로는 `/socket.io`이며 세션 쿠키로 연결합니다.

```text
구독: emit('subscribe',{lessonId},ack)
명령: emit('command',{lessonId,type,payload,requestId?},ack)
성공 ack: {ok:true,snapshot}
실패 ack: {ok:false,error:{code,message}}
```

- 확정된 변경은 수업 참여자에게 `snapshot`으로 전달합니다.
- `lessons:changed`는 계정 소켓에 홈 목록 갱신을 알립니다.
- `room:error`는 세션 만료·권한 없음·강퇴 오류를 알립니다.
- LiveKit의 중복 identity 연결 해제는 이전 미디어 탭에 새 접속으로 대체되었음을 알립니다.

| 명령 | payload·권한 |
|---|---|
| `chat.send` | `{text,clientId}`; 고정 client ID로 중복 메시지 방지 |
| `hand.set` | `{raised:boolean}` |
| `share.start` | `{type,materialId?}`; 문서·영상은 수업 교사만 |
| `share.stop` | `{}`; 공유자 또는 수업 교사 |
| `media.update` | `{playing,position}`; 수업 교사만 |
| `document.page` | `{page}`; 수업 교사만 |
| `stroke.add` | `{id,shareId,page,tool,color,points}`; 같은 ID의 재요청은 중복 저장하지 않음 |
| `stroke.erase` | `{ids:string[]}`; 학생은 자기 판서, 수업 교사는 모든 판서 |
| `annotation.undo` / `annotation.redo` | `{}`; 지우개를 포함한 자기 작업. 재시작 후에도 기록 유지 |
| `annotation.clear` | `{}`; 수업 교사는 페이지 전체, 학생은 자기 판서 삭제. 되돌릴 수 없음 |

선택적 이벤트 `stroke.preview`는 `{lessonId,shareId,page,tool,color,points}`를 받고 `authorId`를 붙여 임시 미리보기를 전달합니다. 인증·참여 권한·크기 제한·호출 빈도 제한을 적용합니다. 최종 저장은 반드시 `stroke.add`로 합니다.

## 수업·자료 수명 주기

### 입장·종료

- 수업 교사의 실제 LiveKit 접속이 확인될 때까지 학생은 대기합니다. 교사 연결이 끊겨도 수업은 종료하지 않습니다.
- 참여자 이벤트와 10초 간격 보정으로 출결을 유지합니다.
- 공유자가 예기치 않게 끊기면 30초간 복구를 기다립니다. 의도적 퇴장은 자기 공유를 즉시 중지하고, 화면 공유 트랙 종료는 해당 화면 공유를 즉시 정리합니다.
- 전체 종료·강퇴 시 게이트웨이에서 기존 토큰도 차단합니다. 새 입장마다 admission ID를 바꾸므로 이전 토큰으로 연결을 되찾을 수 없습니다.

### 공개 수업

- OPEN 수업은 `SCHEDULED`·`LIVE` 동안 모든 로그인 계정에 보입니다. 손님 계정은 만들지 않습니다.
- 입장 요청 시 대기·입장 응답 전에 계정을 등록합니다. 이후 snapshot·수업 기록에 포함됩니다.
- `teacherId`만 수업을 관리합니다. 다른 교사는 시작·종료·초대·강퇴·자료 제어·타인 판서 삭제를 할 수 없습니다.
- 강퇴된 계정은 OPEN에도 재입장할 수 없습니다.
- OPEN 수정은 등록 계정과 강퇴 상태를 유지합니다. `INVITE_ONLY`로 전환하면 소유자와 선택한 담당 학생만 남깁니다.
- OPEN 생성·공개 방식 변경·시작·종료 시 모든 연결 계정에 목록 갱신을 알립니다.

### 파일 저장

- 교사만 비공개 PDF(최대 50MiB)·MP4(최대 500MiB)를 올릴 수 있습니다.
- PDF는 파싱 가능하고 암호화되지 않아야 합니다. MP4는 ffprobe로 H.264 영상과 AAC 오디오(또는 오디오 없음)를 확인합니다.
- 업로드 성공·실패 모두 임시 파일을 삭제합니다. 최종 저장 실패·취소 시 S3 객체도 삭제합니다.
- 참여자는 강퇴되지 않은 등록 계정이며, LIVE 수업에서 해당 자료를 공유 중일 때만 읽을 수 있습니다.
- 파일은 인증된 HTTPS API로 스트리밍합니다. 공개 MinIO URL은 사용하지 않습니다.

## 계정 관리

`npm run seed`는 `SEED_PASSWORD`로 최초 계정을 만듭니다. 기존 계정 비밀번호·수업은 덮어쓰지 않습니다. 비밀번호는 7~200자이며 로컬 교사·일반 학생·가상 학생의 테스트 기본값은 `test123`입니다.

서비스 컨테이너 또는 서비스 환경변수가 설정된 환경에서 실행합니다.

```sh
USER_PASSWORD=… npm run cli -- user:add <username> <teacher|student> <name>
USER_PASSWORD=… npm run cli -- user:reset <username>
USER_PASSWORD=… npm run cli -- user:reset-all
npm run cli -- roster:add <teacher username> <student username>
npm run cli -- users
```

`user:reset`은 해당 계정의 로그인 세션도 폐기합니다. `user:reset-all`은 모든 비밀번호 변경·세션 폐기를 원자적으로 처리합니다. `users`는 공개 계정 필드만 출력합니다.

`.env`, 생성된 LiveKit 비밀값, 개인 자격 증명, CA 개인키, 실행 중 생성 파일은 커밋하지 않습니다.

## 검증

| 명령 | 범위·준비 조건 |
|---|---|
| `npm run generate && npm run build && npm test` | Prisma 클라이언트 생성·타입 검사·권한/상태/토큰/동시성 단위 테스트. 갱신 서버를 시작하기 전에 `npm run migrate` 적용 |
| `npm run test:integration` | 정상 Compose 상태에서 `server/` 기준 실행. `../infra/local/.env`와 형제 `web/`의 Playwright 설치 사용. 실제 HTTPS·브라우저·API·LiveKit·MinIO 검증 |
| `OPEN_TEST_DATABASE_URL=… OPEN_TEST_LIVEKIT_URL=… node --test test/open-lessons.integration.mjs` | 최신 빌드와 마이그레이션된 격리 PostgreSQL·LiveKit 필요. OPEN·INVITE_ONLY 회귀 검증 |

일반 통합 테스트는 예약·초대 권한, 실제 LiveKit 입장, PDF 파싱·byte Range, 잘못된 파일·업로드 취소, 페이지 권한, 공유 중 삭제 차단을 확인합니다. 새 소켓에서도 유지되는 판서 추가/지우기 실행취소·다시실행, 채팅 중복 방지, 손들기, 전체 종료도 검사합니다. 테스트 수업은 구분되는 이름으로 만들고 종료·취소하며 업로드 파일을 정리합니다.

공개 수업 테스트는 빈 localhost 포트에 임시 API를 실행합니다. 목록·대기·소유자 실제 입장·다른 교사 권한·강퇴/기존 토큰 차단·공개 방식 변경·종료 기록을 확인한 뒤 자체 데이터만 삭제합니다. LiveKit 기본 개발 키는 `devkey`/`secret`이며 `OPEN_TEST_LIVEKIT_KEY`, `OPEN_TEST_LIVEKIT_SECRET`으로 바꿀 수 있습니다.

통합 브라우저는 테스트 미디어와 개발 CA를 자동화용으로 허용합니다. 실제 카메라·마이크, 브라우저 화면 선택기, 다른 LAN 기기의 CA 신뢰 설치는 별도로 확인해야 합니다.

## 가상 학생 수업

```sh
LOAD_TEST_PASSWORD=test123 node dist/cli.js load:prepare [count]
```

- 전용 학생 1~100명, 기본 10명을 준비합니다. 비밀번호는 7~200자입니다.
- 계정은 `load_student_001`~`load_student_100`, 이름은 `가상 학생 001` 형식입니다. `load:prepare`는 일반 교사·학생 계정을 수정하지 않습니다.
- 학생을 `teacher1`에 연결하고 설명이 `가상 학생들이 영상을 보내는 테스트 수업입니다. 교사가 종료할 때까지 유지됩니다.`인 수업에 초대합니다.
- 이전 설명 `GURUMI_LOAD_TEST` 수업도 재사용하며 위 설명으로 바꿉니다. `SCHEDULED`·`LIVE`만 재사용하고 `ENDED`·`CANCELLED`는 다시 열지 않습니다. 강퇴 상태도 초기화하지 않습니다.
- `../infra/local/loadtest/manage.py`는 교사·학생 로그인에 `test123`을 쓰며 매 시작 시 생성 환경 파일을 동기화합니다.

CLI는 자격 증명 없이 `{lessonId,code,title,teacherUsername,studentUsernames}` JSON만 출력합니다. 수업은 `endsAt:null`, `SCHEDULED`로 생성됩니다. 정상 교사 로그인·입장 승인·실제 LiveKit 접속을 거쳐야 학생이 입장합니다. 인증·권한을 우회하지 않습니다. LIVE 이후 자동 종료하지 않으며 교사의 일반 종료 동작으로 닫습니다. 운영은 [가상 학생 운영 안내](../infra/local/loadtest/README.md)를 참고하세요.
