# Think Meet 공통 인프라

AWS 인프라와 로컬 Docker 설정을 관리합니다. Terraform은 서버 소스·이미지·DB 스키마 없이 실행할 수 있습니다. 서버 빌드·배포, SQL 초기화·마이그레이션, 웹 파일 업로드는 별도 작업입니다.

`infra/`는 `web/`, `server/`, `mobile/`과 같은 최상위 폴더에 둡니다. 별도 안내가 없는 명령은 프로젝트 최상위에서 실행합니다.

## 로컬 실행 설정

`local/`에서 Compose·실행 스크립트·`.env`·인증서·백업·가상 학생 도구를 함께 관리합니다. 실행 위치와 명령은 [로컬 실행 안내](local/README.md)를 따릅니다. 서버 소스·Prisma·계정 CLI·서버 Dockerfile은 `server/`에 둡니다.

`livekit.yaml`은 서버 초기화 스크립트가 생성합니다. 인증값이 들어 있으므로 Git에서 제외하며, 이동할 때 내용과 권한을 보존합니다. AWS Terraform 구성 위치와 상태 키는 유지합니다.

로컬 PostgreSQL·MinIO도 `think-meet` Compose 프로젝트에서 자동 시작·중지합니다. 외부 Docker 네트워크나 기존 컨테이너를 별도로 준비할 필요는 없습니다. 전용 볼륨과 기존 데이터 이전 절차는 [로컬 실행 안내](local/README.md#서비스-실행접속)를 확인하세요.

`local/minio/Dockerfile`은 고정된 공식 서버·관리 도구 소스로 로컬 MinIO 이미지를 빌드합니다. 비밀 설정이 있는 `local/` 전체를 빌드에 보내지 않고 이 하위 폴더만 빌드 문맥으로 사용합니다.

## 구성

테스트 환경은 **`terraform/test` 한 폴더**로 전달합니다. 입력을 채우고 해당 폴더에서 `terraform init` → `terraform apply`를 실행합니다. 자세한 내용은 [테스트 안내](terraform/test/README.md)를 참고합니다.

운영은 다음 계층으로 나눕니다.

| 계층 | 생성하는 인프라 |
|---|---|
| `terraform/bootstrap` | 운영 상태 저장 S3·KMS·DynamoDB 잠금, 운영 계층의 backend 설정 |
| `terraform/platform` | VPC·서브넷·NAT·EKS·노드·Aurora·RDS Proxy·Redis·S3·ECR·Secrets Manager·인증서·보안 그룹 |
| `terraform/addons` | Load Balancer Controller·Metrics Server·노드 Autoscaler·AMP 수집기 |
| `terraform/workloads` | ALB·NLB·빈 대상 그룹·CloudFront·WAF·DNS·서버 연결용 IAM 역할 |

`workloads`는 외부 접속 인프라 계층이며 기존 이름과 상태 키를 유지합니다. 앱 Pod·Service·Ingress·HPA·Secret은 생성하지 않습니다. EKS에는 기본 애드온과 운영 컨트롤러만 설치합니다.

## 운영과 테스트

운영은 `terraform/{platform,addons,workloads}`, 테스트는 `terraform/test`를 사용합니다. 테스트는 bootstrap 없이 로컬 상태 하나로 실행합니다. 조직의 원격 상태를 사용하면 키는 `think-meet/test/terraform.tfstate` 하나입니다. 운영은 기존 `think-meet/prod/...` 키를 유지합니다.

| 항목 | 운영 | 테스트 |
|---|---|---|
| 앱 노드 | `m7i.xlarge` 3대, 최대 12대 | `m7i.large` 1대 고정 |
| 미디어 노드 | `c7i.4xlarge` 6대 | `c7i.xlarge` 1대 고정 |
| Aurora | `db.r7g.large` 3대 | `db.t4g.medium` 3대 |
| Redis | `cache.r7g.large`, 두 그룹 각 3대 | `cache.t4g.medium`, 두 그룹 각 3대 |
| NAT·서브넷 | NAT 3대·3 AZ | 동일 |

테스트 EC2는 평상시 합계 6 vCPU·16GiB이며 앱·미디어 각 1대입니다. 실제 수용량은 서버 배포 후 부하 시험으로 확인합니다.

## 입력과 배포

테스트는 `terraform/test/terraform.tfvars`, 운영은 `terraform/platform/terraform.tfvars`에 **`domain_name`·`hosted_zone_id`**를 입력합니다. 기본 리전은 서울입니다. 테스트 EKS API는 기본 비공개입니다. 외부 실행기는 `eks_public_access_cidrs`에 고정 공인 IP/32를 지정할 수 있습니다.

- 운영은 bootstrap으로 `backend.hcl`을 생성합니다. 테스트는 별도 bootstrap 없이 `init` → `apply`합니다.
- Redis 토큰은 Terraform이 생성해 ElastiCache와 Secrets Manager에 같은 값으로 저장합니다.
- EKS 관리 API는 기본 비공개이며 Terraform 실행 IAM 사용자·역할이 관리자로 자동 등록됩니다.
- DB 관리자 암호는 AWS가 관리합니다. 앱·마이그레이션용 Secret은 값이 없는 저장 공간만 준비합니다.

[배포 절차](docs/deployment.md)와 [테스트 안내](terraform/test/README.md)를 따릅니다. 인프라 배포에 서버 코드·Docker·이미지 주소는 필요하지 않습니다.

프로젝트는 루트의 단일 Git 저장소로 관리합니다. 루트 CI에는 공통 폴더와 `infra/`, `web/`, `server/`, `mobile/`이 같은 checkout에 포함되어야 합니다. 저장소 구성과 원격 CI 연결 조건은 [루트 안내](../README.md#git-관리)를 확인하세요.

## 서버 작업으로 전달할 정보

Terraform 출력의 클러스터·네트워크, ECR, DB·Redis 접속 정보와 Secret ARN, S3 버킷, IAM 역할, 대상 그룹 ARN을 전달합니다. 서버 등록은 별도 작업이므로 처음에는 대상 그룹이 비어 있습니다.

앱 노드 자동 확장과 `application` Redis는 향후 수평 확장용입니다. 현재 API 서버는 1대로만 운영할 수 있습니다. [서버 운영 전제](../server/README.md#운영-전제-api-서버-1대)를 확인하세요.

## 검증

```bash
./infra/scripts/validate.sh --init
```

검증 스크립트는 공급자 캐시를 공유하고 임시 데이터를 정리합니다. Python은 오프라인 테스트에만 필요합니다. 이 명령은 AWS plan/apply나 서버 실행을 수행하지 않습니다.

[검증 기준](docs/capacity-and-validation.md) · [운영 절차](docs/operations.md) · [비용 항목](docs/cost-model.md) · [검증 기록](docs/verification.md)

`diagrams`의 그림은 앱 배치까지 포함한 참고 자료입니다. 실제 생성 범위는 현재 Terraform을 기준으로 합니다.

구성도 PNG/PDF 생성에는 `web/node_modules`의 Playwright 또는 별도 Node 도구 환경이 필요합니다. 렌더러는 이동 후에도 이 의존성을 찾습니다. Terraform 배포에는 필요하지 않습니다.

```bash
node infra/diagrams/render-diagram.cjs
node infra/diagrams/render-ecs-test-diagram.cjs
```
