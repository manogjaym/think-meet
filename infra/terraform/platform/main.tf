terraform {
  required_version = ">= 1.5.7, < 2.0.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    tls    = { source = "hashicorp/tls", version = "~> 4.1" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags { tags = local.tags }
}

data "aws_caller_identity" "current" {}
data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}
data "aws_partition" "current" {}
data "aws_availability_zones" "available" { state = "available" }

locals {
  # SSO·STS 세션을 원본 IAM 역할로 변환하고 전체 역할 경로를 보존합니다.
  cluster_admin_arn = data.aws_iam_session_context.current.issuer_arn
  name              = "${var.project_name}-${var.environment}"
  azs               = slice(data.aws_availability_zones.available.names, 0, 3)
  tags              = { Project = var.project_name, Environment = var.environment, ManagedBy = "terraform" }
  ingress_cidrs     = ["10.40.0.0/24", "10.40.1.0/24", "10.40.2.0/24"]
  media_cidrs       = ["10.40.8.0/24", "10.40.9.0/24", "10.40.10.0/24"]
  app_cidrs         = ["10.40.32.0/20", "10.40.48.0/20", "10.40.64.0/20"]
  data_cidrs        = ["10.40.96.0/24", "10.40.97.0/24", "10.40.98.0/24"]
}

resource "aws_vpc" "main" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = local.name }
  lifecycle {
    precondition {
      condition     = length("${local.name}-${data.aws_caller_identity.current.account_id}-${var.region}-materials") <= 63
      error_message = "Combined project/environment/region names exceed the S3 63-character bucket-name limit. Shorten project_name or environment."
    }
  }
}
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}
resource "aws_subnet" "ingress" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = local.ingress_cidrs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-ingress-${local.azs[count.index]}", "kubernetes.io/role/elb" = "1" }
}
resource "aws_subnet" "media" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = local.media_cidrs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-media-${local.azs[count.index]}" }
}
resource "aws_subnet" "app" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = local.app_cidrs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-app-${local.azs[count.index]}", "kubernetes.io/role/internal-elb" = "1" }
}
resource "aws_subnet" "data" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = local.data_cidrs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-data-${local.azs[count.index]}" }
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-public" }
}
resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}
resource "aws_route_table_association" "ingress" {
  count          = 3
  subnet_id      = aws_subnet.ingress[count.index].id
  route_table_id = aws_route_table.public.id
}
resource "aws_route_table_association" "media" {
  count          = 3
  subnet_id      = aws_subnet.media[count.index].id
  route_table_id = aws_route_table.public.id
}
resource "aws_eip" "nat" {
  count  = 3
  domain = "vpc"
  tags   = { Name = "${local.name}-nat-${local.azs[count.index]}" }
}
resource "aws_nat_gateway" "main" {
  count         = 3
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.ingress[count.index].id
  depends_on    = [aws_internet_gateway.main]
  tags          = { Name = "${local.name}-${local.azs[count.index]}" }
}
resource "aws_route_table" "app" {
  count  = 3
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-app-${local.azs[count.index]}" }
}
resource "aws_route" "nat" {
  count                  = 3
  route_table_id         = aws_route_table.app[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[count.index].id
}
resource "aws_route_table_association" "app" {
  count          = 3
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.app[count.index].id
}
resource "aws_route_table" "data" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-data-isolated" }
}
resource "aws_route_table_association" "data" {
  count          = 3
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat([aws_route_table.public.id, aws_route_table.data.id], aws_route_table.app[*].id)
  tags              = { Name = "${local.name}-s3" }
}
resource "aws_security_group" "endpoints" {
  name_prefix = "${local.name}-endpoints-"
  description = "Private AWS API endpoints"
  vpc_id      = aws_vpc.main.id
}
resource "aws_vpc_security_group_ingress_rule" "endpoints_app" {
  security_group_id            = aws_security_group.endpoints.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}
resource "aws_vpc_security_group_ingress_rule" "endpoints_media" {
  security_group_id            = aws_security_group.endpoints.id
  referenced_security_group_id = aws_security_group.media.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}
resource "aws_vpc_endpoint" "interface" {
  for_each            = toset(["ecr.api", "ecr.dkr", "sts", "secretsmanager", "logs"])
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.app[*].id
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true
  tags                = { Name = "${local.name}-${replace(each.key, ".", "-")}" }
}

