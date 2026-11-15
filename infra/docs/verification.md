# 검증 기록

## 로컬 Docker 설정 통합 (2026-11-14)

로컬 `Caddyfile`, `livekit.yaml`, `minio-policy.json`을 `infra/local/`로 옮겼습니다. 이동 전후 해시·권한이 같음을 확인했습니다. 비밀 설정은 출력하지 않았고 AWS Terraform 구성·상태는 유지했습니다.

변경한 경로:

- Compose bind, bootstrap 정책·LiveKit 출력, 테스트 시작 스크립트의 파일 확인 경로
- bootstrap의 새 `LOCAL_INFRA` 경로. 서버 기준 `ROOT`와 `.env`·DB·백업 경로는 유지
- 생성 LiveKit 설정의 Git 제외 규칙을 `infra/.gitignore`로 이동

필요한 로컬 검사 결과:

- 이동한 3개 파일의 내용·권한 보존 확인
- `server/` 기준 `docker compose config --quiet` 통과
- bootstrap Python 및 시작 shell 구문 검사 통과 (초기화 자체는 실행하지 않음)
- Git 제외 규칙 확인: 비밀 LiveKit 설정 제외, Caddy·MinIO 정책 추적 가능
- 기존 API health HTTP 200, API healthy 및 웹·LiveKit 실행 상태 유지

서비스 재생성·seed·DB 작업·AWS 배포는 하지 않았습니다. 컨테이너는 이미 읽은 설정으로 계속 동작합니다. 새 bind 경로는 이후 `server/`에서 `docker compose up -d`할 때 적용됩니다. 단순 restart로는 반영되지 않습니다.

## 최상위 공통 인프라 폴더 분리 (2026-11-14)

AWS 공통 구성을 `web/`, `server/`, `mobile/` 옆의 `infra/`로 옮겼습니다. 숨김 파일을 포함한 기존 189개 파일의 해시·심볼릭 링크·권한이 원본과 같음을 확인했습니다. Terraform 설정값·상태 키·잠금 파일·배포 ZIP·구성도는 유지했습니다.

함께 정리한 항목:

- 문서 실행 위치, Docker 제외 경로, 구성도 렌더러의 Playwright 탐색 경로
- 로컬 `.build` 생성 유틸리티 4개의 경로 계산을 현재 파일 위치 기준으로 변경
- 과거 JSON 검증 기록의 이력 경로 유지
- 테스트 `terraform.tfvars`의 공백만 정렬하고 비공백 내용 보존 확인

실행 결과:

- 인프라 오프라인 계약 테스트 10개 통과
- Terraform 전체 `fmt -check -recursive` 통과
- 검증 shell 및 렌더러/보존 유틸리티 구문 검사 통과
- 이동한 렌더러 2개의 기존 Playwright 의존성 탐색 통과
- 공통 생성물·호환성·기능 상태의 read-only 검사 통과

위치 변경에 필요한 로컬 검사만 수행했습니다. 공급자 다운로드·Terraform init/plan/apply·AWS 변경·서버 배포·구성도 재생성은 하지 않았습니다. 당시 기존 위치에 둔 LiveKit·Caddy 설정은 이후 위 작업에서 `local/`로 옮겼습니다.

## 테스트 실행 구성 통합

`terraform/test`를 하나의 Terraform root로 통합했습니다.

- 입력: `terraform.tfvars` 하나
- 실행: 해당 폴더에서 `terraform init` → `terraform apply`
- 상태: 로컬 상태 하나 또는 조직에서 준비한 원격 backend의 상태 하나
- 의존성: bootstrap이나 다른 Terraform 상태를 읽지 않음
- 운영: 기존 분리 구성 유지

기존 AWS 리소스·Helm 릴리스·IRSA 모듈 주소와 서버 전달 출력은 보존했습니다. 연결 방식은 다음과 같습니다.

- `terraform_remote_state`나 EKS/S3 재조회 대신 리소스를 직접 참조합니다.
- 관리자 권한·앱 노드·EKS 기본 애드온이 준비된 뒤 Helm을 설치합니다.
- Prometheus 읽기 전용 RBAC는 같은 Helm 릴리스의 `extraManifests`로 관리합니다. Kubernetes provider는 필요하지 않습니다.

