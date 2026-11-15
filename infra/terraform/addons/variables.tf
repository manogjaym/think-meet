variable "platform_state_bucket" {
  description = "성공적으로 적용한 platform 상태가 저장된 암호화 S3 버킷입니다."
  type        = string
}

variable "platform_state_key" {
  description = "addons 자체 상태가 아닌 platform 상태의 오브젝트 키입니다."
  type        = string
  default     = "think-meet/prod/platform.tfstate"
}

variable "state_region" {
  description = "S3 상태 버킷의 리전입니다. AWS 리소스는 platform 출력의 리전을 사용합니다."
  type        = string
  default     = "ap-northeast-2"
}

variable "enable_cluster_autoscaler" {
  description = "앱 노드 그룹만 자동 확장합니다. LiveKit 미디어 노드는 연결을 비운 뒤 수동으로 조정합니다."
  type        = bool
  default     = true
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
  description = "앱·LiveKit 지표를 탐색하고 보관할 네임스페이스이며 workloads의 네임스페이스와 같아야 합니다."
  type        = string
  default     = "think-meet"
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.observed_namespace))
    error_message = "Use a valid Kubernetes namespace name."
  }
}
