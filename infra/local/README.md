# Think Meet 로컬 실행

Docker Desktop·Compose와 Python 3로 웹·API·LiveKit·PostgreSQL·MinIO를 함께 실행합니다. 이 문서의 명령은 별도 안내가 없으면 `infra/local/`에서 실행합니다. 서버 소스·Prisma·계정 CLI·서버 Dockerfile은 `../../server/`에서 관리합니다.

## 테스트 시작·중지

Docker Desktop을 먼저 실행하세요. Python 3도 필요합니다. Finder에서 `scripts/start-test.command`를 더블클릭하면 PostgreSQL·MinIO·서버·가상 학생 5명을 시작합니다. 모든 컨테이너는 Docker Desktop의 `think-meet` 그룹에 표시됩니다. 터미널에서는 어느 경로에서든 실행할 수 있습니다.

```sh
/Users/pang/Project/woongjin/think-meet/infra/local/scripts/start-test.command
/Users/pang/Project/woongjin/think-meet/infra/local/scripts/stop-test.command
```

`infra/local/`에서 사용할 옵션:

```sh
./scripts/start-test.command 20               # 학생 20명
./scripts/start-test.command --students 5 --build  # 코드 변경 후 재빌드
./scripts/start-test.command --churn          # 무작위 퇴장·재입장
```

- 기본값은 기존 이미지 재사용입니다. 이미지가 없거나 `--build`를 지정하면 빌드합니다.
- 종료하지 않은 테스트 수업은 재사용합니다. 종료된 경우 새 무제한 수업을 만들고 참여 링크를 출력합니다.
- `--churn`: 학생별로 1분마다 50% 확률로 퇴장하고 1분 뒤 재입장합니다. 옵션이 없으면 계속 접속합니다. 최신 학생 이미지는 캐시를 이용해 빌드합니다.
- `scripts/stop-test.command`: 학생을 먼저 퇴장시키고 API·LiveKit·웹·PostgreSQL·MinIO를 중지합니다. 데이터·인증서 볼륨과 다른 프로젝트의 컨테이너는 보존합니다.

교사·일반 학생·가상 학생의 공통 테스트 비밀번호는 `test123`입니다. Mac의 LAN IP가 바뀌면 아래 주소 변경 절차를 먼저 진행하세요.

## 서비스 실행·접속

Compose·실행 스크립트·`.env`·인증서·백업·가상 학생 도구를 이 폴더에서 관리합니다. Caddy·LiveKit·MinIO 정책도 같은 위치에 있습니다. `server/`의 기존 로컬 설정은 처음 시작할 때 충돌 여부를 확인하고 이 폴더로 자동 이전합니다. 양쪽에 같은 이름의 설정이나 데이터가 있으면 덮어쓰지 않고 중단합니다.

Docker Desktop과 Python 3를 준비한 뒤 실행합니다. PostgreSQL·MinIO를 따로 설치하거나 시작할 필요는 없습니다.

