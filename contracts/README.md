# 공통 API·Socket 계약

웹·서버·KMP가 함께 사용하는 통신 규격입니다.

| 원본 | 내용 | 경로 |
|---|---|---|
| `openapi.json` | REST 요청·응답(OpenAPI 3.0.3) | `/api/v1` |
| `realtime.json` | Socket.IO 접속 정보, 이벤트·명령 데이터 | `/socket.io` |

## 수정과 생성

루트에서 저장된 생성물을 먼저 검사하고, 원본 수정 후 다시 생성합니다.

```sh
node contracts/scripts/generate.mjs --check
node contracts/scripts/generate.mjs
node contracts/scripts/check.mjs
```

아래 생성물 7개는 직접 편집하지 않고 원본과 함께 관리합니다.

- 웹: `web/src/generated/{contracts,feature-policy}.ts`
- 서버: `server/src/generated/{contracts,feature-policy,openapi-document}.ts`
- KMP: `mobile/composeApp/src/commonMain/kotlin/com/woongjin/thinkmeet/data/generated/{ContractModels,ContractProtocol}.kt`

웹·서버는 생성 타입을 사용하고, KMP는 같은 모델로 데이터를 읽고 씁니다. 쿠키, 업로드 스트리밍, 오류 처리, Socket.IO transport는 기존 어댑터에 유지합니다. 기존 HTTP 클라이언트를 새 라이브러리로 교체하지 않습니다.

## 오류 코드·명령·연산 생성물

| 생성물 | 원본 | 용도 |
|---|---|---|
| TS `ErrorCode`·`ERROR_CODES`, Kotlin `ErrorCodes` | `components.schemas.ErrorCode` | 서버 `ApiError`는 이 값만 받습니다. 클라이언트는 부분 문자열이 아니라 값 전체로 비교합니다. |
| TS `ApiOperations`·`API_OPERATIONS` | `paths` | 웹의 타입 지정 호출 `call(operationId, …)` |
| TS `FEATURE_IDS` | `features/catalog.json` | 기능 ID 오타를 컴파일 시점에 막습니다. |
| Kotlin `Commands`(`ContractCommand<P>`) | `realtime.json` `commands` | 앱의 타입 지정 명령 전송 |

`ErrorResponse.code`와 `RealtimeError.code`는 구버전 호환을 위해 string으로 둡니다. 서버에 새 오류 코드가 필요하면 `ErrorCode` enum에 먼저 추가합니다. enum 값을 추가하는 것은 호환되는 변경입니다.

## 생성기 지원 범위

- 지원: string/enum, integer/int64, number, boolean, 배열, 모델 참조, nullable/default 참조 wrapper, object/map, ack oneOf.
- `oneOf`: TypeScript는 union으로 생성합니다. KMP ack는 JSON discriminator로 분기를 고른 뒤 해당 타입으로 해석합니다.
- Kotlin 직렬화: 기본값이 null인 optional non-null 필드는 `@EncodeDefault(NEVER)`로 생략합니다. 무제한 수업의 required nullable `endsAt`는 null을 명시합니다.
- 새 표현을 쓰려면 생성기와 핵심 검사를 함께 확장합니다. 미지원 구문을 `any`로 바꾸지 않습니다.

Nest Swagger는 같은 생성 문서를 `/api/docs`, `/api/openapi.json`에 제공합니다. POST 기본 성공 코드는 201입니다. 서버 내부 LiveKit gateway 인증은 공개 계약에서 제외합니다.

## 구버전 호환성

`compatibility/v1.json`은 기존 클라이언트의 기준 계약입니다. **배포한 기준 파일을 수정해 검사를 통과시키지 않습니다.**

| 변경 | 처리 |
|---|---|
| optional 필드·query, 새 경로·명령 추가 | 허용. 새 기능 카탈로그에도 연결 |
| 기존 필드·경로·명령 삭제 | 거부 |
| 타입·enum·nullable·기본값·제약·handshake 변경 | 거부 |
| 필수 필드·파라미터 추가 | 거부 |
| 호환성을 깨는 변경 | 별도 버전과 마이그레이션 설계 |

새 기능을 등록하면 `x-contract-revision`을 올리고 웹·앱 생성물을 빌드합니다. 이 값은 지원 여부를 확인하는 빌드 상수입니다. 앱 표시 버전과 별개이며, 설치된 앱은 기존 revision을 계속 보냅니다.

## 요청 정보와 권한

| 연결 | 플랫폼·revision 전달 방식 |
|---|---|
| HTTP | `X-ThinkMeet-Platform`, `X-ThinkMeet-Contract-Revision` 헤더 |
| 브라우저 Socket.IO | `auth: {platform,contractRevision}` |
| 네이티브 Socket.IO | upgrade 헤더 |

서버는 헤더를 우선합니다. 이 정보는 지원 여부만 판단하며, 인증·권한은 세션 쿠키와 수업 권한으로 검사합니다.

수업 leave/end의 `x-cleanup:true`와 share.stop의 `cleanup:true`는 기능이 꺼져도 정리 요청을 허용합니다. 로그인·소유자 권한 검사는 그대로 적용합니다.

HTML video/PDF와 네이티브 미디어는 기존 인증 쿠키·Range 경로를 유지합니다. 헤더를 추가하려고 파일 전체를 Blob이나 메모리에 올리지 않습니다. 새 기능 제한이 필요한 콘텐츠 경로는 플랫폼별 요청 정보 전달도 함께 설계합니다.

## 서버 검사 범위

공개 route 검사는 `server/src`의 모든 파일(generated 제외)을 대상으로 합니다.

- `@Controller('api/v1…')` 클래스의 prefix와 메서드 경로를 합쳐 계약과 양방향으로 비교합니다. 그래서 컨트롤러는 여러 파일로 나눌 수 있습니다.
- `internal` 컨트롤러는 공개 계약에서 제외합니다.
- 경로는 작은따옴표 문자열로 씁니다. `api/v1` 밖의 공개 prefix는 거부합니다.
- `@SubscribeMessage`도 모든 파일에서 모으며, 한 이벤트에 handler는 하나만 둡니다.

실제 동작·권한·상태 전이는 계약 검사와 함께 필요한 동작 테스트로 확인합니다.
