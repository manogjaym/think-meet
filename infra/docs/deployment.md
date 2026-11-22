# 인프라 배포 절차

명령은 `infra/`, `web/`, `server/`, `mobile/`이 있는 프로젝트 최상위 기준입니다. 서버 소스·Docker·이미지·SQL 스키마는 필요하지 않습니다. `apply`는 실제 AWS 자원을 생성하므로 먼저 계획을 검토합니다.

## 테스트 환경: 한 폴더에서 실행

`infra/terraform/test/terraform.tfvars`에 도메인·Hosted Zone을 입력한 뒤 실행합니다.

```bash
cd infra/terraform/test
terraform init
terraform apply
```

한 번의 `apply`로 VPC·EKS·DB·캐시·Helm 관리 도구·ALB/NLB·CloudFront·WAF·DNS를 만듭니다. bootstrap이나 `-target`은 필요하지 않습니다. 상태는 기본적으로 로컬 `terraform.tfstate` 하나에 저장합니다. 조직의 암호화 S3 backend도 선택할 수 있습니다.

EKS API는 기본 비공개입니다. VPC에 연결되지 않은 외부 실행기는 `eks_public_access_cidrs`에 고정 공인 IP/32를 입력해야 같은 실행에서 Helm 설치까지 마칠 수 있습니다. [테스트 안내](../terraform/test/README.md)를 참고합니다.

## 운영 환경

아래는 운영 전용 절차입니다. 테스트 폴더에 있다면 프로젝트 최상위로 돌아옵니다.

### 1. 입력과 접근 준비

AWS CLI로 대상 계정을 인증합니다. `infra/terraform/platform/terraform.tfvars`에 `domain_name`·`hosted_zone_id`를 입력합니다. 상태 버킷은 `think-meet-tfstate`, 리전은 서울(`ap-northeast-2`)입니다.

EKS 관리 API는 비공개입니다. `addons` 실행기는 VPC 내부 또는 VPN 등으로 연결된 환경에 있어야 합니다. DNS와 보안 그룹의 TCP 443 접근도 필요합니다. 플랫폼 실행 IAM 사용자·역할은 EKS 관리자로 자동 등록됩니다.

### 2. 원격 상태 저장소 생성

```bash
terraform -chdir=infra/terraform/bootstrap init
terraform -chdir=infra/terraform/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/terraform/bootstrap apply bootstrap.tfplan
```

bootstrap이 운영 각 계층의 `backend.hcl`을 생성하므로 KMS 키·버킷·잠금 테이블을 수동 복사하지 않습니다. bootstrap의 로컬 상태는 안전하게 보관하고 실행기를 바꿔도 같은 상태를 사용합니다.

### 3. 운영 플랫폼 생성

```bash
terraform -chdir=infra/terraform/platform init -backend-config=backend.hcl
terraform -chdir=infra/terraform/platform plan -out=platform.tfplan
terraform -chdir=infra/terraform/platform apply platform.tfplan
terraform -chdir=infra/terraform/platform output
```

Redis 인증값은 Terraform이 생성해 Secrets Manager에 저장하며 화면에는 출력하지 않습니다. 기존 값을 유지할 때만 `redis_auth_tokens`로 전달합니다. 인증값은 Terraform 상태에도 들어가므로 KMS 암호화와 IAM 접근 제한을 유지합니다.

Aurora 관리자 암호는 AWS가 관리하며 위치는 `db_master_secret_arn`에서 확인합니다. DB 스키마·앱 계정·마이그레이션은 별도 작업입니다. `use_app_db_secret_for_proxy`는 기본 `false`이며, 앱 DB 자격 증명을 등록한 뒤에만 `true`로 바꿉니다.

### 4. EKS 인프라 애드온 설치

VPC에 연결된 실행기에서 플랫폼에 등록된 IAM 사용자·역할로 실행합니다.

```bash
terraform -chdir=infra/terraform/addons init -backend-config=backend.hcl
terraform -chdir=infra/terraform/addons plan -out=addons.tfplan
terraform -chdir=infra/terraform/addons apply addons.tfplan
```

Load Balancer Controller·Metrics Server·노드 Autoscaler·AMP 수집기를 설치합니다. 서버 Pod나 애플리케이션 리소스는 생성하지 않습니다.

### 5. 외부 접속 인프라 생성

```bash
terraform -chdir=infra/terraform/workloads init -backend-config=backend.hcl
terraform -chdir=infra/terraform/workloads plan -out=workloads.tfplan
terraform -chdir=infra/terraform/workloads apply workloads.tfplan
terraform -chdir=infra/terraform/workloads output
```

기존 폴더명과 상태 키를 유지하며 AWS 리소스만 관리합니다. ALB·NLB·대상 그룹·CloudFront·WAF·DNS를 직접 생성하므로 서버 Pod나 Kubernetes Ingress가 없어도 됩니다. `deploy_edge`의 기본값은 `true`입니다.

## 서버 담당자에게 전달

| 출력 | 용도 |
|---|---|
| `cluster_name`, `cluster_endpoint`, `cluster_admin_arn` | 별도 배포 환경의 클러스터 접근 |
| `api_ecr_repository_url` | 준비한 서버 이미지를 저장할 위치 |
| `db_proxy_endpoint`, `db_cluster_endpoint`, 관련 Secret ARN | 서버·DB 작업의 접속 설정 |
| `redis_endpoints`, `redis_secret_arns` | Redis 접속 정보와 인증값 위치 |
| `material_bucket_name`, `web_bucket_name` | 파일·정적 자산 저장 위치 |
| `api_role_arn` | 별도 서버 서비스 계정에 연결할 IAM 역할 |
| `api_target_group_arn` | HTTP 3000 대상 등록 |
| `gateway_target_group_arn` | 신호 Gateway HTTP 8080 대상 등록 |
| `turn_target_group_arn` | TURN TCP 5349 대상 등록. PROXY protocol v2 사용, 상태 확인 포트 7880 |

대상 그룹은 처음에 비어 있습니다. 서버 배포 시 Pod IP 등록이나 TargetGroupBinding 등을 구성합니다. API 서버는 `replicas: 1`·`Recreate` 배포로 Pod 하나만 등록하고 HPA를 연결하지 않습니다. 이유와 확장 조건은 [서버 운영 전제](../../server/README.md#운영-전제-api-서버-1대)를 따릅니다. `redis_endpoints`의 `application` 그룹은 현재 서버가 사용하지 않습니다. 앱 네임스페이스·서비스 계정·이미지·DB 초기화·미디어 설정·웹 파일 업로드도 별도 작업입니다. DNS·CloudFront URL이 출력되어도 서버 응답을 보장하지 않습니다.

기존 상태에서 앱까지 관리했다면 먼저 앱 소유권을 이전합니다. 새 계획의 Kubernetes 리소스 삭제와 로드밸런서 생성을 검토한 뒤 적용합니다. 이 구성 정리에서는 AWS에 적용하지 않았습니다.
