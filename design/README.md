# 공통 디자인 안내

웹과 Android/iOS가 함께 사용하는 디자인 원본입니다. 기준 화면은 `web/src/main.tsx`가 불러오는 React 화면과 CSS입니다. 사용하지 않는 `theme.css`·`education-theme.css`는 기준에서 제외합니다.

로고·아이콘·글꼴·문구·토큰·반응형 값·화면 구성을 공유합니다. **플랫폼별 시각 값 재정의는 허용하지 않습니다.** 생성기는 비어 있지 않은 `platformOverrides`를 거부합니다.

## 수정할 원본

| 파일 | 역할 |
|---|---|
| `tokens.json` | 색상·글자·행간·굵기·간격·모서리·컴포넌트 크기·반응형 분기 |
| `web-aliases.json` | 웹 CSS 이름과 공통 토큰 연결 |
| `assets/vectors.json` | 책 로고와 46개 아이콘 도형 |
| `fonts/manifest.json` | Pretendard 버전·굵기·웹/앱 파일명·SHA-256 |
| `fonts/*.{woff2,otf}`·`fonts/LICENSE.txt` | 배포할 글꼴과 라이선스 |
| `system.json` | 공통 문구, 화면 구현 파일·영역 순서·레이아웃 토큰, 네이티브 조정 범위 |
| `scripts/`·`test/` | 생성·검사·CSS 반응형 치환·생성기 테스트 |

### 색상·글자·크기

웹은 생성 CSS 별칭·`--tm-*`, 앱은 같은 역할의 `DesignTokens`를 사용합니다.

| 역할 | 웹 | 앱 |
|---|---|---|
| 보조 글자 | `--type-support` | `Typography.Support` |
| 제목 행간 | `--line-title` | `LineHeight.Title` |

숫자가 같아도 `FontSize.S15` 같은 크기 토큰으로 대신하지 않습니다. 역할별 값이 바뀌면 두 구현이 달라질 수 있습니다.

크기는 웹 `px`·앱 `dp`, 글자는 웹 `rem`·앱 `sp`로 생성합니다. 변환 기준은 `1rem = 16px`입니다. 기기 밀도·사용자 글자 확대·OS 렌더링 차이는 남습니다.

### 로고·아이콘

`assets/vectors.json`에서 React 도형과 Compose `ImageVector`를 같은 좌표로 생성합니다. 책 로고나 아이콘을 비슷한 Material 아이콘 등으로 대체하지 않습니다.

변환기는 path·circle·ellipse·rounded rect를 지원합니다. 새 도형이 필요하면 원본과 변환기를 함께 수정합니다.

### 글꼴

Pretendard **v1.3.9**의 Regular 400·Medium 500·SemiBold 600·Bold 700을 번들에 넣습니다. 웹은 WOFF2, Compose는 OTF를 사용해 CDN 없이도 같은 글꼴을 불러옵니다.

공식 출처는 `fonts/manifest.json`, 라이선스는 SIL Open Font License 1.1입니다. CSS 이름은 기존 호환성을 위해 `Pretendard Variable`을 유지하지만 실제 파일은 네 굵기의 정적 파일입니다.

생성 시 파일별 SHA-256을 검사합니다. 업데이트할 때 공식 버전·두 형식·체크섬·라이선스를 함께 확인합니다. 출처를 확인하지 않은 파일의 해시를 검사 통과용으로 등록하지 않습니다.

### 반응형 분기

CSS 미디어 쿼리에서는 CSS 변수 대신 다음 구문을 씁니다.

```css
@media (max-width: design(layout.dashboardCompact)) { /* ... */ }
@media (min-width: design(layout.prejoinWide + 1)) { /* ... */ }
```

Vite 플러그인은 생성된 `design-layout.json`을 읽어 값을 px로 바꿉니다. 앱은 같은 값의 `Layout.DashboardCompact`·`Layout.PrejoinWide`를 사용합니다.

`design(...)`은 표준 CSS가 아니므로 반드시 Vite를 거쳐 배포합니다. 덧셈은 `+ 1`처럼 0 이상의 정수만 지원합니다.

## 생성 결과

