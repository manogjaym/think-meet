# 기능 개발·공개 절차

기능은 서버·웹·Android·iOS의 해당 구현과 검증을 모두 마쳐야 완료입니다. 사용자가 범위를 한정했거나 서버 내부·OS 전용 작업이면 제외 사유를 기록합니다. 공통 파일을 추가해도 각 화면과 동작은 직접 구현해야 합니다.

## 새 기능 개발

1. **명세 작성:** `templates/feature.json`을 참고해 `catalog.json`에 고유 ID를 등록하고 `<id>.md`를 작성합니다. 동작·권한·상태·오류·휴대폰/태블릿 화면·완료 조건을 정합니다.
2. **계약 연결:** `contracts/openapi.json`의 `x-contract-revision`을 올립니다. 새 API/모델이나 `realtime.json` 명령을 정의하고, `x-feature`·`feature`·catalog의 참조를 같은 기능 ID로 연결합니다.
3. **생성:** `npm run shared:generate`를 실행합니다. 새 기능은 `planned` 또는 `in-progress`, `defaultEnabled:false`로 등록합니다. 기존 baseline에 새 endpoint를 붙여 자동 공개하면 검사가 실패합니다.
4. **함께 구현:** 서버 로직과 React·KMP Compose 화면을 구현합니다. 웹은 `useFeature(id)`, 앱은 `supportsFeature(id)`, API/Socket은 생성 정책으로 사용 가능 여부를 확인합니다. 플랫폼 전용 동작에는 OS 지원 조건도 적용합니다.
5. **변경 기록:** `features/changes/<작업>.json`에 플랫폼별 상태·제외 사유·검사 명령을 적습니다. shared 작업에서 웹·Android·iOS 중 일부만 완료하면 검사가 실패합니다.
6. **검증 후 ready:** 핵심 검사와 영향 화면 비교를 마친 뒤 `stage:ready`로 바꿉니다. 구현한 각 플랫폼에 아래 검증 기록이 필요합니다. iOS 빌드만으로 실제 화면 검증을 passed로 쓰지 않습니다.
7. **서버에서 공개:** 웹·앱 배포 준비 후 ready 기능을 명시적으로 켭니다. 준비 전 true 설정은 서버 시작 시 거부됩니다.

| 항목 | 값·조건 |
|---|---|
| 기능 단계 | `baseline`(기존 기능만), `planned`, `in-progress`, `ready` |
| 플랫폼별 구현 상태 | `pending`, `done`, `not-applicable`(이유 필수) |
| shared 대상 | `platforms`에 웹·Android·iOS 모두 등록 |
| 서버·플랫폼 전용 작업 | `change.scope`와 제외 이유 기록 |
| ready 검증 | `verification.status:passed`, `checks`(테스트 소스), `evidence`(결과 기록) |
| UI 검증 | web/android/ios 각각 `screens.phone/tablet`의 passed·evidence |

검증 기록 예시입니다. 경로는 실제 결과로 바꿉니다.

```json
{
  "status": "passed",
  "checks": ["web/test/example.test.mjs"],
  "evidence": ["features/evidence/example.md"],
  "screens": {
    "phone": {"status": "passed", "evidence": ["features/evidence/example-phone.png"]},
    "tablet": {"status": "passed", "evidence": ["features/evidence/example-tablet.png"]}
  }
}
```

## 공개 설정

기존 `classroom.core`와 네이티브 `meeting.pip`는 기본 사용 가능한 baseline입니다. **새 기능은 ready여도 기본 OFF**입니다. 등록·준비를 마친 기능만 서버 환경 변수에서 켭니다.

```sh
THINK_MEET_FEATURE_FLAGS='{"meeting.example":true}'
```

알 수 없는 ID, 잘못된 JSON/boolean, 준비 전 true는 서버 시작을 중단시킵니다. 설정 변경은 API 재시작·재배포 후 적용됩니다. 이 기반 작업에서 실행 중인 서비스를 임의로 재시작하지 않습니다.

## 클라이언트 지원·권한

클라이언트는 공개 `GET /api/v1/capabilities`로 사용 가능 여부를 확인합니다.

- 새 기능은 서버 true, 로컬 구현, 대상 플랫폼, 양쪽 계약 revision이 모두 맞아야 켜집니다. 조회 실패·미등록·미지원이면 꺼집니다.
- 구 서버의 명시적 404 응답에서는 현재 baseline만 허용합니다.
- 성공 응답은 120초 캐시하고 재조회합니다. 서버가 명시한 false는 캐시 만료·일시 장애로 해제하지 않습니다. 해당 키의 명시적 true 또는 구 서버 404 전환에서만 해제합니다.
- 서버는 UI를 우회한 HTTP/Socket 요청도 검사합니다. 기능 설정은 권한을 부여하지 않습니다.
- 기능을 꺼도 정리 요청은 기존 인증·owner 권한에 따라 허용합니다. OFF 설정이나 완료 표시가 실제 구현을 대신하지 않습니다.

## 자동 검사

```sh
npm run shared:check
npm run shared:check -- --changed-files changed-files.txt
npm run verify
```

생성물, 구버전 호환성, 서버 route/Socket 등록, 기능·계약 참조, 구현 소스, ready 조건, PR의 플랫폼별 변경 기록을 검사합니다. 추가 테스트는 변경에 필요한 동작만 실행합니다. 전체 서버·영상·PDF·PiP 검사를 매번 반복하지 않습니다.

원격 CI는 `.github/workflows/cross-platform.yml`에 준비되어 있습니다. 현재 루트가 Git 저장소가 아니므로 원격 실행·branch protection은 아직 적용하지 않았습니다. 원격 병합을 차단하려면 모든 공통 폴더를 같은 checkout에 넣고 다음 검사를 필수로 연결해야 합니다.

- `Contracts and feature parity`
- `Web and server`
- `Android and iOS`

하위 Git 메타데이터는 자동 변경하지 않습니다.
