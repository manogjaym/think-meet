# Think Meet 수업 서버

NestJS·Prisma 서버가 `../web` 화면을 실제 서비스로 연결합니다.

| 구성 | 역할 |
|---|---|
| LiveKit | 음성·영상·화면 공유 |
| PostgreSQL | 수업·인증·출결·채팅·판서·공유 상태 |
| MinIO | PDF·MP4 저장 |

## 테스트 시작·중지

Docker Desktop과 기존 PostgreSQL·MinIO를 먼저 실행하세요. Finder에서 `start-test.command`를 더블클릭하면 서버와 가상 학생 5명을 시작합니다. 터미널에서는 어느 경로에서든 실행할 수 있습니다.

```sh
/Users/pang/Project/woongjin/think-meet/server/start-test.command
/Users/pang/Project/woongjin/think-meet/server/stop-test.command
```

서버 폴더에서 사용할 옵션:

```sh
./start-test.command 20               # 학생 20명
./start-test.command --students 5 --build  # 코드 변경 후 재빌드
./start-test.command --churn          # 무작위 퇴장·재입장
```

- 기본값은 기존 이미지 재사용입니다. 이미지가 없거나 `--build`를 지정하면 빌드합니다.
- 종료하지 않은 테스트 수업은 재사용합니다. 종료된 경우 새 무제한 수업을 만들고 참여 링크를 출력합니다.
- `--churn`: 학생별로 1분마다 50% 확률로 퇴장하고 1분 뒤 재입장합니다. 옵션이 없으면 계속 접속합니다. 최신 학생 이미지는 캐시를 이용해 빌드합니다.
- `stop-test.command`: 학생을 먼저 퇴장시키고 API·LiveKit·웹을 중지합니다. 반복 실행해도 PostgreSQL·MinIO·데이터·인증서는 보존합니다.

교사·일반 학생·가상 학생의 공통 테스트 비밀번호는 `test123`입니다. Mac의 LAN IP가 바뀌면 아래 주소 변경 절차를 먼저 진행하세요.

## 서비스 실행·접속

`server/`와 `infra/`를 같은 상위 폴더에 두세요. Caddy·LiveKit·MinIO 정책은 [`../infra/local/`](../infra/README.md), Compose·`.env`·DB 설정·백업은 `server/` 기준입니다. 초기화 스크립트도 LiveKit 설정을 공통 인프라 경로에 만듭니다.

Docker Desktop과 기존 `postgre-container-db-1`, `minio`가 실행 중일 때:

```sh
cd /Users/pang/Project/woongjin/think-meet/server
./scripts/start.sh
```

시작 스크립트는 다음을 처리합니다.

1. 전용 `think_meet` DB·`think_meet_app` 계정, 비공개 `think-meet` 버킷·제한된 S3 계정을 준비합니다.
2. API·LiveKit·HTTPS 화면을 빌드하고 실행합니다.
3. 마이그레이션과 최초 계정 생성을 진행합니다.

기존 데이터와 재실행 전 계정 비밀번호·수업은 유지합니다. `.env`가 있으면 기존 DB·버킷·계정 연결을 사용합니다. 부트스트랩·백업·복구의 DB 대상도 `DATABASE_URL`을 따릅니다.

| 항목 | 주소·계정 |
|---|---|
| 서비스 | https://192.168.0.64 — 현재 Mac LAN 주소 |
| API 설명 | https://192.168.0.64/api/docs |
| 상태 확인 | https://192.168.0.64/api/v1/health |
| 공개 루트 인증서 | https://192.168.0.64/local-ca.crt 또는 `certs/think-meet-root.crt` |
| 최초 교사 | `teacher1` / 윤지아 |
| 최초 학생 | `student1`~`student4` / 김민준·이서윤·박지후·최하은 |
| 테스트 비밀번호 | `test123` — `.env`의 `SEED_PASSWORD` |
| 비공개 접속 메모 | [LOCAL_ACCESS.md](LOCAL_ACCESS.md) |

`.env`, LiveKit 비밀 설정, Caddy CA 개인키는 Git에 넣지 않습니다. 인증서는 공개 `root.crt`만 공유하세요.

```sh
./scripts/stop.sh                   # 중지
docker compose up -d               # 시작·설정 변경 적용
docker compose ps                  # 상태
docker compose logs --tail 50 api   # API 로그
```

Compose의 bind 경로를 바꿨다면 이 폴더에서 `docker compose up -d`로 적용하세요. `docker restart`만으로는 새 경로가 적용되지 않습니다.

현재는 `postgre-container_default`, `minio_default` 네트워크를 재사용합니다. 다른 컴퓨터에서는 컨테이너 이름·네트워크와 `scripts/bootstrap.py`를 맞춰야 합니다.

### 이름 변경 후 주의할 점

- `think_meet_session` 쿠키를 사용하므로 다시 로그인합니다.
- Compose 프로젝트 이름은 `think-meet`입니다. 이전 프로젝트가 실행 중이면 이전 Compose 설정으로 먼저 중지합니다.
- 새 CA 볼륨을 쓰는 기기는 루트 인증서를 다시 신뢰 설치합니다.
- 기존 DB·파일 버킷 이름은 자동 변경하지 않습니다.

## 다른 PC·태블릿에서 접속

같은 Wi-Fi에 연결한 뒤 `certs/think-meet-root.crt`를 전달해 신뢰 설치하세요. HTTPS 경고를 한 번 넘기는 것만으로는 카메라·마이크가 동작하지 않을 수 있습니다.