아래 **20개 출력**은 직접 편집하지 않습니다.

| 대상 | 결과 |
|---|---|
| `web/src/generated/` | `design-tokens.css`, `design-vectors.ts`, `design-content.ts`, `design-layout.json`, `design-palette.ts`, `design-fonts.css` |
| `mobile/.../design/generated/` | `DesignTokens.kt`, `DesignVectors.kt`, `DesignContent.kt`, `SharedFonts.kt` |
| `web/public/design/fonts/` | WOFF2 네 파일과 라이선스 |
| `mobile/composeApp/src/commonMain/composeResources/` | `font/`의 OTF 네 파일과 `files/Pretendard-LICENSE.txt` |

생성기는 Node 기본 모듈만 사용합니다. 바뀐 파일만 고유한 임시 파일을 거쳐 원자적으로 교체합니다. 누락을 검사할 수 있도록 원본과 생성물을 함께 관리합니다.

## 변경 순서

1. 현재 웹 화면과 `system.json`의 해당 화면을 확인합니다.
2. 저장된 생성물을 먼저 검사한 뒤 원본 값·문구·자산을 수정합니다. 화면 구성·상호작용을 바꾸면 웹·Compose 구현과 `system.json`도 수정합니다.
3. 생성하고 다시 검사합니다.

   ```sh
   # 저장소 루트
   node design/scripts/generate.mjs --check
   node design/scripts/generate.mjs
   node design/scripts/generate.mjs --check
   ```

4. 생성기·원본 형식을 바꿨다면 관련 테스트를 실행합니다.

   ```sh
   node --test design/test/*.test.mjs
   ```

5. 영향 화면을 **같은 계정·데이터·상태**로 웹·앱에서 비교합니다. 휴대폰·태블릿 모두 확인하고 OS 안전 영역, 실제 화면 폭, 글자 확대 조건을 기록합니다. 값만 바꿨다면 전체 서버·미디어 검사를 반복하지 않습니다.

생성기는 Node 18 이상, 웹 빌드는 `web/package.json`의 Node 버전이 필요합니다. 절대 경로로 실행해도 같은 원본을 읽습니다. `--out-dir <경로>`는 임시 출력, `--check`는 파일 수정 없는 검사에 사용합니다.

## 빌드와 CI

- **Vite:** 빌드 전에 생성하고 `design/` 변경을 감시합니다. 스타일·자산은 HMR, 반응형 JSON은 전체 새로고침으로 반영합니다.
- **Gradle:** `generateDesignTokens`가 Kotlin 컴파일·공통 리소스 복사 전에 실행됩니다. 읽기 전용 검사는 `:composeApp:checkDesignTokens`입니다. Node를 찾지 못하면 `-PdesignNodeExecutable=/절대/경로/node`를 지정합니다.
- **웹 명령:** `npm run design:generate`·`npm run design:check`도 같은 생성기를 씁니다.
- **Docker:** 웹 빌드 컨텍스트는 루트입니다. `design/`·`web/`·`mobile/` 상대 위치를 유지합니다.

CI는 **빌드 전에** `--check`를 실행해 오래된 생성물을 찾습니다. 이후 필요한 테스트와 웹·앱 빌드를 실행합니다. 결과는 `VERIFICATION.md`와 작업별 기록에서 확인합니다.

## 직접 구현·확인할 범위

생성기는 값·자산·문구를 공유하고 `system.json`의 참조 파일·레이아웃 토큰 존재를 검사합니다. **React 화면을 Compose 화면으로 변환하지는 않습니다.** 영역 순서·카드 배치·선택 상태·탐색·상호작용은 양쪽에 구현하고 실제 화면을 비교합니다. 화면 일치나 접근성도 별도로 확인해야 합니다.

OS 안전 영역·키보드·권한·기기 선택기·추가 터치 범위·시스템 PiP·ReplayKit·미디어 렌더러는 플랫폼에 맞게 구현합니다. 앱 전용 배너·브랜드·글꼴·밝기 테마는 추가하지 않습니다. 글꼴 렌더링과 OS 글자 확대 차이는 검증 기록에 남깁니다.
