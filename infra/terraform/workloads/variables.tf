variable "region" {
  type    = string
  default = "ap-northeast-2"
}
variable "state_bucket" {
  description = "platform 상태가 저장된 S3 버킷입니다."
  type        = string
}
variable "platform_state_key" {
  type    = string
  default = "think-meet/prod/platform.tfstate"
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
variable "deletion_protection" {
  description = "로드밸런서 삭제 보호이며 폐기 절차에서만 해제합니다."
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
