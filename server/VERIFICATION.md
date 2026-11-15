# 서버 검증 기록

아래는 기존 실행 결과입니다. 날짜별 검증 범위와 미확인 항목을 구분합니다. 로컬 도구는 이후 `infra/local/`로 이동했습니다. 아래 명령·경로는 검사 당시 기록이며, 기존 `server/artifacts/` 증거는 현재 `infra/local/artifacts/`에 있습니다. 현재 실행·검증 안내는 [로컬 안내](../infra/local/README.md)를 따릅니다.

## 로컬 Compose 통합 — 2026-11-15

이 Mac의 ARM64 Docker Desktop, Compose 2.32.4, Python 3.8.10에서 실행했습니다. 로컬 실행·데이터 이전·백업 도구만 변경했으며 API·Socket 계약·화면·기능 공개 정책은 유지했습니다. Android/iOS 앱 빌드·실행과 휴대폰·태블릿 화면 비교는 인프라 작업 범위에서 제외했습니다.

| 검사 | 이번 실행 결과 |
|---|---|
| `python3 -m unittest discover -s server/test -p test_local_stack.py -v` | 11/11 통과. 설정·비밀번호 보존, 외부 DB 변경 거부, 복사 실패 시 재시도·이전 컨테이너 실행 상태 복원, 대상 데이터 덮어쓰기 차단, 학생 제어, Compose 준비 상태·볼륨·비공개 포트 확인 |
| `node --test server/loadtest/worker-tests.mjs` | 기존 가상 학생 설정 회귀 검사 5/5 통과 |
| `sh -n server/scripts/start.sh server/scripts/stop.sh server/scripts/test-start.sh server/scripts/test-stop.sh mobile/scripts/start-local-server.sh` | 통과 |
| `npm run shared:check`, `npm run shared:check -- --changed-files <이번 변경 파일 목록>` | 공통 계약·생성물·플랫폼 상태 검사 통과 |
| `docker compose build minio` (`server/`에서 실행) | 공식 고정 버전 서버·관리 도구 소스의 ARM64 이미지 빌드 통과. 기존 바이너리 이미지 주소의 다운로드 실패를 소스 빌드로 해결 |
| `./scripts/start.sh`, `./scripts/stop.sh` 후 `./scripts/start.sh` (`server/`) | 웹·API 빌드, 스토리지 준비 대기, 마이그레이션·seed, 인증서 복사와 전체 중지·재시작 통과 |
| 이전 전후·최종 재시작 후 데이터 비교 | 기존 DB의 12개 테이블·457개 행이 동일. MinIO 파일 2개의 경로·SHA256 동일. 기존 비밀번호 해시·수업·파일 보존 |
| `curl --cacert certs/think-meet-root.crt https://localhost/api/v1/health` (`server/`) | `status:ok`, `database:true`, `storage:true`, `livekit:true`. 인증서 검증 활성 상태로 통과 |
| 같은 그룹의 임시 학생 컨테이너 2개로 축소·중지 | `think-meet` 소속 확인. 기본 5개 서비스의 컨테이너 ID·실행 상태 유지. 검증용 컨테이너·네트워크 정리 |

최종 상태는 `think-meet` 그룹의 API·웹·LiveKit·PostgreSQL·MinIO가 모두 실행 중이며, API·PostgreSQL·MinIO는 healthy입니다. PostgreSQL·MinIO의 호스트 공개 포트는 없습니다. 원래 외부 PostgreSQL·MinIO 컨테이너와 다른 프로젝트의 데이터는 보존했습니다.

로컬 비공개 증거는 `server/artifacts/local-compose-final-verification.json`, `server/artifacts/local-compose-worker-verification.json`, `server/artifacts/backups/20261115-051913-320958Z/migration-verification.json`입니다. 마지막 파일은 테이블별 행 수·내용 해시와 파일별 해시를 기록합니다. 이전 백업에는 원래 `.env.before`도 포함되며 Git에서 제외합니다.

이번에는 실제 가상 학생의 영상 송출, Android/iOS 실행, 모바일 보조 시작 스크립트의 실제 실행, AMD64 이미지 빌드, 원격 CI·AWS 배포는 검사하지 않았습니다. 모바일 보조 스크립트는 공통 시작 경로 연결과 셸 문법을 확인했습니다. 현재 `.env`의 공개 주소는 `192.168.13.12`, 이 Mac의 현재 LAN 주소는 `192.168.0.28`로 달라 다른 기기·가상 학생 접속 전 주소를 맞춰야 합니다. 이번 실행에서는 저장된 공개 주소를 유지하고 localhost HTTPS로 상태를 확인했습니다.

## 공통 계약·기능 정책 — 2026-11-14

| 검사 | 결과 |
|---|---|
| `npm run build` | 통과. 생성 계약 타입·HTTP guard·Socket.IO 정책·공통 원본 OpenAPI 컴파일 |
| `node --import tsx --test test/feature-policy.test.ts test/feature-gating.test.ts test/service.test.ts test/open-lessons.test.ts` | 39/39 통과. 새 정책 경계 10개 + 기존 권한·수업 회귀 테스트 |

확인한 내용:

- legacy revision 0의 기존 수업 유지, 공개 capabilities
- 새 기능의 기본 비활성, 준비 상태·플랫폼·revision·운영 플래그 검사
- 잘못된 환경 설정의 서버 시작 차단
- HTTP·실시간 요청으로 UI를 우회해도 정책 적용
- 기존 쿠키 인증·교사 권한 유지

이 변경에서는 실제 DB·LiveKit·MinIO 통합 테스트를 반복하지 않았습니다.

## 실제 인프라 통합 — 2026-11-07

