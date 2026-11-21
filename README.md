# Think Meet 개발 안내

서버·React 웹·KMP Android/iOS를 함께 개발하는 프로젝트입니다. 공통 값·자산·모델·통신 정책을 공유하며, 화면은 웹과 앱에 각각 구현합니다.

## 폴더 안내

| 폴더 | 내용 |
|---|---|
| [contracts/](contracts/README.md) | REST·Socket 계약과 구버전 호환성 기준 |
| [features/](features/README.md) | 기능 명세, 구현·검증 상태, 공개 조건 |
| [design/](design/README.md) | 로고·아이콘·글꼴·문구·디자인·반응형 기준 |
| [infra/](infra/README.md) | AWS Terraform, 배포·운영 안내, 구성도, [로컬 실행 도구](infra/local/README.md) |
| [server/](server/README.md) | 인증·권한·수업 상태·데이터 처리 |
| [web/](web/README.md) | React 화면과 브라우저 기기·미디어 연결 |
| [mobile/](mobile/README.md) | Android/iOS Compose 화면과 미디어·PiP 연결 |

로컬 서비스는 `infra/local/`에서 `./scripts/start.sh`로 시작하고 `./scripts/stop.sh`로 중지합니다. 현재 Mac IP를 적용하려면 `./scripts/start.sh --lan`을 사용하세요. [설정·데이터 이전과 테스트 안내](infra/local/README.md)

## 공통 명령

Node 22.22 이상과 각 프로젝트의 의존성이 필요합니다. 루트 도구에는 추가 npm 패키지가 필요 없습니다. 아래 명령은 루트에서 실행합니다.

```sh
npm run shared:check      # 생성·빌드 전에 저장된 생성물, 호환성, 플랫폼 상태 검사
npm run shared:generate   # 공통 원본을 수정한 뒤 생성물 갱신
npm run verify            # 공통·정책 테스트, 웹/서버 타입 검사, 웹 빌드
```

새 기능은 `features/`, 계약은 `contracts/`, 디자인은 `design/` 안내를 따릅니다. 화면 변경은 웹·앱에 함께 반영하고 휴대폰·태블릿에서 비교합니다. 실제 검사·빌드·실행 기록은 [features/VERIFICATION.md](features/VERIFICATION.md)를 확인하세요.

## Git 관리

이 폴더의 `.git` 하나로 `server/`, `web/`, `mobile/`과 공통 폴더를 함께 관리합니다. 하위 폴더에서 실행한 Git 명령도 같은 루트 저장소를 사용합니다.

```sh
# ThinkMeet 루트에서 실행
git status
git add server/ web/ mobile/ contracts/ features/ design/ infra/
```

통합 전 `server/`, `web/`의 Git 정보는 로컬 `.git/legacy-repositories/server.git`, `.git/legacy-repositories/web.git`에 보관했습니다. 기존 커밋은 루트의 `refs/archive/server/heads/main`, `refs/archive/web/heads/main`에서도 조회할 수 있습니다. 이 백업과 보관용 참조는 일반 push·clone에 포함되지 않습니다. 통합 과정에서는 커밋을 만들지 않았으므로 기존에 준비된 루트 파일과 편입한 소스를 검토한 뒤 첫 커밋을 만듭니다.

```sh
git log refs/archive/server/heads/main --oneline
git log refs/archive/web/heads/main --oneline
```

## CI 연결 전제

`.github/workflows/cross-platform.yml`은 공통 검사 후 웹/서버 검사와 Android/iOS 빌드를 실행하도록 구성되어 있습니다.

원격 CI는 루트와 공통·하위 폴더가 모두 같은 checkout에 포함되는 단일 저장소 구성을 전제로 합니다. 루트 원격 저장소는 아직 연결하지 않았습니다. 원격 실행과 필수 상태 검사 설정은 실제 호스팅 저장소에 연결한 뒤 확인해야 합니다. 웹 글꼴은 Git LFS(대용량 파일 저장)를 사용하므로 새 clone에서 `git lfs pull`을 실행하고, CI checkout에는 `lfs: true`가 필요합니다.
