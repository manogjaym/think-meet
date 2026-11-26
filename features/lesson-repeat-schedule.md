# 반복 수업 예약

선생님은 **새 수업 예약** 화면에서 날짜·시간 아래의 **반복**을 골라 같은 시각의 수업을 여러 개 한 번에 예약할 수 있습니다. 기능 ID는 `classroom.repeat-schedule`, 계약 revision은 16입니다.

## 동작

1. **반복 없음**(기본)·**매주**·**격주** 중 하나를 고릅니다. 반복 없음은 기존처럼 수업 하나를 만듭니다.
2. 매주·격주를 고르면 원형 **월~일** 버튼이 나타납니다. 처음에는 수업 날짜의 요일이 선택되어 있으며 여러 요일을 고를 수 있습니다.
3. **반복 종료일**은 처음에 수업 날짜로부터 27일 뒤(4주)로 채워집니다. 종료일 당일도 포함합니다.
4. 아래에 `{첫 날짜}부터 {마지막 날짜}까지 총 N회 예약돼요.`를 표시하고, 저장 버튼은 **수업 N회 예약**으로 바뀝니다.
5. 저장하면 날짜마다 별도 수업(각자의 참여 코드·링크)이 만들어집니다. 제목·내용·과목·참여 방식·초대 학생·수업 시간은 모두 같습니다. 완료 화면에 `반복 수업 N개를 예약했어요.`를 표시하고 첫 수업을 보여 줍니다.

| 항목 | 규칙 |
|---|---|
| 날짜 기준 | 한국 시간(Asia/Seoul). 수업 날짜(첫 날짜)부터 반복 종료일까지 선택한 요일 |
| 격주 | 첫 날짜가 속한 주(월요일 시작)를 1주차로 보고 1·3·5…주차만 예약 |
| 첫 날짜 | 수업 날짜의 요일을 해제하면 그날은 예약하지 않고 다음 선택 요일부터 시작 |
| 최대 횟수 | 한 번에 100회 |
| 수정·취소 | 만든 뒤에는 수업별로 기존 **일정 수정**·**예정 수업 취소**를 사용. 수정 화면에는 반복이 없습니다. |

## 계약·서버

- `POST /api/v1/lesson-series`(`createLessonSeries`), 요청 `LessonSeriesInput { lesson: LessonInput, repeat: LessonRepeat }`, 응답 `LessonSeries { lessons }`(시작 순).
- `LessonRepeat`: `frequency`(`WEEKLY`·`BIWEEKLY`), `weekdays`(ISO 1=월~7=일, 1~7개, 중복 불가), `until`(`YYYY-MM-DD`).
- 서버(`server/src/lesson-series.ts`)가 날짜를 다시 계산하고, 기존 `createLesson`과 같은 제목·시간·과목·학생 검사를 한 뒤 **한 트랜잭션**으로 만듭니다. 하나라도 실패하면 아무 수업도 만들지 않습니다.
- 선생님만 사용할 수 있습니다(학생 `FORBIDDEN` 403). 요일 없음·종료일이 수업 날짜보다 이름·해당 날짜 없음·100회 초과는 `VALIDATION`(400)입니다.
- revision 15 이하 웹·앱에는 반복 항목이 보이지 않고, 서버는 그 요청을 `CLIENT_UPDATE_REQUIRED`(426)로 거부합니다.

## 화면

웹 `web/src/components/LessonRepeatField.tsx`, 앱 `mobile/.../ui/LessonRepeat.kt`가 같은 문구(`design/system.json`의 `lessonRepeat*`)와 배치를 사용합니다. 휴대폰 폭에서는 요일 버튼 7개가 한 줄에 들어가도록 최대 44px 안에서 줄어듭니다. 앱의 날짜 입력은 기존 수업 날짜와 같이 텍스트 입력과 달력 버튼을 함께 제공합니다.

## 한계

- 반복으로 만든 수업은 서로 연결 정보가 없습니다. "이후 일정 모두 수정·취소"는 제공하지 않습니다.
- 월 단위 반복, 횟수로 끝내기, 공휴일 제외는 없습니다.

## 검증

2026-11-25 한국 시간 검사 명령과 결과는 [변경 기록](changes/lesson-repeat-schedule.json)에 있습니다. 서버·웹·Android는 실제 실행으로 확인했고, iOS는 Kotlin 컴파일만 했습니다. 실제 iPhone·iPad 실행 전까지 `in-progress`로 둡니다.

| 화면 | 휴대폰 | 태블릿·PC |
|---|---|---|
| 반복 선택 | [웹 390×844](evidence/lesson-repeat-schedule/web-phone-form.png) · [웹 요약](evidence/lesson-repeat-schedule/web-phone-summary.png) · [Android](evidence/lesson-repeat-schedule/android-phone-form.png) | [웹 834×1194](evidence/lesson-repeat-schedule/web-tablet-form.png) · [웹 1280×800](evidence/lesson-repeat-schedule/web-desktop-form.png) · [Android 180dpi](evidence/lesson-repeat-schedule/android-tablet-form.png) |
| 요일 없음 오류 | [웹](evidence/lesson-repeat-schedule/web-phone-error.png) | |
| 예약 완료 | [웹](evidence/lesson-repeat-schedule/web-phone-created.png) · [Android](evidence/lesson-repeat-schedule/android-phone-created.png) | |