Metrics Server 차트는 숫자 0을 생략하므로 PDB를 `maxUnavailable=1`로 설정했습니다. 기본 애드온의 PDB를 고려해 EKS 기본 노드 교체 방식도 유지했습니다. API 원본은 CloudFront 전용 인증 헤더를 검사합니다. EKS API는 기본 비공개이며 외부 실행기는 명시한 제한 CIDR로만 접근합니다.

```bash
./infra/scripts/validate.sh --init
```

검증 대상은 운영 4개 스택과 테스트 1개입니다. 계약 테스트 10개와 Terraform 형식·공급자 스키마를 검사했습니다. 잠금 파일의 버전은 유지했습니다: AWS 6.72.0, TLS 4.4.2, Random 3.9.1, Local 2.9.1, Kubernetes 2.38.0, Helm 3.3.0. 테스트 구성은 Local·Kubernetes provider를 쓰지 않습니다.

결과:

- 계약 테스트 10개와 5개 스택의 형식·공급자 검증 통과
- Terraform 1.5.7·Helm provider 3.3.0으로 임시 구성의 최초 계획 통과. 클러스터 주소는 apply 후 결정되는 조건이었으며 클러스터 접속은 불필요했음. [Helm의 동일 apply 배포 방식](https://developer.hashicorp.com/terraform/tutorials/kubernetes/helm-provider)을 따름
- 실제 테스트 values를 Terraform으로 평가하고, 고정된 공식 LBC·Metrics Server·Prometheus 차트를 `helm template`으로 렌더링
- 단일 복제 수·Recreate·Metrics Server `maxUnavailable=1`·제한된 Prometheus RBAC 확인

실제 AWS plan/apply·서버 배포·성능 시험은 수행하지 않았습니다. 도메인·Hosted Zone·실행기의 API 접근 경로·리전 할당량은 실제 환경에서 확인해야 합니다.

<a id="addons-version-sources"></a>

## 애드온 고정 버전과 공식 근거

확인일: 2026-11-07. 코드에서 `latest`를 사용하지 않습니다.

| 구성 | 고정 버전 | 공식 소스 |
|---|---|---|
| AWS Load Balancer Controller chart/image | 3.6.2 / v3.6.2 | [AWS chart index](https://aws.github.io/eks-charts/index.yaml), [v3.6.2 release](https://github.com/kubernetes-sigs/aws-load-balancer-controller/releases/tag/v3.6.2) |
| LBC IAM 정책 | v3.6.2 원본 | [공식 태그의 iam_policy.json](https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v3.6.2/docs/install/iam_policy.json) |
| Metrics Server chart/image | 3.14.0 / v0.9.0 | [공식 chart index](https://kubernetes-sigs.github.io/metrics-server/index.yaml), [지원 표: 0.9.x는 Kubernetes 1.34+](https://github.com/kubernetes-sigs/metrics-server#compatibility-matrix) |
| Cluster Autoscaler chart/image | 9.59.0 / v1.36.1 | [공식 chart index](https://kubernetes.github.io/autoscaler/index.yaml), [1.36.1 release](https://github.com/kubernetes/autoscaler/releases/tag/cluster-autoscaler-1.36.1) |
| Autoscaler AWS IAM/발견 태그 | 1.36.1 | [고정 태그의 AWS 안내](https://github.com/kubernetes/autoscaler/blob/cluster-autoscaler-1.36.1/cluster-autoscaler/cloudprovider/aws/README.md) |

Autoscaler chart 9.59.0의 기본 이미지는 1.35.0입니다. Terraform에서 1.36.1로 명시했습니다. 차트 설정 스키마·템플릿은 다운로드해 확인했습니다. LBC 정책은 공식 원본을 그대로 `infra/terraform/addons/policies/`에 보관합니다. 업그레이드할 때 SHA-256·chart digest·릴리스 노트를 함께 확인합니다.

포함한 IAM 원본의 SHA-256: `16f232c9d9f79366fe949c4550ad517a202380058a9e48d45a4e215044a20a6a`.
