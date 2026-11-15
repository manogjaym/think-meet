# 웹 기준 네이티브 디자인 검증

2026-11-14 · 최종 확인 완료

## 비교 기준

- 웹: `web/src/main.tsx`가 불러오는 실제 React 화면. 캡처는 `mobile/artifacts/design-parity/web-{phone,tablet}-*.jpg`입니다.
- 앱: 같은 서버·teacher1 계정을 쓰는 Android KMP 앱을 기존 `emulator-5554`에서 실행했습니다. 캡처는 `mobile/artifacts/design-parity/{phone,tablet}-*.png`입니다.
- iOS: 빌드·폰트 패키징만 검증했습니다. 실행 화면 비교에는 포함하지 않습니다.

### 화면 크기와 비교 영역

| 대상 | 실제 화면 | 밀도 | 비교할 콘텐츠 영역 |
|---|---|---|---|
| 휴대폰 Android | 1080×2400px | 420dpi / 2.625 | 상단 OS 128px·하단 63px 제외 후 411×842로 축소 |
| 태블릿 Android | 1600×1000px | 160dpi / 1 | 상단 OS 53px·하단 32px 제외한 1600×915 |
| 웹 휴대폰 | 콘텐츠 폭 411 CSS px | DPR 1 | 411×842 명시적 clip, 스크롤바 없는 캡처 콘텐츠 폭 411 |
| 웹 태블릿 | 콘텐츠 폭 1600 CSS px | DPR 1 | 1600×915 |

브라우저 크기를 바꾼 뒤 새 상태를 확인하고 영역을 명시해 clip으로 저장했습니다. 스크롤바가 있는 데스크톱 DOM의 clientWidth와 캡처 폭은 구별했습니다. 최종 휴대폰 미리보기는 x=24~387, 폭 363px로 앱과 같음을 확인했습니다. 초기 `iteration-1-*.png`에는 다른 캡처 조건의 자료가 있어 최종 수치 비교에서 제외했습니다.

### 비교 상태

같은 계정·기본 글자 크기를 사용하고 카메라·마이크는 껐습니다. 기존 지난 수업 상세(읽기 전용), 새 예약 양식, 제목·일정·참여 방식이 같은 수업 2개를 비교했습니다. 웹·앱의 LiveKit identity가 서로 대체되지 않도록 방 ID만 다르게 했습니다. 실제 입장 시각이 달라 수업 타이머에는 차이가 있습니다.

## 발견한 차이와 수정

| 우선순위 | 초기 비교에서 확인한 차이 | 수정 | 후속 확인 |
|---|---|---|---|
| P2 | 홈 빈 수업 카드의 균등 세로 배치로 문구·버튼이 내려감 | 웹처럼 위에서 순서대로 배치. 남는 공간은 진행 수업 하단에만 배분 | 최종 전체·부분 비교에서 해결 확인 |
| P2 | 로그인 글자 크기·설명·세로 간격 차이 | 웹 CSS 실측값 공유, CSS 적용 순서에 따른 변동 제거, Compose 줄 높이의 위아래 잘림 해제 | 최종 전체·부분 비교에서 해결 확인 |
| P2 | 앱 공개 수업 안내가 한 줄로 줄어 입장 화면 구성이 달라짐 | 웹의 제목·설명 카드 구조·경계·여백 복원 | 최종 전체·부분 비교에서 해결 확인 |
| P2 | 모바일 예약 양식의 날짜→시간 간격이 36px 대신 12dp | CSS에 맞춰 36dp 적용. 시간→체크 항목은 24dp | 최종 전체·부분 비교에서 해결 확인 |
| P2 | 웹 JS 일부의 회의 반응형 분기 값이 고정 숫자. 공유 참가자 페이지 탐색 간격이 12dp 초과 | 생성 JSON/CSS 전처리에 연결, 참가자 영역 90+52dp 확보 | 공통 분기 참조·컴파일 확인. 공유 툴바의 미디어별 실제 실행은 추가하지 않음 |

추가로 예약 탭 선택 표시, 빠른 입장 입력칸 세로 배치, 공개 안내의 -8px 위 여백, 필수 입력 * 색, 업로드 문구 색, 채팅 하단 여백을 보정했습니다. 수정 후 캡처는 아래 파일에 보관했습니다.

600~680dp의 계층형 헤더는 홈과 별도로 웹의 600dp 분기를 쓰도록 정적으로 확인했습니다. 이 마지막 분기 수정은 비교한 411/1600dp 화면을 바꾸지 않습니다.

## 최종 비교 자료

전체 화면 이미지의 왼쪽은 웹, 오른쪽은 앱입니다.