resource "aws_kms_key" "main" {
  description             = "${local.name} data, secrets and Kubernetes envelope encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = jsonencode({ Version = "2012-10-17", Statement = [{ Sid = "EnableAccountIAM", Effect = "Allow", Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root" }, Action = "kms:*", Resource = "*" }] })
}
resource "aws_kms_alias" "main" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.main.key_id
}
resource "aws_security_group" "app" {
  name_prefix = "${local.name}-app-"
  description = "Private application worker nodes"
  vpc_id      = aws_vpc.main.id
}
resource "aws_security_group" "media" {
  name_prefix = "${local.name}-media-"
  description = "Public LiveKit media workers; signaling is internal only"
  vpc_id      = aws_vpc.main.id
}
resource "aws_security_group" "alb" {
  name_prefix = "${local.name}-alb-"
  description = "Application HTTPS ingress; attached by AWS Load Balancer Controller"
  vpc_id      = aws_vpc.main.id
}
resource "aws_security_group" "turn" {
  name_prefix = "${local.name}-turn-"
  description = "TURN NLB public TLS ingress"
  vpc_id      = aws_vpc.main.id
}
resource "aws_security_group" "db" {
  name_prefix = "${local.name}-database-"
  description = "Aurora; proxy traffic plus app bootstrap SQL"
  vpc_id      = aws_vpc.main.id
}
resource "aws_security_group" "proxy" {
  name_prefix = "${local.name}-db-proxy-"
  description = "TLS RDS Proxy"
  vpc_id      = aws_vpc.main.id
}
resource "aws_security_group" "redis" {
  for_each    = toset(["livekit", "application"])
  name_prefix = "${local.name}-redis-${each.key}-"
  description = "TLS Redis ${each.key}"
  vpc_id      = aws_vpc.main.id
}
resource "aws_vpc_security_group_egress_rule" "app_out" {
  security_group_id = aws_security_group.app.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "AWS services through private endpoints and controlled NAT internet egress"
}
resource "aws_vpc_security_group_egress_rule" "media_out" {
  security_group_id = aws_security_group.media.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "WebRTC peers have arbitrary addresses; Redis, webhooks and AWS APIs"
}
resource "aws_vpc_security_group_ingress_rule" "app_self" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "-1"
}
resource "aws_vpc_security_group_ingress_rule" "media_self" {
  security_group_id            = aws_security_group.media.id
  referenced_security_group_id = aws_security_group.media.id
  ip_protocol                  = "-1"
  description                  = "SFU inter-node routing and host-network workloads"
}
resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
resource "aws_vpc_security_group_egress_rule" "alb_gateway" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}
resource "aws_vpc_security_group_ingress_rule" "app_gateway" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}
resource "aws_vpc_security_group_egress_rule" "alb_api" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}
resource "aws_vpc_security_group_ingress_rule" "app_api" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}
# 모든 워커와 제어 영역 ENI에 EKS 기본 보안 그룹이 연결됩니다.
# AWS가 관리하는 자체 참조 규칙이 제어 영역의 웹훅·kubelet 통신과
# 앱에서 미디어로의 지표 수집을 허용합니다. 아래 규칙은 해당 흐름을 명시합니다.
resource "aws_vpc_security_group_ingress_rule" "control_to_app" {
  for_each                     = toset(["9443", "10250"])
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = tonumber(each.key)
  to_port                      = tonumber(each.key)
}
resource "aws_vpc_security_group_ingress_rule" "metrics_to_media" {
  security_group_id            = aws_security_group.media.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 10250
  to_port                      = 10250
}
resource "aws_vpc_security_group_ingress_rule" "prometheus_to_media" {
  security_group_id            = aws_security_group.media.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 6789
  to_port                      = 6789
  description                  = "Private Prometheus collector scrapes LiveKit metrics; never public"
}
resource "aws_vpc_security_group_ingress_rule" "app_webhook" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.media.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  description                  = "LiveKit signed server webhooks"
}
resource "aws_vpc_security_group_ingress_rule" "media_signal" {
  security_group_id            = aws_security_group.media.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 7880
  to_port                      = 7880
}
resource "aws_vpc_security_group_ingress_rule" "media_udp" {
  security_group_id = aws_security_group.media.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "udp"
  from_port         = 7882
  to_port           = 7897
  description       = "LiveKit ICE UDP mux ports, no HTTP signaling"
}
resource "aws_vpc_security_group_ingress_rule" "media_tcp" {
  security_group_id = aws_security_group.media.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 7881
  to_port           = 7881
  description       = "ICE TCP fallback"
}
resource "aws_vpc_security_group_ingress_rule" "turn_tls" {
  security_group_id = aws_security_group.turn.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
resource "aws_vpc_security_group_egress_rule" "turn_to_media" {
  for_each                     = toset(["5349", "7880"])
  security_group_id            = aws_security_group.turn.id
  referenced_security_group_id = aws_security_group.media.id
  ip_protocol                  = "tcp"
  from_port                    = tonumber(each.key)
  to_port                      = tonumber(each.key)
}
resource "aws_vpc_security_group_ingress_rule" "media_from_turn" {
  for_each                     = toset(["5349", "7880"])
  security_group_id            = aws_security_group.media.id
  referenced_security_group_id = aws_security_group.turn.id
  ip_protocol                  = "tcp"
  from_port                    = tonumber(each.key)
  to_port                      = tonumber(each.key)
}
resource "aws_vpc_security_group_ingress_rule" "turn_relay" {
  security_group_id = aws_security_group.media.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "udp"
  from_port         = 30000
  to_port           = 40000
  description       = "Embedded TURN relay allocation ports"
}
resource "aws_vpc_security_group_ingress_rule" "db_proxy" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.proxy.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
resource "aws_vpc_security_group_ingress_rule" "db_bootstrap" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "In-cluster migration/bootstrap job; DB is never public"
}
resource "aws_vpc_security_group_ingress_rule" "proxy_app" {
  security_group_id            = aws_security_group.proxy.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
resource "aws_vpc_security_group_egress_rule" "proxy_db" {
  security_group_id            = aws_security_group.proxy.id
  referenced_security_group_id = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
resource "aws_vpc_security_group_ingress_rule" "redis_app" {
  for_each                     = toset(["livekit", "application"])
  security_group_id            = aws_security_group.redis[each.key].id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}
resource "aws_vpc_security_group_ingress_rule" "redis_media" {
  security_group_id            = aws_security_group.redis["livekit"].id
  referenced_security_group_id = aws_security_group.media.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

data "aws_iam_policy_document" "eks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}
resource "aws_iam_role" "cluster" {
  name               = "${local.name}-eks-cluster"
  assume_role_policy = data.aws_iam_policy_document.eks_assume.json
}
resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSClusterPolicy"
}
resource "aws_iam_role_policy" "cluster_kms" {
  name   = "secrets-envelope"
  role   = aws_iam_role.cluster.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["kms:DescribeKey", "kms:CreateGrant", "kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey*"], Resource = aws_kms_key.main.arn }] })
}
resource "aws_cloudwatch_log_group" "eks" {
  name              = "/aws/eks/${local.name}/cluster"
  retention_in_days = var.log_retention_days
}
resource "aws_eks_cluster" "main" {
  name                      = local.name
  role_arn                  = aws_iam_role.cluster.arn
  version                   = var.kubernetes_version
  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = false
  }
  vpc_config {
    subnet_ids              = aws_subnet.app[*].id
    endpoint_private_access = true
    endpoint_public_access  = false
  }
  encryption_config {
    provider { key_arn = aws_kms_key.main.arn }
    resources = ["secrets"]
  }
  upgrade_policy { support_type = "STANDARD" }
  depends_on = [aws_iam_role_policy_attachment.cluster, aws_iam_role_policy.cluster_kms, aws_cloudwatch_log_group.eks]
}
resource "aws_vpc_security_group_ingress_rule" "eks_private_api" {
  security_group_id = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
  description       = "HTTPS to private EKS API from deployment runners in this VPC"
  cidr_ipv4         = aws_vpc.main.cidr_block
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
resource "aws_eks_access_entry" "admin" {
  for_each      = toset([local.cluster_admin_arn])
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = each.key
  type          = "STANDARD"
}
resource "aws_eks_access_policy_association" "admin" {
  for_each      = toset([local.cluster_admin_arn])
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = each.key
  policy_arn    = "arn:${data.aws_partition.current.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  access_scope { type = "cluster" }
  depends_on = [aws_eks_access_entry.admin]
}
data "tls_certificate" "oidc" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}
resource "aws_iam_openid_connect_provider" "eks" {
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.oidc.certificates[0].sha1_fingerprint]
}
data "aws_iam_policy_document" "node_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}
resource "aws_iam_role" "node" {
  for_each           = toset(["app", "media"])
  name               = "${local.name}-${each.key}-node"
  assume_role_policy = data.aws_iam_policy_document.node_assume.json
}
locals {
  node_policies = {
    worker = "AmazonEKSWorkerNodePolicy"
    ecr    = "AmazonEC2ContainerRegistryPullOnly"
    ssm    = "AmazonSSMManagedInstanceCore"
  }
  node_policy_attachments = { for x in setproduct(["app", "media"], keys(local.node_policies)) : "${x[0]}-${x[1]}" => { role = x[0], policy = local.node_policies[x[1]] } }
}
resource "aws_iam_role_policy_attachment" "node" {
  for_each   = local.node_policy_attachments
  role       = aws_iam_role.node[each.value.role].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/${each.value.policy}"
}
locals {
  oidc_host = replace(aws_iam_openid_connect_provider.eks.url, "https://", "")
  addon_irsa = {
    cni = { account = "aws-node", policy = "AmazonEKS_CNI_Policy" }
    ebs = { account = "ebs-csi-controller-sa", policy = "service-role/AmazonEBSCSIDriverPolicy" }
  }
}
resource "aws_iam_role" "addon" {
  for_each           = local.addon_irsa
  name               = "${local.name}-${each.key}-addon"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRoleWithWebIdentity", Principal = { Federated = aws_iam_openid_connect_provider.eks.arn }, Condition = { StringEquals = { "${local.oidc_host}:aud" = "sts.amazonaws.com", "${local.oidc_host}:sub" = "system:serviceaccount:kube-system:${each.value.account}" } } }] })
}
resource "aws_iam_role_policy_attachment" "addon" {
  for_each   = local.addon_irsa
  role       = aws_iam_role.addon[each.key].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/${each.value.policy}"
}
resource "aws_iam_role_policy" "ebs_kms" {
  name = "encrypted-ebs"
  role = aws_iam_role.addon["ebs"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["kms:CreateGrant", "kms:ListGrants", "kms:RevokeGrant"], Resource = aws_kms_key.main.arn, Condition = { Bool = { "kms:GrantIsForAWSResource" = "true" } } },
    { Effect = "Allow", Action = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"], Resource = aws_kms_key.main.arn }
  ] })
}
data "aws_eks_addon_version" "managed" {
  for_each           = toset(["vpc-cni", "coredns", "kube-proxy", "aws-ebs-csi-driver"])
  addon_name         = each.key
  kubernetes_version = var.kubernetes_version
  most_recent        = true
}
resource "aws_eks_addon" "cni" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "vpc-cni"
  addon_version               = data.aws_eks_addon_version.managed["vpc-cni"].version
  service_account_role_arn    = aws_iam_role.addon["cni"].arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "PRESERVE"
  configuration_values        = jsonencode({ env = { ENABLE_PREFIX_DELEGATION = "true", WARM_PREFIX_TARGET = "1" } })
  depends_on                  = [aws_iam_role_policy_attachment.addon]
}
resource "aws_launch_template" "app" {
  name_prefix            = "${local.name}-app-"
  update_default_version = true
  vpc_security_group_ids = [aws_security_group.app.id, aws_eks_cluster.main.vpc_config[0].cluster_security_group_id]
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 80
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }
  tag_specifications {
    resource_type = "instance"
    tags          = merge(local.tags, { Name = "${local.name}-app", Workload = "application" })
  }
}
resource "aws_launch_template" "media" {
  name_prefix            = "${local.name}-media-"
  update_default_version = true
  vpc_security_group_ids = [aws_security_group.media.id, aws_eks_cluster.main.vpc_config[0].cluster_security_group_id]
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 80
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }
  tag_specifications {
    resource_type = "instance"
    tags          = merge(local.tags, { Name = "${local.name}-media", Workload = "livekit" })
  }
}
resource "aws_eks_node_group" "app" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${local.name}-app"
  node_role_arn   = aws_iam_role.node["app"].arn
  subnet_ids      = aws_subnet.app[*].id
  ami_type        = "AL2023_x86_64_STANDARD"
  capacity_type   = "ON_DEMAND"
  instance_types  = [var.app_instance_type]
  scaling_config {
    min_size     = var.app_node_min
    desired_size = var.app_node_desired
    max_size     = var.app_node_max
  }
  update_config { max_unavailable = 1 }
  launch_template {
    id      = aws_launch_template.app.id
    version = aws_launch_template.app.latest_version
  }
  labels = { workload = "application" }
  tags   = { "k8s.io/cluster-autoscaler/enabled" = "true", "k8s.io/cluster-autoscaler/${local.name}" = "owned" }
  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
    precondition {
      condition     = var.app_node_min >= 3 && var.app_node_desired >= var.app_node_min && var.app_node_max >= var.app_node_desired
      error_message = "App capacity must satisfy 3 <= min <= desired <= max."
    }
  }
  depends_on = [aws_eks_addon.cni, aws_iam_role_policy_attachment.node, aws_route.nat]
}
resource "aws_eks_node_group" "media" {
  count           = 3
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${local.name}-media-${local.azs[count.index]}"
  node_role_arn   = aws_iam_role.node["media"].arn
  subnet_ids      = [aws_subnet.media[count.index].id]
  ami_type        = "AL2023_x86_64_STANDARD"
  capacity_type   = "ON_DEMAND"
  instance_types  = [var.media_instance_type]
  scaling_config {
    min_size     = var.media_nodes_per_az_min
    desired_size = var.media_nodes_per_az_desired
    max_size     = var.media_nodes_per_az_max
  }
  update_config { max_unavailable = 1 }
  launch_template {
    id      = aws_launch_template.media.id
    version = aws_launch_template.media.latest_version
  }
  labels = { workload = "livekit" }
  taint {
    key    = "workload"
    value  = "livekit"
    effect = "NO_SCHEDULE"
  }
  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
    precondition {
      condition     = var.media_nodes_per_az_min >= 2 && var.media_nodes_per_az_desired >= var.media_nodes_per_az_min && var.media_nodes_per_az_max >= var.media_nodes_per_az_desired
      error_message = "SFU capacity per AZ must satisfy 2 <= min <= desired <= max."
    }
  }
  depends_on = [aws_eks_addon.cni, aws_iam_role_policy_attachment.node, aws_route.internet]
}
resource "aws_autoscaling_group_tag" "app_enabled" {
  autoscaling_group_name = aws_eks_node_group.app.resources[0].autoscaling_groups[0].name
  tag {
    key                 = "k8s.io/cluster-autoscaler/enabled"
    value               = "true"
    propagate_at_launch = false
  }
}
resource "aws_autoscaling_group_tag" "app_cluster" {
  autoscaling_group_name = aws_eks_node_group.app.resources[0].autoscaling_groups[0].name
  tag {
    key                 = "k8s.io/cluster-autoscaler/${local.name}"
    value               = "owned"
    propagate_at_launch = false
  }
}
resource "aws_eks_addon" "after_nodes" {
  for_each                    = toset(["coredns", "kube-proxy", "aws-ebs-csi-driver"])
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = each.key
  addon_version               = data.aws_eks_addon_version.managed[each.key].version
  service_account_role_arn    = each.key == "aws-ebs-csi-driver" ? aws_iam_role.addon["ebs"].arn : null
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "PRESERVE"
  depends_on                  = [aws_eks_node_group.app, aws_iam_role_policy_attachment.addon]
}

