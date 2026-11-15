variable "region" {
  type    = string
  default = "ap-northeast-2"
}
variable "project_name" {
  type    = string
  default = "think-meet"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.project_name))
    error_message = "Use 2-20 lowercase letters, digits or hyphens, starting with a letter."
  }
}
variable "environment" {
  type    = string
  default = "test"
  validation {
    condition     = var.environment == "test"
    error_message = "This reduced-capacity stack is reserved for the test environment."
  }
}
variable "domain_name" {
  description = "앱의 대표 도메인입니다. 예: class.example.com. 리전 인증서는 하위 origin.·rtc.·turn. 도메인을 포함합니다."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$", var.domain_name))
    error_message = "Set a valid lowercase public DNS name."
  }
}
variable "hosted_zone_id" {
  description = "domain_name을 포함하는 기존 Route 53 공개 호스팅 영역입니다."
  type        = string
}
variable "kubernetes_version" {
  type    = string
  default = "1.36"
  validation {
    condition     = var.kubernetes_version == "1.36"
    error_message = "This bundle pins add-ons for EKS 1.36. Review their versions before changing the Kubernetes minor version."
  }
}
variable "app_instance_type" {
  type    = string
  default = "m7i.large"
}
variable "media_instance_type" {
  type    = string
  default = "c7i.xlarge"
}
variable "app_node_min" {
  type    = number
  default = 1
}
variable "app_node_desired" {
  type    = number
  default = 1
}
variable "app_node_max" {
  type    = number
  default = 1
}
variable "media_nodes_per_az_min" {
  type    = number
  default = 1
}
variable "media_nodes_per_az_desired" {
  type    = number
  default = 1
}
variable "media_nodes_per_az_max" {
  type    = number
  default = 1
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}
variable "db_engine_version" {
  description = "Aurora PostgreSQL 16의 정확한 마이너 버전을 선택적으로 지정합니다. null이면 plan에서 리전의 최신 16.x를 선택하며 이후 업그레이드를 관리하려면 선택된 버전으로 고정합니다."
  type        = string
  default     = null
  validation {
    condition     = var.db_engine_version == null ? true : startswith(var.db_engine_version, "16.")
    error_message = "Only Aurora PostgreSQL 16.x is supported."
  }
}
variable "use_app_db_secret_for_proxy" {
  description = "기본값 false는 AWS 관리형 DB 관리자 Secret을 사용합니다. 별도로 앱 DB 자격 증명을 등록한 경우에만 true로 전환합니다."
  type        = bool
  default     = false
}
variable "redis_node_type" {
  type    = string
  default = "cache.t4g.medium"
}
variable "redis_auth_tokens" {
  description = "기존 Redis 인증값을 유지할 때만 지정하는 선택 입력입니다. null이면 Terraform이 생성해 Secrets Manager에 저장합니다. 인증값은 암호화된 상태에도 저장됩니다."
  type        = map(string)
  sensitive   = true
  default     = null
  validation {
    condition     = var.redis_auth_tokens == null ? true : (toset(keys(var.redis_auth_tokens)) == toset(["livekit", "application"]) && alltrue([for token in values(var.redis_auth_tokens) : can(regex("^[A-Za-z0-9!&#$^<>-]{32,128}$", token))]))
    error_message = "Supply exactly livekit/application tokens, each 32-128 supported characters (hex recommended)."
  }
}
variable "alarm_email" {
  description = "선택 사항인 이메일 알림 구독입니다. 수신자가 SNS 구독을 확인해야 합니다."
  type        = string
  default     = null
}
variable "rtc_rate_limit" {
  description = "RTC 신호 요청에 대한 리전 WAF의 클라이언트 IP별 5분당 한도입니다. 교실의 공유 NAT·재접속 폭주를 측정해 조정하며 CloudFront API 한도는 edge WAF에서 관리합니다."
  type        = number
  default     = 20000
  validation {
    condition     = var.rtc_rate_limit >= 10 && var.rtc_rate_limit <= 2000000000 && floor(var.rtc_rate_limit) == var.rtc_rate_limit
    error_message = "WAF rate limit must be an integer between 10 and 2,000,000,000."
  }
}
variable "deletion_protection" {
  description = "데이터베이스와 ALB/NLB 삭제 보호입니다. 문서에 따른 폐기 절차에서만 해제합니다."
  type        = bool
  default     = true
}
variable "log_retention_days" {
  type    = number
  default = 30
}

variable "enable_cluster_autoscaler" {
  description = "앱 노드가 1대로 고정된 테스트에서는 비활성화하며 미디어 용량은 수동으로 조정합니다."
  type        = bool
  default     = false
}

variable "tags" {
  description = "애드온 IAM 역할에 추가할 태그입니다."
  type        = map(string)
  default     = {}
}

variable "enable_observability" {
  description = "LiveKit·앱 컨테이너 자원 지표를 위한 AMP 워크스페이스와 클러스터 내 단일 수집기를 생성합니다."
  type        = bool
  default     = true
}

variable "observed_namespace" {
  description = "별도로 배포할 앱·LiveKit의 지표를 탐색할 네임스페이스입니다."
  type        = string
  default     = "think-meet"
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.observed_namespace))
    error_message = "Use a valid Kubernetes namespace name."
  }
}

variable "namespace" {
  description = "향후 서버 배포에서 사용할 네임스페이스로 IAM 신뢰 조건에만 사용합니다."
  type        = string
  default     = "think-meet"
}

variable "api_service_account" {
  description = "향후 서버 배포에서 API IAM 역할에 연결할 서비스 계정 이름입니다. 여기서는 생성하지 않습니다."
  type        = string
  default     = "think-meet-api"
}

variable "deploy_edge" {
  description = "ALB·NLB·CloudFront·DNS 등 외부 접속 인프라를 생성합니다. 서버 배포와 무관합니다."
  type        = bool
  default     = true
}

variable "api_health_check_path" {
  description = "나중에 연결할 서버의 상태 확인 경로입니다."
  type        = string
  default     = "/api/v1/health"
}

variable "gateway_health_check_path" {
  description = "나중에 연결할 신호 Gateway의 상태 확인 경로입니다."
  type        = string
  default     = "/healthz"
}

variable "edge_rate_limit" {
  description = "사용자 IP별 5분당 요청 한도입니다. 공유 NAT·재접속 부하에 맞춰 조정합니다."
  type        = number
  default     = 20000
  validation {
    condition     = var.edge_rate_limit >= 10 && var.edge_rate_limit <= 2000000000 && floor(var.edge_rate_limit) == var.edge_rate_limit
    error_message = "요청 한도는 10부터 2,000,000,000 사이의 정수여야 합니다."
  }
}

variable "eks_public_access_cidrs" {
  description = "Optional IPv4 CIDRs for the deployment runner, preferably its public IP/32. Empty keeps the EKS API private."
  type        = list(string)
  default     = []
  validation {
    condition = alltrue([for cidr in var.eks_public_access_cidrs :
      can(cidrnetmask(cidr)) && try(tonumber(split("/", cidr)[1]) >= 24, false)
    ])
    error_message = "Use IPv4 CIDRs with a /24 or narrower prefix; use the runner public IP/32."
  }
}