| 화면 | 휴대폰 | 태블릿 |
|---|---|---|
| 로그인 | `mobile/artifacts/design-parity/compare-phone-login.png` | `mobile/artifacts/design-parity/compare-tablet-login.png` |
| 홈 | `mobile/artifacts/design-parity/compare-phone-dashboard.png` | `mobile/artifacts/design-parity/compare-tablet-dashboard.png` |
| 수업 상세 | `mobile/artifacts/design-parity/compare-phone-detail.png` | `mobile/artifacts/design-parity/compare-tablet-detail.png` |
| 수업 예약 | `mobile/artifacts/design-parity/compare-phone-form.png` | `mobile/artifacts/design-parity/compare-tablet-form.png` |
| 입장 준비 | `mobile/artifacts/design-parity/compare-phone-prejoin.png` | `mobile/artifacts/design-parity/compare-tablet-prejoin.png` |
| 수업 | `mobile/artifacts/design-parity/compare-phone-meeting.png` | `mobile/artifacts/design-parity/compare-tablet-meeting.png` |
| 채팅 | `mobile/artifacts/design-parity/compare-phone-chat.png` | `mobile/artifacts/design-parity/compare-tablet-chat.png` |
| 자료 | `mobile/artifacts/design-parity/compare-phone-materials.png` | `mobile/artifacts/design-parity/compare-tablet-materials.png` |

부분 확대는 같은 두 원본에서 로고·내비게이션, 로그인, 양식, 빠른 입장, 입장 정보, 회의 헤더, 채팅 입력부, 자료 업로드·파일 행을 잘라 나란히 배치했습니다. 전체 이미지에서 읽기 어려운 글꼴·아이콘을 확인하기 위한 자료입니다.

- 태블릿: `focus-tablet-{navigation,login,dashboard,form,prejoin,meeting,chat,materials}.png`
- 휴대폰: `focus-phone-{dashboard,form,meeting,chat}.png`

### 필수 비교 항목

- 글꼴: 양쪽에 공식 Pretendard v1.3.9 400/500/600/700 번들. 실제 화면에서 크기·행간·자간·줄바꿈·한 줄 입력 높이 확인
- 간격·구성: 전체 화면, 헤더·카드·양식·하단 탐색·회의 조작부를 나란히 비교
- 색상·토큰: 네이티브 재정의 제거. 웹 색상·반경·의미 기반 토큰 공유
- 자산: 웹의 책 로고·39개 아이콘 도형을 그대로 사용. 네이티브도 같은 좌표로 변환. 대체 로고·Material 아이콘 사용 안 함
- 문구·내용: 주요 공통 문구·화면 영역 순서 등록. 기기 설정·권한·PiP는 플랫폼 동작 유지

## 결과와 실행 기록

최종 비교한 주요 화면에서 남은 P0/P1/P2 차이는 발견하지 못했습니다. P3 차이는 긴 한글+ISO 날짜 제목의 줄 나눔 위치, 입력·메시지 영역의 수 px 높이·테두리·래스터화입니다. 같은 제목의 줄 수와 핵심 영역 순서는 유지했습니다. 픽셀 단위 완전 일치를 뜻하지는 않습니다.

기존 에뮬레이터에서 휴대폰 1개 흐름(110.166초), 태블릿 1개 흐름(98.118초)이 통과했습니다. 확인 순서는 로그인→홈→지난 수업 상세→예약 양식→코드 입장→서버의 실제 연결 완료→채팅/자료 패널입니다.

초기 캡처 실행기의 저장소 경로와 빠른 스크롤로 첫 행을 지나치던 문제를 수정했습니다. 최종 로그는 `phone-capture.log`, `tablet-capture.log`입니다. 웹 콘솔 오류는 없었고, 페이지 이동 중 의도적인 연결 중단 경고 2개만 `web-console.json`에 기록했습니다.

## 확인하지 않은 범위와 플랫폼 차이

- iOS 기기·시뮬레이터의 화면 비교는 하지 않았습니다.
- OS 래스터화·키보드·날짜/시간 선택기·안전 영역·시스템 PiP는 허용된 플랫폼 차이입니다.
- 네이티브는 입장 전 마이크 입력 레벨을 제공하지 않아 기기 안내를 표시합니다. 가짜 미터는 사용하지 않습니다.
- 웹은 첫 입력에 자동 포커스합니다. 앱은 초기 상태에서 키보드를 열지 않습니다.
- 예약 완료·대기실·종료 안내는 공통 구현과 핵심 상태 테스트로 확인했습니다. 별도 실제 화면 캡처는 하지 않았습니다.
- 이번 스타일 변경에서는 공유 PDF/미디어/판서 도구별 전체 회귀와 PiP 실행을 반복하지 않았습니다.

## 완료 항목

- [x] 원본 로고·아이콘·글꼴·토큰·주요 문구·반응형 값 공유
- [x] 실제 초기 비교에서 발견한 구조·간격 문제 수정
- [x] 수정 후 휴대폰·태블릿 전체 화면 및 주요 상세 영역 비교
- [x] 최종 Android/iOS 결과물 갱신, 검증용 수업 2개 종료 확인(`cleanup.json`) 및 에뮬레이터 원래 설정 복원

최종 결과: passed
