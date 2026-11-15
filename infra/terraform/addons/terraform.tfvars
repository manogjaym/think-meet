platform_state_bucket = "think-meet-tfstate"
platform_state_key    = "think-meet/prod/platform.tfstate"
state_region          = "ap-northeast-2"

# 앱 노드에만 Autoscaler 탐색 태그를 부여합니다. 미디어 노드는
# LiveKit 연결을 비운 뒤 수동으로 조정하며 이 컨트롤러에 포함하지 않습니다.
enable_cluster_autoscaler = true

tags = {
  Project     = "think-meet"
  Environment = "prod"
}
