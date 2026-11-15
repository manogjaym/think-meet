region             = "ap-northeast-2"
project_name       = "think-meet"
environment        = "test"
domain_name        = "" # 입력 필요
hosted_zone_id     = "" # 입력 필요
kubernetes_version = "1.36"

# 테스트는 앱 노드 1대와 첫 번째 미디어 AZ의 미디어 노드 1대로 고정.
app_node_min               = 1
app_node_desired           = 1
app_node_max               = 1
app_instance_type          = "m7i.large"
media_nodes_per_az_min     = 1
media_nodes_per_az_desired = 1
media_nodes_per_az_max     = 1
media_instance_type        = "c7i.xlarge"

db_instance_class           = "db.t4g.medium"
db_engine_version           = null # 첫 plan에서 해당 리전의 최신 16.x를 선택
use_app_db_secret_for_proxy = false
redis_node_type             = "cache.t4g.medium"
deletion_protection         = true
alarm_email                 = null

# Redis 인증값은 Terraform이 생성해 Secrets Manager에 저장.

# EKS API 외부 접속용 IP (예. ["203.0.113.10/32"])
eks_public_access_cidrs = []

enable_cluster_autoscaler = false
enable_observability      = true
namespace                 = "think-meet"
observed_namespace        = "think-meet"