최초 실행에는 이미지·소스 다운로드와 빌드를 위한 인터넷 연결이 필요합니다. MinIO는 [공식 서버 소스의 고정 버전](https://github.com/minio/minio/releases/tag/RELEASE.2025-09-07T16-13-09Z)과 관리 도구를 Docker 안에서 빌드하므로 첫 실행에 시간이 걸립니다. 이후에는 빌드 캐시를 재사용하며 호스트에 Go를 설치할 필요는 없습니다.

```sh
cd /Users/pang/Project/woongjin/think-meet/infra/local
./scripts/start.sh
```

시작 스크립트는 다음을 처리합니다.

1. `.env`가 없으면 LAN 주소를 확인하고 DB·스토리지 비밀번호를 자동 생성합니다. 주소를 직접 지정할 때는 최초 실행에 `LAN_IP=192.168.0.10 ./scripts/start.sh`를 사용합니다.
2. 같은 Compose 프로젝트의 PostgreSQL·MinIO를 시작하고 준비 상태를 기다립니다. 전용 DB·앱 계정과 비공개 버킷·제한된 S3 계정을 준비합니다.
3. API·LiveKit·HTTPS 화면을 빌드하고 마이그레이션·최초 계정 생성을 진행합니다.

기존 계정 비밀번호·수업·파일은 유지합니다. DB·버킷·계정 이름은 `.env`를 따르며, 로컬 DB 접속 호스트는 `postgres`, 파일 저장소는 `minio`입니다. `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`는 로컬 관리자 비밀번호로 자동 생성하며 재실행 때 재사용합니다. 외부 DB를 지정한 설정은 이 로컬 시작 스크립트가 변경하지 않고 중단합니다.

기존 `.env`가 `postgre-container-db-1`을 가리키면 첫 실행 때 ThinkMeet API·가상 학생을 중지하고 해당 DB·버킷만 백업한 뒤 새 전용 볼륨으로 복사합니다. 필요하면 이전 PostgreSQL·MinIO를 잠시 시작하고 원래 실행 상태로 돌려놓습니다. 기존 컨테이너·볼륨·다른 DB·버킷은 그대로 보존합니다. 복사가 끝난 뒤에만 `.env`의 DB 호스트를 바꾸며, 실패하면 같은 백업으로 재시도합니다.

이전 백업은 `artifacts/backups/<UTC시각>/`에 SQL·파일·기존 `.env.before`로 저장하고 `.env`의 `LOCAL_STORAGE_BACKUP`에 기록합니다. 복사 대상에 별도 데이터가 이미 있으면 덮어쓰지 않고 중단합니다. PostgreSQL·MinIO 데이터는 `think-meet_postgres_data`, `think-meet_minio_data` 볼륨에 저장합니다. `docker compose down -v`는 이 볼륨과 인증서를 삭제하므로 데이터 보존용 중지는 아래 명령을 사용합니다.

| 항목 | 주소·계정 |
|---|---|
| 서비스 | `PUBLIC_ORIGIN` 값 — `.env`에서 확인 |
| API 설명 | `<PUBLIC_ORIGIN>/api/docs` |
| 상태 확인 | `<PUBLIC_ORIGIN>/api/v1/health` |
| 공개 루트 인증서 | `<PUBLIC_ORIGIN>/local-ca.crt` 또는 `certs/think-meet-root.crt` |
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

외부 Docker 네트워크는 필요하지 않습니다. 웹·API·LiveKit·PostgreSQL·MinIO는 `think-meet` 그룹의 네트워크를 사용하며, DB·MinIO 포트는 호스트에 공개하지 않습니다. 기존 로컬 서비스와 포트가 충돌하지 않습니다. 시작 순서는 [Compose의 준비 상태 조건](https://docs.docker.com/compose/how-tos/startup-order/)을 따릅니다.

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

`LAN_IP`는 브라우저가 접근할 수 있는 미디어 서버 주소여야 합니다. 인터넷 접속에는 공인 IP를 지정합니다. LiveKit은 실행 시 `--rtc.node_ip.ipv4`로 이 값을 읽으므로, 생성된 `livekit.yaml`에 이전 주소가 남아 있어도 현재 `.env` 값을 사용합니다. 주소만 바꿨다면 이 폴더에서 `docker compose up -d --no-build --force-recreate livekit api web`으로 세 서비스를 함께 재생성합니다. 로컬 IP 보조 설정 `compose.lan.yaml`도 같은 실행 옵션을 사용합니다.

## 계정 관리

`infra/local/`에서 실행합니다. 비밀번호는 7~200자입니다.

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

백업 중에는 이 서비스의 API만 잠시 중지합니다. 같은 Compose 프로젝트의 PostgreSQL·MinIO에서 `DATABASE_URL`의 DB와 전용 버킷을 `artifacts/backups/<UTC시각>/`에 함께 저장한 뒤 API를 다시 시작합니다. 다른 DB·버킷은 건드리지 않습니다.

백업에는 계정·수업 정보와 `.env.before`가 포함되므로 개인 접근 권한으로 보관하세요. Caddy CA 볼륨은 별도 보관합니다.

복구는 **현재 Think Meet 데이터를 백업 시점으로 대체**합니다. 먼저 현재 상태를 백업한 뒤 실행하세요.

```sh
python3 scripts/restore.py artifacts/backups/<백업시각> --replace-think-meet
```

복구 후 `docker compose ps`, `/api/v1/health`를 확인하고 다시 로그인합니다. CA 신뢰는 SQL 백업과 별개이므로 `think-meet_caddy_data` 볼륨을 보존하세요.

## Docker 가상 학생

[가상 학생 운영 안내](loadtest/README.md)를 참고하세요. 종료 시각 없는 수업에서 각 학생이 별도 Docker 브라우저로 번호가 표시된 반복 영상을 실제 WebRTC로 송출합니다. 기본 마이크는 꺼집니다.

```sh
python3 loadtest/manage.py start --students 5
python3 loadtest/manage.py status
python3 loadtest/manage.py stop
```

교사는 기존 `teacher1`로 입장합니다. 현재 방 정보는 `.loadtest/classroom.json`에 있습니다.

## 이전 설정과 데이터

기존 `server/.env`, `server/certs/`, `server/artifacts/`, `server/.loadtest/`, `server/LOCAL_ACCESS.md`는 현재 폴더의 같은 이름으로 이동합니다. 비밀번호·인증서·백업 내용과 파일 권한은 유지하고, 생성된 학생 Compose의 호스트 경로만 바꿉니다. 이전 백업 안의 `.env.before`와 과거 검증 결과는 당시 기록으로 보존합니다.

Compose 프로젝트 이름은 `think-meet`이며 `think-meet_postgres_data`, `think-meet_minio_data`, `think-meet_caddy_data`, `think-meet_caddy_config` 볼륨을 계속 사용합니다. 이번 위치 변경은 기존 DB의 내용을 새로 복사하거나 초기화하지 않습니다.

## 경로 이전 검증 — 2026-11-15

이 Mac의 ARM64 Docker Desktop·Compose 2.32.4·Python 3.8.10에서 확인했습니다. 로컬 실행 도구와 참조 경로만 변경했으며 API·Socket 계약·웹/앱 화면은 유지했습니다.

| 검사 | 이번 결과 |
|---|---|
| 루트에서 `python3 -m unittest discover -s infra/local/tests -p test_local_stack.py -v` | 13/13 통과. 기존 저장소 이전 검사, 파일·권한 보존, 충돌 시 덮어쓰기 차단, 빌드·마운트 경로와 볼륨 이름 확인 |
| 루트에서 `node --test infra/local/loadtest/worker-tests.mjs` | 5/5 통과 |
| 이전한 셸 스크립트·`.command`와 모바일 보조 스크립트의 `sh -n` | 통과. 루트에서 테스트 시작·가상 학생·복구 명령의 도움말 호출도 확인 |
| `web/`에서 Playwright `test --list` | 기존 35개 테스트 로딩 확인. 재시작 검사도 새 Compose 위치로 수정하고 목록 로딩 확인. 브라우저 테스트 자체는 미실행 |
| 루트에서 `npm run shared:check -- --changed-files <이번 변경 파일 목록>` | 통과. iOS 문서의 CA 경로 갱신을 인프라 변경 기록에 명시 |
| 환경 설정·인증서·백업·가상 학생 상태 파일 이전 | 45개 파일 확인. 생성된 학생 Compose의 호스트 경로만 변경하고 나머지 파일의 SHA256·권한 유지 |
| 이 폴더에서 `./scripts/stop.sh`, `./scripts/start.sh` | 웹·API·MinIO 빌드, 전체 중지·시작과 인증서 복사 통과. Docker 관리 경로도 이 폴더로 갱신 |
| 재시작 전후 데이터·볼륨과 HTTPS 상태 확인 | 12개 테이블·457개 행과 MinIO 파일 2개가 동일. 기존 PostgreSQL·MinIO 볼륨 유지. 인증서 검증을 켠 localhost 상태 응답에서 DB·스토리지·LiveKit 모두 정상 |

로컬 비공개 결과는 `artifacts/local-layout-verification.json`에 보관합니다. 설정·인증서·백업·가상 학생 상태는 Git에서 제외됩니다. 이전 검증 기록의 경로·명령은 당시 기록으로 유지하며, 기존 `server/artifacts/`는 현재 이 폴더의 `artifacts/`에 있습니다.

Android/iOS 앱 빌드·실행과 화면 비교, 실제 가상 학생 영상 송출, AMD64 이미지·원격 CI·AWS 배포는 이번 인프라 경로 변경 범위에서 제외했습니다. 모바일 도구는 새 시작 경로·공개 인증서 참조와 셸/JavaScript 문법을 확인했습니다.

## 미디어 광고 주소 검증 — 2026-11-15

`aimos-jm`에서 `.env`의 공인 IP와 생성된 `livekit.yaml`의 이전 내부 IP가 달라, 브라우저가 `172.19.0.2:7882` 후보에 연결하다 실패하는 것을 확인했습니다. Compose가 `--rtc.node_ip.ipv4`로 현재 `LAN_IP`를 직접 적용하도록 수정했습니다. LiveKit 1.13.11에서 일반 `--node-ip`는 이미 설정된 IPv4 값을 덮어쓰지 않아 IPv4 전용 옵션으로 검증했습니다.

활성 참가자 0명을 확인하고 서버 Compose를 백업한 뒤 LiveKit만 빌드 없이 재생성했습니다. 실제 시작 로그의 `nodeIP:115.68.2.13`, TCP 7881·UDP 7882 설정, 내부 LiveKit API, 외부 HTTPS 상태와 TCP 7881 접근을 확인했습니다. API·웹·DB·스토리지는 재시작하지 않았습니다. 실제 브라우저 재입장·음성/영상 송수신과 UDP 패킷 왕복은 사용자 확인이 필요합니다.

루트에서 `python3 -m unittest discover -s infra/local/tests -p test_local_stack.py -v` 14/14와 `npm run shared:check -- --changed-files <이번 변경 파일 목록>`를 통과했습니다. 기본 Compose와 LAN 보조 설정에서 환경 변수 변경이 실행 주소에 반영되는 검사를 추가했습니다. 앱·웹 UI·통신 계약은 변경하지 않아 네이티브 빌드와 화면 비교는 제외했습니다.