data "aws_rds_engine_version" "postgres" {
  engine  = "aurora-postgresql"
  version = coalesce(var.db_engine_version, "16")
  latest  = true
}
resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.data[*].id
}
resource "aws_rds_cluster_parameter_group" "main" {
  name        = "${local.name}-pg16"
  family      = "aurora-postgresql16"
  description = "TLS-required PostgreSQL; 1 second slow query logging"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  parameter {
    name         = "log_min_duration_statement"
    value        = "1000"
    apply_method = "pending-reboot"
  }
}
resource "aws_rds_cluster" "main" {
  cluster_identifier              = local.name
  engine                          = "aurora-postgresql"
  engine_mode                     = "provisioned"
  engine_version                  = data.aws_rds_engine_version.postgres.version_actual
  database_name                   = "think_meet"
  master_username                 = "think_meet_admin"
  manage_master_user_password     = true
  master_user_secret_kms_key_id   = aws_kms_key.main.arn
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.main.arn
  db_subnet_group_name            = aws_db_subnet_group.main.name
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.main.name
  vpc_security_group_ids          = [aws_security_group.db.id]
  availability_zones              = local.azs
  backup_retention_period         = 35
  preferred_backup_window         = "18:00-19:00"
  preferred_maintenance_window    = "sun:19:00-sun:20:00"
  copy_tags_to_snapshot           = true
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.name}-final"
  enabled_cloudwatch_logs_exports = ["postgresql"]
  apply_immediately               = false
  lifecycle {
    prevent_destroy = true
  }
}
resource "aws_rds_cluster_instance" "main" {
  count                                 = 3
  identifier                            = "${local.name}-${count.index + 1}"
  cluster_identifier                    = aws_rds_cluster.main.id
  engine                                = aws_rds_cluster.main.engine
  engine_version                        = aws_rds_cluster.main.engine_version
  instance_class                        = var.db_instance_class
  availability_zone                     = local.azs[count.index]
  db_subnet_group_name                  = aws_db_subnet_group.main.name
  publicly_accessible                   = false
  auto_minor_version_upgrade            = false
  promotion_tier                        = count.index
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  performance_insights_kms_key_id       = aws_kms_key.main.arn
  copy_tags_to_snapshot                 = true
}
resource "aws_secretsmanager_secret" "db_app" {
  name                    = "${local.name}/database/application"
  description             = "Reserved for application database credentials supplied separately"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 30
}
resource "aws_secretsmanager_secret" "runtime" {
  name                    = "${local.name}/application/runtime"
  description             = "Reserved for application runtime secrets supplied separately"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 30
}
resource "aws_secretsmanager_secret" "db_migrator" {
  name                    = "${local.name}/database/migrator"
  description             = "Reserved for database migration credentials supplied separately"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 30
}
resource "aws_secretsmanager_secret" "redis" {
  for_each                = toset(["livekit", "application"])
  name                    = "${local.name}/redis/${each.key}"
  description             = "ElastiCache AUTH token managed by Terraform"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 30
}
# 인증값은 최초 생성 후 상태에서 재사용하며 서버 소스나 외부 스크립트가 필요하지 않습니다.
resource "random_password" "redis" {
  for_each = toset(["livekit", "application"])
  length   = 64
  special  = false
}
locals {
  redis_auth_tokens = var.redis_auth_tokens != null ? var.redis_auth_tokens : {
    for name, password in random_password.redis : name => password.result
  }
}
resource "aws_secretsmanager_secret_version" "redis" {
  for_each      = toset(["livekit", "application"])
  secret_id     = aws_secretsmanager_secret.redis[each.key].id
  secret_string = jsonencode({ auth_token = local.redis_auth_tokens[each.key] })
}

