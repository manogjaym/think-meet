# 테스트 인프라

한 폴더에서 AWS 네트워크·EKS·DB/Redis·외부 접속 인프라를 생성합니다. 앱·미디어 노드는 각 1대입니다. 서버 배포는 별도 작업입니다.

## 기본 사양

| 항목 | 구성 |
|---|---|
| 리전·EKS | 서울(`ap-northeast-2`) · Kubernetes `1.36` |
| 앱 노드 | `m7i.large` 1대 · 디스크 30GiB |
| 미디어 노드 | `c7i.xlarge` 1대 · 디스크 30GiB |
| DB | Aurora PostgreSQL 16 · `db.t4g.medium` 3대 · RDS Proxy |
| Redis | `cache.t4g.medium` · 2개 그룹 × 3대, 총 6대 |
| 네트워크 | 3개 AZ · NAT Gateway 3개 |

## 준비

- `terraform.tfvars`에 `domain_name`과 `hosted_zone_id`를 입력합니다.
- EKS API는 기본 비공개입니다.
- VPC 외부 실행기는 `eks_public_access_cidrs`에 고정 공인 IP/32를 입력합니다.

## 실행

`infra/terraform/test` 폴더에서 실행합니다. `apply` 전에 계획을 검토합니다.

```bash
terraform init
terraform apply
terraform output
```

기본 상태는 로컬 `terraform.tfstate` 하나입니다. 원격 상태를 쓰면 `think-meet/test/terraform.tfstate` 키를 사용합니다. 자세한 내용은 [배포 절차](../../docs/deployment.md)와 [상태 관리](../../docs/operations.md)를 참고합니다.
