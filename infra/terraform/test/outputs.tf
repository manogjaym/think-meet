output "region" { value = var.region }

output "project_name" { value = var.project_name }

output "environment" { value = var.environment }

output "name" { value = local.name }

output "account_id" { value = data.aws_caller_identity.current.account_id }

output "domain_name" { value = var.domain_name }

output "hosted_zone_id" { value = var.hosted_zone_id }

output "vpc_id" { value = aws_vpc.main.id }

output "vpc_cidr" { value = aws_vpc.main.cidr_block }

output "availability_zones" { value = local.azs }

output "public_ingress_subnet_ids" { value = aws_subnet.ingress[*].id }

output "public_media_subnet_ids" { value = aws_subnet.media[*].id }

output "public_ingress_subnet_cidrs" { value = local.ingress_cidrs }

output "public_media_subnet_cidrs" { value = local.media_cidrs }

output "private_app_subnet_ids" { value = aws_subnet.app[*].id }

output "data_subnet_ids" { value = aws_subnet.data[*].id }

output "cluster_name" { value = aws_eks_cluster.main.name }

output "cluster_arn" { value = aws_eks_cluster.main.arn }

output "cluster_admin_arn" { value = local.cluster_admin_arn }

output "cluster_endpoint" { value = aws_eks_cluster.main.endpoint }

output "cluster_ca_data" { value = aws_eks_cluster.main.certificate_authority[0].data }

output "cluster_oidc_provider_arn" { value = aws_iam_openid_connect_provider.eks.arn }

output "cluster_oidc_issuer" { value = aws_iam_openid_connect_provider.eks.url }

output "cluster_oidc_issuer_url" { value = aws_iam_openid_connect_provider.eks.url }

output "cluster_security_group_id" { value = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id }

output "app_node_role_arn" { value = aws_iam_role.node["app"].arn }

output "media_node_role_arn" { value = aws_iam_role.node["media"].arn }

output "app_node_security_group_id" { value = aws_security_group.app.id }

output "media_node_security_group_id" { value = aws_security_group.media.id }

output "alb_security_group_id" { value = aws_security_group.alb.id }

output "turn_security_group_id" { value = aws_security_group.turn.id }

output "app_autoscaling_group_names" { value = aws_eks_node_group.app.resources[0].autoscaling_groups[*].name }

output "application_node_group_name" { value = aws_eks_node_group.app.node_group_name }

output "media_node_group_names" { value = aws_eks_node_group.media[*].node_group_name }

output "media_autoscaling_group_names" { value = flatten([for group in aws_eks_node_group.media : group.resources[0].autoscaling_groups[*].name]) }

output "kms_key_arn" { value = aws_kms_key.main.arn }

output "db_name" { value = aws_rds_cluster.main.database_name }

output "db_cluster_arn" { value = aws_rds_cluster.main.arn }

output "db_cluster_identifier" { value = aws_rds_cluster.main.cluster_identifier }

output "db_engine_version" { value = aws_rds_cluster.main.engine_version }

output "db_cluster_endpoint" { value = aws_rds_cluster.main.endpoint }

output "db_reader_endpoint" { value = aws_rds_cluster.main.reader_endpoint }

output "db_proxy_endpoint" { value = aws_db_proxy.main.endpoint }

output "db_master_secret_arn" { value = aws_rds_cluster.main.master_user_secret[0].secret_arn }

output "db_app_secret_arn" { value = aws_secretsmanager_secret.db_app.arn }

output "db_migrator_secret_arn" { value = aws_secretsmanager_secret.db_migrator.arn }

output "db_proxy_uses_app_secret" { value = var.use_app_db_secret_for_proxy }

output "application_runtime_secret_arn" { value = aws_secretsmanager_secret.runtime.arn }

output "redis_endpoints" { value = { for name, group in aws_elasticache_replication_group.main : name => group.primary_endpoint_address } }

output "redis_reader_endpoints" { value = { for name, group in aws_elasticache_replication_group.main : name => group.reader_endpoint_address } }

output "redis_secret_arns" { value = { for name, secret in aws_secretsmanager_secret.redis : name => secret.arn } }

output "redis_replication_group_ids" { value = { for name, group in aws_elasticache_replication_group.main : name => group.replication_group_id } }

output "material_bucket_name" { value = aws_s3_bucket.materials.id }

output "material_bucket_arn" { value = aws_s3_bucket.materials.arn }

output "web_bucket_name" { value = aws_s3_bucket.web.id }

output "web_bucket_arn" { value = aws_s3_bucket.web.arn }

output "web_bucket_regional_domain_name" { value = aws_s3_bucket.web.bucket_regional_domain_name }

output "log_bucket_name" { value = aws_s3_bucket.logs.id }

output "log_bucket_arn" { value = aws_s3_bucket.logs.arn }

output "api_ecr_repository_url" { value = aws_ecr_repository.api.repository_url }

output "api_ecr_repository_arn" { value = aws_ecr_repository.api.arn }

output "regional_certificate_arn" { value = aws_acm_certificate_validation.regional.certificate_arn }

output "waf_acl_arn" { value = aws_wafv2_web_acl.main.arn }

output "alarm_topic_arn" { value = aws_sns_topic.alarms.arn }

output "installed_versions" {
  value = {
    aws_load_balancer_controller = local.lbc_version
    metrics_server_chart         = local.metrics_version
    metrics_server_image         = "v0.9.0"
    cluster_autoscaler_chart     = var.enable_cluster_autoscaler ? local.autoscaler_chart : null
    cluster_autoscaler_image     = var.enable_cluster_autoscaler ? local.autoscaler_image : null
    prometheus_chart             = var.enable_observability ? local.prometheus_chart_version : null
    prometheus_image             = var.enable_observability ? local.prometheus_image_tag : null
  }
}

output "load_balancer_controller_role_arn" {
  value = module.load_balancer_controller_irsa.role_arn
}

output "autoscaler_application_asg_arns" {
  value = var.enable_cluster_autoscaler ? local.application_asg_arns : []
}

output "prometheus_workspace_id" {
  value = var.enable_observability ? aws_prometheus_workspace.main[0].id : null
}

output "prometheus_workspace_endpoint" {
  description = "AMP endpoint; query access requires a separately authorized operator role."
  value       = var.enable_observability ? aws_prometheus_workspace.main[0].prometheus_endpoint : null
}

output "application_url" { value = var.deploy_edge ? "https://${var.domain_name}" : null }

output "livekit_url" { value = var.deploy_edge ? "wss://rtc.${var.domain_name}" : null }

output "cloudfront_distribution_id" { value = var.deploy_edge ? aws_cloudfront_distribution.web[0].id : null }

output "api_role_arn" { value = aws_iam_role.api.arn }

output "application_load_balancer_arn" { value = var.deploy_edge ? aws_lb.application[0].arn : null }

output "turn_load_balancer_arn" { value = var.deploy_edge ? aws_lb.turn[0].arn : null }

output "api_target_group_arn" { value = var.deploy_edge ? aws_lb_target_group.api[0].arn : null }

output "gateway_target_group_arn" { value = var.deploy_edge ? aws_lb_target_group.media_gateway[0].arn : null }

output "turn_target_group_arn" { value = var.deploy_edge ? aws_lb_target_group.turn[0].arn : null }
