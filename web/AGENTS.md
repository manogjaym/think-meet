# 웹 개발 지침

React·Vite·Tailwind CSS 프로젝트입니다. Figma Make 환경에서는 Vite 서버가 `$PORT`(기본 8443)에서 이미 실행됩니다. 별도로 시작하지 않고 미리보기 패널을 사용합니다. 소스 변경은 자동 반영됩니다.

## 주요 파일·도구

아래에서 작업에 필요한 파일부터 확인합니다. 추가 조사는 필요할 때, 경로가 없을 때, 실제 저장소와 안내가 다를 때만 진행합니다.

| 파일 | 역할 |
|---|---|
| `src/main.tsx` | `src/index.css`를 불러오고 `App.tsx`를 `#root`에 연결 |
| `src/App.tsx` | 앱 최상위 컴포넌트, 일반적인 UI 작업 시작점 |
| `src/index.css` | 전역 스타일·Tailwind v4 진입점 |
| `index.html` | `#root`와 `src/main.tsx`를 담은 Vite HTML |
| `package.json` | 의존성과 개발·빌드·미리보기·포맷 명령 |
| `vite.config.ts` | React·Tailwind v4·Figma Make 플러그인, `@` → `src` 별칭 |
| `.mise.toml` | Node.js·pnpm 버전 |

React/React DOM 19, Tailwind CSS v4(`@tailwindcss/vite`), Vite 8, TypeScript 5.7, `@vitejs/plugin-react`, oxfmt를 사용합니다.

## CSS 규칙

- JSX에서 Tailwind 유틸리티를 사용합니다. 전역 CSS·테마는 `src/index.css`에 둡니다. Tailwind·PostCSS 설정 파일은 필요 없습니다.
- `@import 'tailwindcss';` 등 import를 먼저 쓰고 `@font-face`와 기본 font-family를 뒤에 둡니다.
- body·제목·button·input 등의 기본 스타일은 `@layer base { ... }`에 둡니다. 레이어 밖 CSS는 명시도와 관계없이 `@layer utilities`보다 우선합니다.
- Preflight가 제공하는 `box-sizing: border-box`, 기본 margin 제거, 폼의 `font: inherit`는 중복 작성하지 않습니다.

## 웹·앱 공통 디자인

- 시각 기준은 활성 웹 화면입니다. `../design/README.md`·`../design/system.json`에 따라 웹·Compose의 영역·순서·탐색 의미를 맞춥니다.
- 공통 값·자산·문구는 `../design/`에서 수정 후 생성합니다. `src/generated/`, 복사된 `public/design/fonts/`, 네이티브 생성물은 직접 편집하지 않습니다. 양쪽에서 같은 역할의 타이포그래피·컴포넌트 토큰을 사용합니다.
- 공통 책 로고·아이콘 도형·라이선스가 있는 번들 Pretendard 굵기를 유지합니다. 공통 원본을 우회하는 대체 자산·앱 전용 장식·글꼴·팔레트는 추가하지 않습니다.
- 미디어 쿼리는 Vite 전처리의 `design(layout.name)`(선택적으로 `+ 1`)을 사용합니다. 앱도 같은 생성 값을 사용하며 새 시각 규칙은 양쪽에 연결합니다.
- 구조 변경은 Compose와 화면 계약에도 반영합니다. HTML/CSS가 앱으로 자동 변환되지는 않습니다. 같은 상태의 휴대폰·태블릿 화면을 비교한 뒤 일치를 보고합니다.
- OS 안전 영역·권한/기기 창·추가 터치 범위·PiP/ReplayKit·미디어 렌더러 차이는 허용합니다. 예외와 실제 실행·미검증 범위를 기록합니다.
- 빌드 전에 `npm run design:check`, 원본 변경 후 `npm run design:generate`를 실행합니다. 추가 검사는 변경에 필요한 것만 수행합니다.

## 공통 계약·기능 공개

- `../contracts/openapi.json`·`../contracts/realtime.json`·`../features/catalog.json` 수정 후 `npm run contracts:generate`를 실행합니다. 생성 DTO·기능 정책은 직접 편집하지 않습니다. User/Lesson/MeetingSnapshot을 따로 정의하지 않고 생성 타입을 import/reexport합니다.
- JSON 요청은 `lib/api.ts`, Socket.IO 접속·요청은 `lib/socket.ts`를 사용합니다. 경로·명령은 공통 계약에 등록하며 미등록 작업은 차단합니다. 스트리밍·업로드 진행/취소를 보존합니다. 별도 XHR도 같은 capability 검사와 플랫폼/revision 헤더가 필요합니다.
- 새 UI는 `useFeature("registered.feature.id")`, API/Socket은 공통 정책 검사를 거칩니다. 서버 플래그만으로 미등록·미완료·revision 불일치·플랫폼 미지원 기능을 켜지 않습니다.
- 캐시 만료·조회 실패 시 baseline으로 돌아가도 이전 서버의 명시적 거부는 유지합니다. 정상 응답의 명시적 활성화 또는 구 서버 404에서만 해제합니다. 나머지 baseline은 유지하고 조회 실패는 재시도합니다.
- 생성·빌드 전에 `npm run contracts:check`를 실행합니다. `npm run test:features`, `npm run typecheck`와 영향받는 빌드·흐름으로 확인합니다. 생성 성공과 별개로 웹·앱 구현과 완료 조건을 검토합니다.
