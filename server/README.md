# Think Meet 수업 서버

NestJS·Prisma로 인증·권한·수업 상태·자료를 처리합니다. API 소스, Prisma 스키마·마이그레이션, 계정 CLI와 서버 Dockerfile을 이 폴더에서 관리합니다.

로컬 서비스의 시작·중지·계정 관리·백업·가상 학생 실행은 [infra/local 안내](../infra/local/README.md)를 따릅니다. Docker Compose와 로컬 `.env`도 `infra/local/`에 있습니다.

## 수업 이용·권한

### 입장과 종료

| 참여 방식 | 입장 가능 계정 |
|---|---|
| 참여자 선택 | 지정한 담당 학생 등 초대된 계정만 목록·링크로 입장 |
| 누구나 참여 | 로그인한 학생·교사 누구나 예정·진행 중 목록 또는 링크·코드로 입장. 학생 사전 선택 불필요 |

비로그인 손님은 입장할 수 없습니다. 종료된 공개 수업은 실제 참여한 계정의 기록에 남습니다.

수업을 만든 교사의 실제 LiveKit 연결 전에는 다른 참여자가 대기합니다. 수업은 예정 시각보다 일찍 시작할 수 있습니다. 예정 종료 시각이 지나거나 교사가 잠시 끊겨도 자동 종료하지 않으며, 수업 교사의 **모두 종료**로 닫습니다.

다른 교사 계정은 일반 참여자입니다. 수업 관리·강퇴·전체 종료는 수업을 만든 교사만 할 수 있습니다.

### 공유·자료·복구

- 모두 화면 공유·판서를 할 수 있습니다. 활성 공유는 하나이며 새 공유가 이전 공유를 대체합니다.
- 수업 교사는 자료·영상 재생·PDF 페이지·모든 공유 중지를 제어합니다. 다른 참여자는 자기 화면 공유를 중지할 수 있습니다.
- 판서 실행취소·다시실행은 작성자별입니다. 수업 교사는 전체 판서를 삭제할 수 있습니다.
- PDF는 최대 50MiB, MP4는 최대 500MiB입니다. 서버가 PDF 암호화·손상과 MP4 H.264 영상/AAC 오디오를 검사합니다.
- 공유 중인 자료는 공유를 중지한 뒤 삭제합니다. 조회·Range 스트리밍은 인증된 HTTPS API로 처리합니다. 브라우저가 HTTP MinIO에 직접 접근하지 않습니다.
- 같은 계정이 같은 수업에 다시 입장하면 새 연결이 이전 연결을 대체합니다. 강퇴 계정은 해당 수업에 재입장할 수 없습니다.
- 개인 퇴장은 전체 수업을 종료하지 않습니다. 출결은 입퇴장 구간으로 저장하며 채팅·페이지·영상 위치·판서는 재접속 시 복원합니다.
- 화면 송출 장치는 실제 브라우저 선택기에서 고릅니다.

## 개발·검증

Node.js 22.22 이상이 필요합니다. 실행은 Docker를 권장합니다. API·Socket.IO·데이터 형식은 [CONTRACT.md](CONTRACT.md)에 있습니다.

| 위치 | 기본 검증 |
|---|---|
| `server/` | `npm ci`, `npm run generate`, `npm run build`, `npm test` |
| `web/` | `npm ci`, `npm run typecheck`, `npm run build` |

Vite는 `/api`, `/socket.io`를 로컬 HTTPS 서비스에 전달합니다. 주소가 다르면 `THINK_MEET_API_ORIGIN`을 지정하세요.

### 공개 수업 마이그레이션

갱신 API를 시작하기 전에 `DATABASE_URL` 대상에 `npm run migrate`를 적용합니다. `20261109000000_open_lessons`는 기존 수업을 `INVITE_ONLY`로 유지하며 참여 방식 필드를 추가합니다. 로컬 직접 실행은 `npm run generate`로 Prisma 클라이언트도 갱신하세요. [`../infra/local/scripts/start.sh`](../infra/local/scripts/start.sh)는 이미지 빌드·마이그레이션을 포함합니다. 직접 마이그레이션할 때는 `DATABASE_URL`을 환경 변수로 주입해야 합니다. 예: `DATABASE_URL=postgresql://… npm run migrate`.

### 실제 인프라 테스트

```sh
# server/: 실제 API·LiveKit·MinIO
npm run test:integration

# web/: 실제 다중 브라우저
cd ../web
npx playwright install chromium
npm run test:e2e
```

공개 수업만 별도 검증하려면 최신 빌드, Chromium, 마이그레이션된 **격리 PostgreSQL·LiveKit**을 준비하고 서버 폴더에서 실행하세요. LiveKit의 시그널·RTC TCP·UDP 포트가 모두 브라우저에 연결되어야 합니다.

```sh
OPEN_TEST_DATABASE_URL='postgresql://…/isolated_test' \
OPEN_TEST_LIVEKIT_URL='http://127.0.0.1:17889' \
node --test test/open-lessons.integration.mjs
```

LiveKit 기본 키는 개발용 `devkey`/`secret`입니다. 필요하면 `OPEN_TEST_LIVEKIT_KEY`, `OPEN_TEST_LIVEKIT_SECRET`을 지정하세요. 테스트는 별도 로컬 포트에 임시 API를 실행해 공개·초대 수업, 대기·실제 입장, 다른 교사 권한, 강퇴·토큰 차단, 참여 방식 변경, 종료 기록을 검사합니다. 자체 데이터만 정리합니다.

자동 브라우저는 테스트 카메라·마이크·화면 소스를 쓰고 TLS 검증을 생략합니다. 물리 기기의 인증서 신뢰·카메라·스피커·화면 선택기는 별도로 확인해야 합니다. 실행 결과와 수동 확인 항목은 [VERIFICATION.md](VERIFICATION.md)에 기록합니다.

전체 컨테이너 재시작 복구 테스트는 다른 테스트 종료 후 단독 실행하세요.

```sh
cd ../web
TEST_RESTART=1 npx playwright test e2e/restart.spec.ts --workers=1 --output=test-results/restart
```