Asia/Seoul 기준, 이 Mac의 Docker Desktop과 실제 PostgreSQL·MinIO·LiveKit을 사용했습니다.

| 항목 | 결과 |
|---|---|
| 프런트 TypeScript·Vite 프로덕션 빌드 | 통과 |
| NestJS TypeScript 빌드 | 통과 |
| 서버 단위·회귀 테스트 | 18/18 통과 |
| HTTPS·LiveKit·MinIO API 통합 | 12/12 통과 |
| UI·다중 브라우저 | 7/7 통과 |
| API·LiveKit·웹 전체 재시작 복구 | 1/1 통과 |
| 프런트·서버 실행 의존성 `npm audit` | 알려진 취약점 0개 |
| 로컬 CA 신뢰 체인·LAN IP 일치 | HTTPS 200 |
| 전용 DB·MinIO 버킷 백업 | 성공 |
| 공개 인증서 다운로드·서비스 준비 상태 | 200 |

### 확인한 동작

| 영역 | 확인 내용 |
|---|---|
| 계정·예약 | 교사·학생 로그인, 세션 유지, 예약·수정·취소, 새로고침 후 저장 상태 |
| 입장 | 초대 링크 로그인 복귀, 미초대 계정·잘못된 코드 차단, 대기 후 교사 시작 시 자동 입장 |
| 음성·영상 | Chromium 2개 간 원격 영상 프레임·음성 트랙, 카메라 켜기/끄기 |
| 채팅·손들기 | 상태 동기화, 채팅 재시도 중복 방지, 로그아웃한 소켓의 상태 수신 차단, 서버 권한 검사 |
| 화면 공유 | 원격 프레임 수신, PDF 전환 시 실제 캡처 트랙 종료 |
| PDF·판서 | 업로드, 2페이지 렌더, 페이지 변경, 펜·원격 동기화·실행취소/다시실행·지우개·저장 복구 |
| MP4 | H.264/AAC 업로드·재생·정지, 원격 재생 위치, byte Range 다운로드 |
| 파일 권한 | 업로드 취소, 손상 파일·학생 업로드·공유 중 삭제 차단, 공유 종료 후 접근 회수 |
| 퇴장·종료 | 강퇴 후 새 입장·기존 토큰 차단, 개인 퇴장·재입장·중복 기기 이동 구분, 교사 전체 종료 |
| 재시작 복구 | 진행 중 API·LiveKit·웹 재시작 후 로그인·시작 시각·채팅·PDF 2페이지·판서 복원, MinIO 원본 SHA256 일치, 브라우저 재입장 복구 |
| 화면 | PC·모바일 크기의 로그인·목록·예약·상세 화면 시각 확인 |

검증 중 발견한 HTTPS WebSocket 권한 경로, PDF 초기화, 화면 공유 전환, 대기실 중복 입장 경합을 수정했습니다. 최종 이미지로 전체 테스트를 다시 통과했습니다. 테스트 수업 27개·업로드 파일을 정리했고 초기 수업은 유지했습니다.

### 운영 도구

`./scripts/backup.sh`로 전용 DB·버킷의 일관된 백업을 만들고 API 재시작을 확인했습니다. 다른 DB·버킷·컨테이너는 유지했습니다.

복구 명령의 대상 검증·문법·절차는 확인했습니다. 현재 데이터를 대체하는 실제 복구는 실행하지 않았습니다. 사용법은 [README.md](README.md#백업복구)에 있습니다.

## 가상 학생·무제한 수업 — 2026-11-07

| 검사 | 결과 |
|---|---|
| 서버 빌드·단위/회귀 테스트 | 22개 통과. 기존 수업을 보존하는 종료 시각 nullable 마이그레이션 적용 |
| 일반·무제한 수업 브라우저 회귀 | 9개 통과 |
| 가상 학생 실행기 회귀 | 4개 통과 |
| Docker 학생 10명 | 실제 로그인·입장·640×360 15fps 반복 영상 송출. 컨테이너 CA 신뢰 설치, HTTPS 오류 무시 없이 연결 |
| 교사 영상 수신 | 10명 모두 원격 영상 프레임·프레임 수 증가 확인, 테스트 1개 통과 |
| 학생 010 재접속 | 정상 중지로 개인 퇴장 후 같은 LIVE 수업 재입장·송출 복구. 수업은 유지 |

교사 화면은 `artifacts/loadtest/teacher-view.png`에 저장했습니다. 무제한 수업은 `endsAt:null`, 작업 시간 제한은 `0`(없음)입니다. 교사가 모두 종료하면 컨테이너도 정상 종료하며 새 수업을 자동 생성하지 않습니다.

- 현재 수업 ID·코드: `.loadtest/classroom.json`
- 학생별 상태: `.loadtest/results/student-###/status.json`
- 운영 명령: [loadtest/README.md](loadtest/README.md)

## 물리 기기에서 남은 확인

자동 브라우저는 카메라·마이크·화면의 테스트 소스를 사용했습니다. 같은 Wi-Fi의 다른 PC·태블릿 2대에는 직접 접근하지 못해 다음은 미확인입니다.

1. [README의 절차](README.md#다른-pc태블릿에서-접속)로 CA를 설치하고 인증서 경고가 없는지 확인합니다.
2. 교사·학생으로 로그인하고 실제 카메라·마이크를 허용합니다.
3. 서로 영상·스피커 음성을 확인하고 브라우저 선택기로 탭/화면 공유를 시작·중지합니다.
4. PDF·영상·판서를 확인한 뒤 네트워크를 잠시 끊고 재연결합니다.

브라우저별 화면 송출·탭 오디오·출력 장치 선택 지원 차이는 앱에서 안내합니다. 현재는 LAN 배포이며 인터넷 외부 공개 검증은 포함하지 않습니다.
