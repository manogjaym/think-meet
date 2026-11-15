# 모바일 개발 지침

## 화면·디자인

- Android/iOS는 KMP·Compose와 기존 플랫폼 미디어 연결을 유지합니다. 웹을 흉내 내는 WebView로 대체하지 않습니다.
- 기준은 활성 웹 화면·CSS와 `../design/system.json`입니다. UI 기반·반응형 변경 전 `../design/README.md`를 읽습니다.
- `design/generated/`의 `DesignTokens`, `DesignContent`, `DesignVectors`, `SharedFonts`와 `design/` 공통 컴포넌트를 재사용합니다. 수정은 `../design/` 원본에서 합니다. 생성 Kotlin·복사 글꼴·앱 전용 재정의는 편집하지 않습니다.
- 원본 책 로고·아이콘과 번들 Pretendard 400/500/600/700을 사용합니다. Material 기호·시스템 글꼴·추가 슬로건·그라데이션 배너·앱 전용 수업 테마로 대체하지 않습니다.
- 웹과 같은 역할의 토큰(`Typography.Support`, `Typography.Title`, `LineHeight.Title`, 컴포넌트·레이아웃)을 사용합니다. 같은 숫자의 크기 토큰으로 대신하지 않습니다. 글자 크기 변경 시 행간·자간도 명시합니다.
- 웹과 영역·순서·탐색 의미·반응형 분기를 맞춥니다. 구조 변경 시 Compose 구현과 `../design/system.json`을 함께 수정합니다. 계약 파일이 화면을 자동 구현하지는 않습니다.
- 안전 영역·키보드·권한/기기 선택·추가 터치 범위·PiP·ReplayKit·영상/PDF/미디어 표면은 네이티브 방식을 허용합니다. 스타일 변경 중 인증·입장·방 소유권·캡처 정리·실시간·판서 동작을 보존합니다.

## 검증

- 같은 계정·데이터·상태로 웹·앱의 휴대폰·태블릿 화면을 비교합니다. 현재 실제 캡처로 일치를 판단하고 Android 실행·iOS 빌드·실제 iOS 실행을 구분합니다.
- 변경에 필요한 검사만 실행합니다. 기존 에뮬레이터를 우선 사용하고 원래 설정을 보존합니다. 이번 검증에서 만든 데이터만 정리합니다. 단독 스타일 변경에 전체 서버·미디어 검사를 반복하지 않습니다.

## 계약·기능 지원

- HTTP/Socket DTO·경로·이벤트·기능 정보는 `../contracts/`와 `../features/catalog.json`에서 생성합니다. 별도 통신 DTO를 만들거나 `data/generated/`를 직접 편집하지 않습니다. `generateContracts`, 읽기 전용 `checkContracts`를 사용합니다.
- 새 기능 UI는 capabilities를 상태로 구독하고 `supports()`와 OS·기기 지원을 함께 확인합니다. 모르는 기능은 OFF입니다.
- capabilities 조회 실패 시 생성된 플랫폼 baseline만 허용합니다. 이전 서버의 명시적 false는 키 누락·조회 실패로 해제하지 않습니다. 해당 키의 명시적 활성화 또는 구 서버 404에서만 해제합니다.
- 생성된 정리 요청 예외를 지키고 서버의 인증·권한 검사를 유지합니다.
