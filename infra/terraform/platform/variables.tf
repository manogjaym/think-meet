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
  default = "prod"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,9}$", var.environment))
    error_message = "Use 2-10 lowercase letters, digits or hyphens."
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
}
variable "app_instance_type" {
  type    = string
  default = "m7i.xlarge"
}
variable "media_instance_type" {
  type    = string
  default = "c7i.4xlarge"
}
variable "app_node_min" {
  type    = number
  default = 3
}
variable "app_node_desired" {
  type    = number
  default = 3
}
variable "app_node_max" {
  type    = number
  default = 12
}
variable "media_nodes_per_az_min" {
  type    = number
  default = 2
}
variable "media_nodes_per_az_desired" {
  type    = number
  default = 2
}
variable "media_nodes_per_az_max" {
  type    = number
  default = 6
}
variable "db_instance_class" {
  type    = string
  default = "db.r7g.large"
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
  default = "cache.r7g.large"
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
  description = "데이터베이스 삭제 보호입니다. 문서에 따른 폐기 절차에서만 해제합니다."
  type        = bool
  default     = true
}
variable "log_retention_days" {
  type    = number
  default = 30
}
