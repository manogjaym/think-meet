region             = "ap-northeast-2"
project_name       = "think-meet"
environment        = "prod"
domain_name        = "" # plan/apply 전에 입력합니다.
hosted_zone_id     = "" # domain_name을 관리하는 Route 53 공개 호스팅 영역입니다.
kubernetes_version = "1.36"

# 20명씩 50개 방은 성능 시험 시나리오이며 실제 수용량은 부하 시험으로 확인해야 합니다.
app_node_min               = 3
app_node_desired           = 3
app_node_max               = 12
app_instance_type          = "m7i.xlarge"
media_nodes_per_az_min     = 2
media_nodes_per_az_desired = 2
media_nodes_per_az_max     = 6
media_instance_type        = "c7i.4xlarge"

db_instance_class           = "db.r7g.large"
db_engine_version           = null  # 첫 plan에서 해당 리전의 최신 16.x를 선택하며 이후 변경을 관리하려면 선택된 버전으로 고정합니다.
use_app_db_secret_for_proxy = false # 별도로 앱 DB 자격 증명을 등록한 경우에만 true로 전환합니다.
redis_node_type             = "cache.r7g.large"
deletion_protection         = true
alarm_email                 = null

# Redis 인증값은 Terraform이 생성해 Secrets Manager에 저장합니다.
# 인증값이 포함된 Terraform 상태는 암호화와 IAM 접근 제한을 유지합니다.
