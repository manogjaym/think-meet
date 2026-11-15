# Docker 가상 학생

Chromium 컨테이너가 전용 계정으로 실제 수업에 입장해 가상 카메라 영상을 보냅니다. 기본 5명이며 영상은 번호·색상·프레임 카운터가 움직이는 640×360, 15fps 반복 영상입니다. 마이크는 기본적으로 꺼집니다.

## 시작·상태·중지

기본 서비스가 실행된 상태에서 `infra/local/` 폴더에서 실행하세요.

```sh
python3 loadtest/manage.py start --students 5
python3 loadtest/manage.py status
python3 loadtest/manage.py stop
```

첫 실행은 공식 Playwright ARM64/AMD64 이미지 다운로드·영상 도구 설치로 시간이 걸립니다. 코드가 같으면 다음부터 빌드를 생략할 수 있습니다.

```sh
python3 loadtest/manage.py start --students 5 --no-build
```

`--students`는 1~100명입니다. 전용 계정·컨테이너 수만 바꾸며 다른 서비스 컨테이너에는 영향을 주지 않습니다. 현재 Mac에서는 5명부터 늘리며 CPU·메모리·네트워크 사용량을 확인하세요.

### 수업과 계정

- `load_student_001` 같은 전용 계정을 만들고 `teacher1`에 연결합니다.
- 종료 시각이 `null`인 수업을 준비합니다. 먼 미래 날짜나 실행 시간 제한을 사용하지 않습니다.
- 정상 교사 로그인·LiveKit 입장으로 수업을 시작합니다. 시작용 교사는 개인 퇴장하므로 사용자가 기존 `teacher1`로 입장할 수 있습니다.
- 수업 ID·코드는 비공개 `.loadtest/classroom.json`에 저장하고 참여 링크도 출력합니다.

| 동작 | 결과 |
|---|---|
| `stop` | 가상 학생만 퇴장, 수업 유지 |
| 교사의 모두 종료 | 송출·작업 컨테이너 종료. 자동 재입장·새 수업 생성 없음 |
| 종료 후 `start` | 새 테스트 수업 준비 |

학생은 교사의 모두 종료 또는 컨테이너 중지 전까지 송출합니다.

## 무작위 퇴장·재입장

```sh
./scripts/start-test.command --churn                # 서버와 기본 학생 5명
./scripts/start-test.command --students 5 --churn   # 인원 지정
python3 loadtest/manage.py start --students 5 --churn  # 서버 실행 중
```

- 실제 연결 후 학생별로 1분마다 독립적으로 50% 확률로 개인 퇴장합니다. 시작 시각이 달라 일괄 퇴장하지 않습니다.
- 1분 후 같은 수업에 정상 로그인·입장합니다. 입장 승인이 필요하면 대기합니다.
- 수업 종료·강퇴·같은 계정의 다른 브라우저 접속 시 자동 재입장을 중단합니다.
- `--churn` 없이 다시 시작하면 상시 접속으로 돌아갑니다.
- 퇴장 중 상태는 `status.json`의 `state: "churn-away"`, `rejoinAt`에 기록하며 정상 헬스체크 상태로 봅니다.
- `--churn`은 기존 이미지나 `--no-build` 여부와 관계없이 학생 이미지 변경을 캐시 빌드로 반영합니다.

## 상태·로그·인증

학생마다 별도 브라우저 프로세스·세션을 사용합니다. 계정·초대·강퇴·토큰 검사를 우회하지 않습니다. 공개 CA를 컨테이너 시스템·Chromium 인증서 저장소에 설치하며 HTTPS 오류 무시 옵션을 사용하지 않습니다.

| 위치 | 내용 |
|---|---|
| `.loadtest/results/student-###/status.json` | WebRTC 인코딩 프레임·전송량·수신 프레임·접속 상태 |
| PostgreSQL | 계정·수업 |
| 컨테이너 `/media/student.y4m` | 생성한 영상 소스 |

비밀번호·입장 토큰은 로그에 남기지 않습니다.

```sh
# 개별 학생 로그
docker compose -f compose.yaml -f .loadtest/compose.yaml logs --tail 5 student-001
# 컨테이너 자원 사용량
docker stats --no-stream
```

테스트 비밀번호는 교사·학생 공통 `test123`입니다. 시작 도구는 매번 가상 계정, `.loadtest/secret.env`, 학생 컨테이너 환경에 이 값을 적용하고 수업 시작용 교사 로그인에도 사용합니다. 일반 학생 `student1`~`student4`와 교사 비밀번호는 서버 계정 관리 명령으로 변경합니다. `.loadtest/` 전체는 Git에서 제외합니다.

같은 가상 학생 계정으로 다른 브라우저가 입장하면 기존 연결이 대체됩니다. 강퇴된 계정은 해당 수업에 자동 재입장하지 않습니다.

## 영상 교체

MP4를 컨테이너에 읽기 전용으로 마운트하고 학생 환경변수 `SOURCE_VIDEO_FILE`에 경로를 지정하세요. 이미지 entrypoint가 시작 시 Y4M으로 변환합니다. 학생마다 다른 영상을 지정할 수 있으며, 생략하면 번호가 있는 기본 영상을 만듭니다.

## 검증

```sh
node --test loadtest/worker-tests.mjs
```

입장·송출은 계정 생성 여부만으로 판단하지 않습니다. 실제 `framesEncoded`·`bytesSent` 증가와 교사 브라우저의 원격 프레임을 확인합니다. 파일 화면·음성은 테스트 입력이며 물리 카메라·마이크는 사용하지 않습니다.

실행 중인 방에서 교사 영상 수신을 확인하려면:

```sh
cd ../../web
TEST_LOAD_ROOM=1 npx playwright test e2e/load-room.spec.ts --output=test-results/virtual-room
```

검증 교사는 개인 퇴장하며 수업은 유지합니다.

## 서버와 함께 실행·중지

`infra/local/scripts/start-test.command`는 PostgreSQL·MinIO·서버와 학생 5명을 시작합니다. 학생도 같은 `think-meet` Compose 그룹에 포함됩니다. 학생 수를 줄이면 제외된 학생 컨테이너만 정리하며 API·DB·스토리지는 유지합니다. 이전 `think-meet-loadtest` 그룹의 학생은 다음 시작 때 중지·정리하고 결과 파일은 보존합니다.

`scripts/stop-test.command` 또는 `scripts/stop.sh`는 학생을 먼저 퇴장시킨 뒤 API·LiveKit·웹·PostgreSQL·MinIO를 중지합니다. 데이터·인증서 볼륨은 유지합니다. `python3 loadtest/manage.py stop`은 학생만 중지합니다. 기본은 캐시 이미지이며 코드 변경을 반영하려면 `scripts/start-test.command --build`를 사용하세요.