| 기기 | 설치 방법 |
|---|---|
| macOS | 키체인 접근 → 로그인 또는 시스템 키체인에 가져오기 → Caddy Local Authority의 SSL을 항상 신뢰 → 브라우저 재시작 |
| Windows | 인증서 가져오기 → 현재 사용자 → 신뢰할 수 있는 루트 인증 기관 → 브라우저 재시작 |
| iPhone/iPad | 설정 → 다운로드된 프로파일 설치 → 일반 → 정보 → 인증서 신뢰 설정에서 전체 신뢰 켜기 |
| Android | 설정 → 보안/인증 정보 → 인증서 설치 → CA 인증서. 메뉴는 기기별로 다르며 관리형 기기는 설치를 제한할 수 있음 |
| Firefox | OS CA를 사용하지 않으면 개인정보 및 보안 → 인증서 → 인증 기관에서 별도로 가져오기 |

Mac 방화벽에서 Docker의 `443/TCP`, `7881/TCP`, `7882/UDP`를 허용하세요. Wi-Fi 기기 간 격리가 켜져 있으면 연결되지 않습니다. 모바일 브라우저의 화면 송출·출력 장치 선택은 브라우저 지원 여부에 따라 안내합니다.

LAN 주소 변경 시 `.env`의 `LAN_IP`, `PUBLIC_ORIGIN`, `LIVEKIT_PUBLIC_URL`을 함께 수정하고 `./scripts/start.sh`를 실행하세요. CA 볼륨을 유지하면 인증서를 다시 설치할 필요는 없습니다. 인터넷 공개에는 별도 도메인·공인 인증서·방화벽·TURN 배포가 필요합니다.

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

## 계정 관리

서버 폴더에서 실행합니다. 비밀번호는 7~200자입니다.

```sh
# 계정 목록
docker compose exec -T api npm run cli -- users

# 비밀번호 입력 후 학생 생성
read -s USER_PASSWORD; export USER_PASSWORD
docker compose exec -e USER_PASSWORD api npm run cli -- user:add student5 student 홍길동

# 담당 교사·학생 연결
docker compose exec -T api npm run cli -- roster:add teacher1 student5

# 비밀번호 변경과 기존 로그인 세션 폐기
docker compose exec -e USER_PASSWORD api npm run cli -- user:reset student5
docker compose exec -e USER_PASSWORD api npm run cli -- user:reset-all
unset USER_PASSWORD
```

`user:reset-all`은 모든 계정에 적용합니다. 교사 생성은 `user:add teacher2 teacher 이름`을 사용하세요. 회원관리·가입 화면과 이메일·문자 발송은 제공하지 않습니다.

## 백업·복구

```sh
./scripts/backup.sh
```

백업 중에는 이 서비스의 API만 잠시 중지합니다. `DATABASE_URL`의 DB와 전용 MinIO 버킷을 `artifacts/backups/<UTC시각>/`에 함께 저장한 뒤 API를 다시 시작합니다. 다른 DB·버킷은 건드리지 않습니다.

백업에는 계정·수업 정보가 있으므로 개인 접근 권한으로 보관하세요. `.env`와 Caddy CA 볼륨은 별도 보관합니다.

복구는 **현재 Think Meet 데이터를 백업 시점으로 대체**합니다. 먼저 현재 상태를 백업한 뒤 실행하세요.

```sh
python3 scripts/restore.py artifacts/backups/<백업시각> --replace-think-meet
```

복구 후 `docker compose ps`, `/api/v1/health`를 확인하고 다시 로그인합니다. CA 신뢰는 SQL 백업과 별개이므로 `think-meet_caddy_data` 볼륨을 보존하세요.

## 개발·검증

Node.js 22.22 이상이 필요합니다. 실행은 Docker를 권장합니다. API·Socket.IO·데이터 형식은 [CONTRACT.md](CONTRACT.md)에 있습니다.

| 위치 | 기본 검증 |
|---|---|
| `server/` | `npm ci`, `npm run generate`, `npm run build`, `npm test` |
| `web/` | `npm ci`, `npm run typecheck`, `npm run build` |

Vite는 `/api`, `/socket.io`를 로컬 HTTPS 서비스에 전달합니다. 주소가 다르면 `THINK_MEET_API_ORIGIN`을 지정하세요.

### 공개 수업 마이그레이션

갱신 API를 시작하기 전에 `DATABASE_URL` 대상에 `npm run migrate`를 적용합니다. `20261109000000_open_lessons`는 기존 수업을 `INVITE_ONLY`로 유지하며 참여 방식 필드를 추가합니다. 로컬 직접 실행은 `npm run generate`로 Prisma 클라이언트도 갱신하세요. `scripts/start.sh`는 이미지 빌드·마이그레이션을 포함합니다.

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

## Docker 가상 학생

[가상 학생 운영 안내](loadtest/README.md)를 참고하세요. 종료 시각 없는 수업에서 각 학생이 별도 Docker 브라우저로 번호가 표시된 반복 영상을 실제 WebRTC로 송출합니다. 기본 마이크는 꺼집니다.

```sh
python3 loadtest/manage.py start --students 5
python3 loadtest/manage.py status
python3 loadtest/manage.py stop
```

교사는 기존 `teacher1`로 입장합니다. 현재 방 정보는 `.loadtest/classroom.json`에 있습니다.
