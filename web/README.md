# Think Meet Web

React 기반 화상 수업 화면입니다. NestJS·PostgreSQL·LiveKit·MinIO 서버와 연결합니다.

- 접속: [https://192.168.0.64](https://192.168.0.64)
- [서버 실행·Docker·인증서·계정·백업](../server/README.md)
- [AWS 인프라·배포·운영](../infra/README.md)
- [비공개 초기 계정·비밀번호](../server/LOCAL_ACCESS.md)
- [API·Socket.IO 계약](../server/CONTRACT.md)
- [검증 결과·물리 기기 확인 항목](../server/VERIFICATION.md)

처음 접속하는 기기는 서버 README에 따라 공개 루트 인증서를 신뢰하도록 설정합니다.

## 개발과 빌드

Node.js 22.22 이상을 사용합니다. 아래 명령은 `web/`에서 실행합니다. 기존 Vite 서버는 API·Socket.IO 요청을 로컬 HTTPS 서비스로 전달합니다.

```sh
npm ci
npm run typecheck
npm run build
```

## 공통 디자인

색상·글자 크기·간격·모서리는 [design/tokens.json](../design/tokens.json)에서 관리합니다. 변경 방법은 [디자인 안내](../design/README.md)를 따릅니다.

```sh
npm run design:check  # 파일을 수정하지 않는 검사: 생성·빌드 전에 실행
npm run design:generate
```

`npm run dev`와 `npm run build`는 CSS·Kotlin 토큰을 생성합니다. 개발 중 원본 토큰 변경은 CSS HMR로 반영됩니다.

`design/`, `web/`, `mobile/`은 같은 상위 폴더에 둡니다. Docker도 공통 원본이 필요하므로 **상위 폴더에서** `docker build -f web/Dockerfile .`로 빌드합니다. 서버 Compose도 이 경로를 사용합니다.

## 브라우저 검증

서버를 실행한 뒤 다음 명령을 실행합니다.

```sh
npx playwright install chromium
npm run test:e2e
```

테스트는 별도 브라우저의 카메라·마이크·화면 소스를 사용하고, 초기 계정 비밀번호는 서버의 비공개 설정에서 읽습니다. 검증 주소는 `BASE_URL`로 바꿀 수 있습니다.

컨테이너 재시작 복구 테스트는 다른 테스트가 끝난 뒤 단독 실행합니다.

```sh
TEST_RESTART=1 npx playwright test e2e/restart.spec.ts --workers=1 --output=test-results/restart
```

물리 기기의 인증서 신뢰, 실제 카메라·스피커는 별도로 확인합니다.