locals {
  proxy_secret_arn = var.use_app_db_secret_for_proxy ? aws_secretsmanager_secret.db_app.arn : aws_rds_cluster.main.master_user_secret[0].secret_arn
}
resource "aws_iam_role" "proxy" {
  name               = "${local.name}-rds-proxy"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "rds.amazonaws.com" } }] })
}
resource "aws_iam_role_policy" "proxy" {
  name = "database-secret"
  role = aws_iam_role.proxy.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = local.proxy_secret_arn },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.main.arn, Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.${var.region}.amazonaws.com" } } }
  ] })
}
resource "aws_db_proxy" "main" {
  name                   = local.name
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy.arn
  vpc_subnet_ids         = aws_subnet.data[*].id
  vpc_security_group_ids = [aws_security_group.proxy.id]
  require_tls            = true
  idle_client_timeout    = 1800
  debug_logging          = false
  auth {
    auth_scheme = "SECRETS"
    secret_arn  = local.proxy_secret_arn
    iam_auth    = "DISABLED"
  }
  depends_on = [aws_iam_role_policy.proxy]
}
resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.main.name
  connection_pool_config {
    connection_borrow_timeout    = 30
    max_connections_percent      = 70
    max_idle_connections_percent = 35
  }
}
resource "aws_db_proxy_target" "main" {
  db_proxy_name         = aws_db_proxy.main.name
  target_group_name     = aws_db_proxy_default_target_group.main.name
  db_cluster_identifier = aws_rds_cluster.main.id
  depends_on            = [aws_rds_cluster_instance.main]
}
resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.data[*].id
}
resource "aws_elasticache_parameter_group" "main" {
  name        = "${local.name}-redis7"
  family      = "redis7"
  description = "Do not silently evict real-time room/event state"
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}
resource "aws_elasticache_replication_group" "main" {
  for_each                    = toset(["livekit", "application"])
  replication_group_id        = "${local.name}-${each.key}"
  description                 = "${local.name} isolated ${each.key} Redis"
  engine                      = "redis"
  engine_version              = "7.1"
  node_type                   = var.redis_node_type
  num_cache_clusters          = 3
  preferred_cache_cluster_azs = local.azs
  automatic_failover_enabled  = true
  multi_az_enabled            = true
  subnet_group_name           = aws_elasticache_subnet_group.main.name
  security_group_ids          = [aws_security_group.redis[each.key].id]
  parameter_group_name        = aws_elasticache_parameter_group.main.name
  port                        = 6379
  at_rest_encryption_enabled  = true
  kms_key_id                  = aws_kms_key.main.arn
  transit_encryption_enabled  = true
  transit_encryption_mode     = "required"
  auth_token                  = local.redis_auth_tokens[each.key]
  auth_token_update_strategy  = "ROTATE"
  snapshot_retention_limit    = 7
  snapshot_window             = "17:00-18:00"
  maintenance_window          = "sun:20:00-sun:21:00"
  auto_minor_version_upgrade  = true
  apply_immediately           = false
  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis[each.key].name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }
  lifecycle { prevent_destroy = true }
}
resource "aws_cloudwatch_log_group" "redis" {
  for_each          = toset(["livekit", "application"])
  name              = "/${local.name}/redis/${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_s3_bucket" "logs" {
  bucket        = "${local.name}-${data.aws_caller_identity.current.account_id}-${var.region}-logs"
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
    { Sid = "ELBAccessLogs", Effect = "Allow", Principal = { Service = "logdelivery.elasticloadbalancing.amazonaws.com" }, Action = "s3:PutObject", Resource = "${aws_s3_bucket.logs.arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*", Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } } },
    { Sid = "S3AccessLogs", Effect = "Allow", Principal = { Service = "logging.s3.amazonaws.com" }, Action = "s3:PutObject", Resource = "${aws_s3_bucket.logs.arn}/s3/*", Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } } }
  ] })
}
resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "retain-90-days"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
resource "aws_s3_bucket" "materials" {
  bucket        = "${local.name}-${data.aws_caller_identity.current.account_id}-${var.region}-materials"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "materials" {
  bucket                  = aws_s3_bucket.materials.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "materials" {
  bucket = aws_s3_bucket.materials.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "materials" {
  bucket = aws_s3_bucket.materials.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "materials" {
  bucket = aws_s3_bucket.materials.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
  }
}
resource "aws_s3_bucket_policy" "materials" {
  bucket = aws_s3_bucket.materials.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.materials.arn, "${aws_s3_bucket.materials.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }] })
}
resource "aws_s3_bucket_lifecycle_configuration" "materials" {
  bucket = aws_s3_bucket.materials.id
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
  rule {
    id     = "old-versions-90-days"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
  depends_on = [aws_s3_bucket_versioning.materials]
}
resource "aws_s3_bucket_logging" "materials" {
  bucket        = aws_s3_bucket.materials.id
  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "s3/materials/"
  depends_on    = [aws_s3_bucket_policy.logs]
}
resource "aws_s3_bucket" "web" {
  bucket        = "${local.name}-${data.aws_caller_identity.current.account_id}-${var.region}-web"
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id
  versioning_configuration { status = "Enabled" }
}
# OAC 허용과 비암호화 통신 차단을 포함한 웹 버킷 정책은 edge 계층에서 관리합니다.
resource "aws_ecr_repository" "api" {
  name                 = "${local.name}-api"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.main.arn
  }
  force_delete = false
}
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = jsonencode({ rules = [{ rulePriority = 1, description = "Remove only untagged images after 7 days", selection = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7 }, action = { type = "expire" } }] })
}
resource "aws_acm_certificate" "regional" {
  domain_name               = "origin.${var.domain_name}"
  subject_alternative_names = ["rtc.${var.domain_name}", "turn.${var.domain_name}"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}
resource "aws_route53_record" "certificate" {
  for_each        = { for dvo in aws_acm_certificate.regional.domain_validation_options : dvo.domain_name => { name = dvo.resource_record_name, record = dvo.resource_record_value, type = dvo.resource_record_type } }
  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}
resource "aws_acm_certificate_validation" "regional" {
  certificate_arn         = aws_acm_certificate.regional.arn
  validation_record_fqdns = [for r in aws_route53_record.certificate : r.fqdn]
}

resource "aws_sns_topic" "alarms" { name = "${local.name}-alarms" }
resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}
resource "aws_cloudwatch_log_group" "flow" {
  name              = "/${local.name}/vpc-flow"
  retention_in_days = var.log_retention_days
}
resource "aws_iam_role" "flow" {
  name               = "${local.name}-vpc-flow-logs"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "vpc-flow-logs.amazonaws.com" }, Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }, ArnLike = { "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:ec2:${var.region}:${data.aws_caller_identity.current.account_id}:vpc-flow-log/*" } } }] })
}
resource "aws_iam_role_policy" "flow" {
  name = "write-flow-logs"
  role = aws_iam_role.flow.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"], Resource = "${aws_cloudwatch_log_group.flow.arn}:*" },
    { Effect = "Allow", Action = ["logs:DescribeLogGroups"], Resource = "*" }
  ] })
}
resource "aws_flow_log" "main" {
  vpc_id                   = aws_vpc.main.id
  traffic_type             = "ALL"
  log_destination_type     = "cloud-watch-logs"
  log_destination          = aws_cloudwatch_log_group.flow.arn
  iam_role_arn             = aws_iam_role.flow.arn
  max_aggregation_interval = 60
  depends_on               = [aws_iam_role_policy.flow]
}
resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  count               = 3
  alarm_name          = "${local.name}-aurora-${count.index + 1}-cpu"
  alarm_description   = "Aurora CPU above 75% for 10 minutes; review slow SQL and pool pressure"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_rds_cluster_instance.main[count.index].identifier }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 75
  evaluation_periods  = 2
  period              = 300
  statistic           = "Average"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
