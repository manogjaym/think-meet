# 공통 기능 개발 기반 검증

검증일: 2026-11-14. 기존 웹·앱 디자인과 실행 중인 서버 데이터는 유지했습니다.

| 대상 | 실제 결과 | 기록 |
|---|---|---|
| 공통 명세/기능 상태 | 생성물 7개 read-only 검사, 구버전 호환, REST/Socket handler coverage, catalog 및 변경 기록 검사 통과 | `npm run shared:check`; 대표 변경 파일 목록을 사용한 change-record gate도 통과 |
| 생성기·정책 핵심 검사 | 계약 7개 + 디자인 5개, 서버 availability/권한/cleanup 11개, 웹 capability 4개 통과 | [통합 로그](../mobile/artifacts/feature-foundation-verify.log) |
| 웹·서버 | TypeScript 검사와 웹 production 빌드 통과 | 같은 통합 로그 |
| 웹 Docker | 공통 contracts/features/design와 필요한 native source를 포함한 root build context로 build stage 성공 | [Docker 로그](../mobile/artifacts/feature-foundation-docker.log) |
| KMP 공통 로직 | Android JVM 단위테스트 16개, 실패/오류/skip 0 | [모바일 검증](../mobile/artifacts/contracts-mobile-build-verification.json) |
| Android | 최신 debug APK 및 instrumentation APK 빌드 성공 | [빌드 로그](../mobile/artifacts/contracts-mobile-final-build.log) |
| 기존 Android 에뮬레이터 | 최종 APK로 읽기 전용 smoke 1개 통과: teacher1 세션, 생성 모델로 수업 16개 decode, 구 서버 baseline 협상, 미등록 기능 차단 | [실행 로그](../mobile/artifacts/feature-foundation-emulator.log) |
| iOS | Simulator arm64 KMP framework 및 Swift host 앱 빌드 성공, 폰트/라이선스·연결 바이너리 확인 | [iOS 빌드 로그](../mobile/artifacts/contracts-ios-build.log), [모바일 검증](../mobile/artifacts/contracts-mobile-build-verification.json) |

추가 확인 사항:

- 누락된 inbound Socket handler와 잘못된 query schema 참조를 검사합니다.
- 웹 visible 탭의 120초 갱신과 강제 갱신 중 유효 응답 보존을 확인했습니다. 핵심 검사·타입 검사·Vite 빌드를 통과했습니다.
- 네이티브는 응답에서 키가 빠지거나 캐시가 만료·일시 장애가 생겨도 이전의 명시적 false를 유지합니다. 해당 키의 true 또는 구 서버 404에서만 해제하는 동작을 핵심 테스트로 확인했습니다.
- Docker는 공통 폴더를 포함한 build context를 확인했습니다. 실행 중인 서비스 이미지는 교체하지 않았습니다.

## Android 실행 방법

기존 `emulator-5554`에서 검증했습니다. 앱 주소 `192.168.0.64`가 개발 PC 주소와 달라 최초 연결은 실패했습니다.

최종 검사는 instrumentation의 TCP 주소만 `10.0.2.2`로 바꿔 통과했습니다. 저장된 로그인·앱 서버 설정·TLS 검증과 일반 화면 통신 경로는 유지했습니다. 이 모드에서는 화면 표시 검사를 생략했습니다. 에뮬레이터 해상도·밀도·서버 데이터도 변경하지 않았습니다.

기존 teacher1 세션을 사용하는 읽기 전용 재실행 명령입니다.

```sh
adb -s emulator-5554 shell am instrument -w -r \
  -e class com.woongjin.thinkmeet.ContractCompatibilitySmokeTest \
  -e contractRouteAddress 10.0.2.2 \
  com.woongjin.thinkmeet.test/androidx.test.runner.AndroidJUnitRunner
```

## 검증 범위

- **기능 정책:** 새 기능의 준비 상태·플랫폼·양쪽 revision·서버 설정을 검사했습니다. 명시적 false, 캐시 만료·일시 장애, 취소, 구 서버 404, cleanup 권한도 핵심 테스트로 확인했습니다.
- **서버:** 실행 중인 Docker API는 재배포하지 않았습니다. 신규 정책은 로컬 테스트·빌드, 기존 서버 호환성은 에뮬레이터로 확인했습니다.
- **화면·미디어:** 디자인 변경이 아니므로 영상·PDF·PiP 전체 흐름과 크기별 화면 비교는 반복하지 않았습니다. 기존 기록은 [design/VERIFICATION.md](../design/VERIFICATION.md)에 있습니다.
- **iOS:** 빌드·리소스 연결만 확인했습니다. 기기·시뮬레이터 실행은 하지 않았습니다.
- **원격 CI:** 루트가 Git 저장소가 아니므로 workflow 실행·branch protection 설정은 하지 않았습니다. `.github/workflows/cross-platform.yml`과 PR gate는 공통 폴더가 같은 checkout에 포함된 저장소에 연결해야 합니다.
- **기존 경고:** Vite config·dynamic import·chunk 크기 경고는 빌드를 막지 않았습니다. 번들 구조는 변경하지 않았습니다.