resource "aws_cloudwatch_metric_alarm" "db_connections" {
  alarm_name          = "${local.name}-aurora-connections"
  alarm_description   = "Connection pressure; initial threshold requires calibration against selected instance max_connections"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  dimensions          = { DBClusterIdentifier = aws_rds_cluster.main.id, Role = "WRITER" }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 500
  evaluation_periods  = 2
  period              = 300
  statistic           = "Maximum"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}
locals {
  redis_alarm_specs = { cpu = { metric = "EngineCPUUtilization", threshold = 65 }, memory = { metric = "DatabaseMemoryUsagePercentage", threshold = 75 }, evictions = { metric = "Evictions", threshold = 0 } }
  redis_alarms      = { for item in setproduct(["livekit", "application"], [0, 1, 2], keys(local.redis_alarm_specs)) : "${item[0]}-${item[1]}-${item[2]}" => { service = item[0], node = item[1], spec = local.redis_alarm_specs[item[2]] } }
}
resource "aws_cloudwatch_metric_alarm" "redis" {
  for_each            = local.redis_alarms
  alarm_name          = "${local.name}-redis-${each.key}"
  namespace           = "AWS/ElastiCache"
  metric_name         = each.value.spec.metric
  dimensions          = { CacheClusterId = "${aws_elasticache_replication_group.main[each.value.service].replication_group_id}-${format("%03d", each.value.node + 1)}", CacheNodeId = "0001" }
  comparison_operator = "GreaterThanThreshold"
  threshold           = each.value.spec.threshold
  evaluation_periods  = 2
  period              = 300
  statistic           = each.value.spec.metric == "Evictions" ? "Sum" : "Average"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${local.name}"
  retention_in_days = var.log_retention_days
}
resource "aws_wafv2_web_acl" "main" {
  name        = local.name
  scope       = "REGIONAL"
  description = "ALB protection; upload size validated by application, WAF only inspects initial ALB body bytes"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.name
    sampled_requests_enabled   = false
  }
  rule {
    name     = "AWSCommonRules"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
        scope_down_statement {
          not_statement {
            statement {
              and_statement {
                statement {
                  byte_match_statement {
                    search_string         = "/api/v1/materials"
                    positional_constraint = "EXACTLY"
                    field_to_match {
                      uri_path {}
                    }
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
                statement {
                  byte_match_statement {
                    search_string         = "POST"
                    positional_constraint = "EXACTLY"
                    field_to_match {
                      method {}
                    }
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
              }
            }
          }
        }
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "common"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "AWSKnownBadInputs"
    priority = 20
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
        scope_down_statement {
          not_statement {
            statement {
              and_statement {
                statement {
                  byte_match_statement {
                    search_string         = "/api/v1/materials"
                    positional_constraint = "EXACTLY"
                    field_to_match {
                      uri_path {}
                    }
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
                statement {
                  byte_match_statement {
                    search_string         = "POST"
                    positional_constraint = "EXACTLY"
                    field_to_match {
                      method {}
                    }
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "bad-inputs"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "AWSIpReputation"
    priority = 30
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ip-reputation"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "PerIpRateLimit"
    priority = 40
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.rtc_rate_limit
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
        # CloudFront API 요청은 실제 클라이언트 IP를 확인할 수 있는 edge에서 제한합니다.
        # 이 규칙은 CloudFront를 거치지 않는 RTC 신호 요청에만 적용합니다.
        scope_down_statement {
          byte_match_statement {
            search_string         = "rtc.${var.domain_name}"
            positional_constraint = "EXACTLY"
            field_to_match {
              single_header { name = "host" }
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit"
      sampled_requests_enabled   = false
    }
  }
}
resource "aws_wafv2_web_acl_logging_configuration" "main" {
  resource_arn            = aws_wafv2_web_acl.main.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  redacted_fields {
    single_header { name = "authorization" }
  }
  redacted_fields {
    single_header { name = "cookie" }
  }
  redacted_fields {
    query_string {}
  }
}

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
