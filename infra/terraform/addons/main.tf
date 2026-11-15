terraform {
  required_version = ">= 1.5.7, < 2.0.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.38"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.1"
    }
  }
}

data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket = var.platform_state_bucket
    key    = var.platform_state_key
    region = var.state_region
  }
}

locals {
  platform     = data.terraform_remote_state.platform.outputs
  cluster_name = local.platform.cluster_name
  role_prefix  = substr(local.cluster_name, 0, 38)
  tags = merge(var.tags, {
    ManagedBy = "Terraform"
    Stack     = "addons"
    Cluster   = local.cluster_name
  })
}

provider "aws" {
  region = local.platform.region
  default_tags { tags = local.tags }
}

data "aws_eks_cluster" "this" {
  name = local.cluster_name

  lifecycle {
    postcondition {
      condition     = self.version == "1.36"
      error_message = "This add-on bundle pins Cluster Autoscaler 1.36.1. Review and update the tested pins before using another EKS minor version."
    }
  }
}

# 필요할 때 단기 자격 증명을 발급하며 EKS 접근 토큰은
# Terraform 상태에 저장하지 않습니다. 실행기에는 AWS CLI v2와 EKS 접속 경로가 필요합니다.
provider "kubernetes" {
  host                   = data.aws_eks_cluster.this.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", local.cluster_name, "--region", local.platform.region]
  }
}

provider "helm" {
  kubernetes = {
    host                   = data.aws_eks_cluster.this.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)
    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", local.cluster_name, "--region", local.platform.region]
    }
  }
}

locals {
  # 공식 저장소에서 확인한 버전입니다. ../../docs/verification.md#addons-version-sources를 참고하세요.
  # 업그레이드할 때 컨트롤러 차트·이미지·포함된 IAM 정책의 릴리스를 함께 맞춥니다.
  lbc_version       = "3.6.2"
  metrics_version   = "3.14.0"
  autoscaler_chart  = "9.59.0"
  autoscaler_image  = "v1.36.1"
  application_nodes = { workload = "application" }
  regional_sts      = { "eks.amazonaws.com/sts-regional-endpoints" = "true" }
}

module "load_balancer_controller_irsa" {
  source            = "./modules/irsa"
  name              = "${local.role_prefix}-load-balancer-controller"
  oidc_provider_arn = local.platform.cluster_oidc_provider_arn
  oidc_issuer_url   = local.platform.cluster_oidc_issuer_url
  namespace         = "kube-system"
  service_account   = "aws-load-balancer-controller"
  policy_json       = jsonencode(jsondecode(file("${path.module}/policies/aws-load-balancer-controller-v3.6.2.json")))
  tags              = local.tags
}

resource "helm_release" "load_balancer_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = local.lbc_version
  namespace  = "kube-system"
  atomic     = true
  timeout    = 900
  wait       = true

  values = [yamlencode({
    clusterName  = local.cluster_name
    region       = local.platform.region
    vpcId        = local.platform.vpc_id
    replicaCount = 2
    image = {
      tag = "v${local.lbc_version}"
    }
    serviceAccount = {
      create = true
      name   = "aws-load-balancer-controller"
      annotations = merge(local.regional_sts, {
        "eks.amazonaws.com/role-arn" = module.load_balancer_controller_irsa.role_arn
      })
    }
    # 서비스의 로드밸런서 종류는 명시적으로 지정합니다. 변이 웹훅이 다른 서비스를
    # 자동으로 NLB로 바꾸지 않도록 설정합니다.
    enableServiceMutatorWebhook = false
    nodeSelector                = local.application_nodes
    podDisruptionBudget         = { minAvailable = 1 }
    resources = {
      requests = { cpu = "200m", memory = "256Mi" }
      limits   = { memory = "512Mi" }
    }
    affinity = {
      podAntiAffinity = {
        requiredDuringSchedulingIgnoredDuringExecution = [{
          topologyKey = "kubernetes.io/hostname"
          labelSelector = {
            matchLabels = { "app.kubernetes.io/name" = "aws-load-balancer-controller" }
          }
        }]
      }
    }
    topologySpreadConstraints = [{
      maxSkew           = 1
      topologyKey       = "topology.kubernetes.io/zone"
      whenUnsatisfiable = "ScheduleAnyway"
      labelSelector = {
        matchLabels = { "app.kubernetes.io/name" = "aws-load-balancer-controller" }
      }
    }]
  })]
}

resource "helm_release" "metrics_server" {
  name       = "metrics-server"
  repository = "https://kubernetes-sigs.github.io/metrics-server/"
  chart      = "metrics-server"
  version    = local.metrics_version
  namespace  = "kube-system"
  atomic     = true
  timeout    = 900
  wait       = true

  values = [yamlencode({
    replicas     = 2
    image        = { tag = "v0.9.0" }
    nodeSelector = local.application_nodes
    # kubelet TLS 검증을 유지하며 --kubelet-insecure-tls는 추가하지 않습니다.
    args = ["--kubelet-certificate-authority=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"]
    # 차트에서 생성한 서버 CA를 APIService.caBundle에 주입합니다.
    apiService          = { insecureSkipTLSVerify = false }
    tls                 = { type = "helm" }
    podDisruptionBudget = { enabled = true, minAvailable = 1 }
    resources = {
      requests = { cpu = "100m", memory = "200Mi" }
      limits   = { memory = "400Mi" }
    }
    affinity = {
      podAntiAffinity = {
        requiredDuringSchedulingIgnoredDuringExecution = [{
          topologyKey   = "kubernetes.io/hostname"
          labelSelector = { matchLabels = { "app.kubernetes.io/name" = "metrics-server" } }
        }]
      }
    }
    topologySpreadConstraints = [{
      maxSkew           = 1
      topologyKey       = "topology.kubernetes.io/zone"
      whenUnsatisfiable = "ScheduleAnyway"
      labelSelector     = { matchLabels = { "app.kubernetes.io/name" = "metrics-server" } }
    }]
  })]
}

data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

locals {
  # 이 허용 목록은 앱 노드 그룹 출력에서만 가져옵니다.
  # 미디어 노드에 탐색 태그가 잘못 붙어도 종료 권한은 부여되지 않습니다.
  application_asg_arns = [for name in local.platform.app_autoscaling_group_names :
    "arn:${data.aws_partition.current.partition}:autoscaling:${local.platform.region}:${data.aws_caller_identity.current.account_id}:autoScalingGroup:*:autoScalingGroupName/${name}"
  ]
}

data "aws_iam_policy_document" "autoscaler" {
  statement {
    sid = "ReadCapacityInventory"
    actions = [
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeAutoScalingInstances",
      "autoscaling:DescribeLaunchConfigurations",
      "autoscaling:DescribeScalingActivities",
      "autoscaling:DescribeTags",
      "ec2:DescribeImages",
      "ec2:DescribeInstanceTypes",
      "ec2:DescribeLaunchTemplateVersions",
      "ec2:GetInstanceTypesFromInstanceRequirements",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "ReadClusterNodegroupTemplates"
    actions   = ["eks:DescribeNodegroup"]
    resources = ["arn:${data.aws_partition.current.partition}:eks:${local.platform.region}:${data.aws_caller_identity.current.account_id}:nodegroup/${local.cluster_name}/*/*"]
  }
  statement {
    sid       = "ScaleApplicationGroupsOnly"
    actions   = ["autoscaling:SetDesiredCapacity", "autoscaling:TerminateInstanceInAutoScalingGroup"]
    resources = local.application_asg_arns
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/k8s.io/cluster-autoscaler/enabled"
      values   = ["true"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/k8s.io/cluster-autoscaler/${local.cluster_name}"
      values   = ["owned"]
    }
  }
}

module "autoscaler_irsa" {
  count             = var.enable_cluster_autoscaler ? 1 : 0
  source            = "./modules/irsa"
  name              = "${local.role_prefix}-application-autoscaler"
  oidc_provider_arn = local.platform.cluster_oidc_provider_arn
  oidc_issuer_url   = local.platform.cluster_oidc_issuer_url
  namespace         = "kube-system"
  service_account   = "application-cluster-autoscaler"
  policy_json       = data.aws_iam_policy_document.autoscaler.json
  tags              = local.tags
}

resource "helm_release" "autoscaler" {
  count      = var.enable_cluster_autoscaler ? 1 : 0
  name       = "application-cluster-autoscaler"
  repository = "https://kubernetes.github.io/autoscaler"
  chart      = "cluster-autoscaler"
  version    = local.autoscaler_chart
  namespace  = "kube-system"
  atomic     = true
  timeout    = 900
  wait       = true

  values = [yamlencode({
    cloudProvider = "aws"
    awsRegion     = local.platform.region
    replicaCount  = 2
    image         = { tag = local.autoscaler_image }
    autoDiscovery = {
      clusterName = local.cluster_name
      tags = [
        "k8s.io/cluster-autoscaler/enabled=true",
        "k8s.io/cluster-autoscaler/${local.cluster_name}=owned",
      ]
    }
    rbac = {
      serviceAccount = {
        create = true
        name   = "application-cluster-autoscaler"
        annotations = merge(local.regional_sts, {
          "eks.amazonaws.com/role-arn" = module.autoscaler_irsa[0].role_arn
        })
      }
    }
    nodeSelector = local.application_nodes
    podAnnotations = {
      "cluster-autoscaler.kubernetes.io/safe-to-evict" = "false"
    }
    podDisruptionBudget = { minAvailable = 1, maxUnavailable = null }
    extraArgs = {
      logtostderr                   = true
      stderrthreshold               = "info"
      v                             = 2
      "leader-elect"                = true
      "expander"                    = "least-waste"
      "scale-down-delay-after-add"  = "10m"
      "scale-down-unneeded-time"    = "15m"
      "skip-nodes-with-system-pods" = true
    }
    resources = {
      requests = { cpu = "100m", memory = "300Mi" }
      limits   = { memory = "600Mi" }
    }
    affinity = {
      podAntiAffinity = {
        requiredDuringSchedulingIgnoredDuringExecution = [{
          topologyKey   = "kubernetes.io/hostname"
          labelSelector = { matchLabels = { "app.kubernetes.io/instance" = "application-cluster-autoscaler" } }
        }]
      }
    }
  })]

  lifecycle {
    precondition {
      condition     = length(local.platform.app_autoscaling_group_names) > 0
      error_message = "Platform must expose at least one application ASG; no media ASGs may appear in app_autoscaling_group_names."
    }
  }
}

# 공식 커뮤니티 색인에서 확인한 차트 29.45.0 / Prometheus v3.16.0:
# https://prometheus-community.github.io/helm-charts/index.yaml
# 차트 SHA-256: 909e5af9ef262a929b0a89bbbe42cfe991f154dda658264b83b192436e63cfa6
# AWS SigV4를 사용하는 원격 쓰기 안내:
# https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-onboard-ingest-metrics-existing-Prometheus.html
locals {
  prometheus_chart_version = "29.45.0"
  prometheus_image_tag     = "v3.16.0"
  prometheus_sa            = "think-meet-prometheus-scraper"
}

resource "aws_prometheus_workspace" "main" {
  count = var.enable_observability ? 1 : 0
  alias = "${local.cluster_name}-metrics"
  tags  = local.tags
}

module "prometheus_irsa" {
  count             = var.enable_observability ? 1 : 0
  source            = "./modules/irsa"
  name              = "${local.role_prefix}-prometheus-remote-write"
  oidc_provider_arn = local.platform.cluster_oidc_provider_arn
  oidc_issuer_url   = local.platform.cluster_oidc_issuer_url
  namespace         = "kube-system"
  service_account   = local.prometheus_sa
  # 이 역할은 워크스페이스 조회·규칙 변경·다른 워크스페이스 쓰기를 허용하지 않습니다.
  policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "aps:RemoteWrite"
      Resource = aws_prometheus_workspace.main[0].arn
    }]
  })
  tags = local.tags
}

# 오브젝트 탐색과 kubelet 지표 조회만 허용합니다. Secret 읽기·Pod 쓰기·
# nodes/proxy·exec·앱 자격 증명 접근은 허용하지 않습니다. kubelet 웹훅 인가는
# /metrics/*를 nodes/metrics에 대응시키며 EKS CA로 서버 인증서를 검증합니다.
# https://kubernetes.io/docs/reference/access-authn-authz/kubelet-authn-authz/
resource "kubernetes_cluster_role_v1" "prometheus" {
  count = var.enable_observability ? 1 : 0
  metadata { name = local.prometheus_sa }
  rule {
    api_groups = [""]
    resources  = ["pods", "nodes"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = [""]
    resources  = ["nodes/metrics"]
    verbs      = ["get"]
  }
}

resource "kubernetes_cluster_role_binding_v1" "prometheus" {
  count = var.enable_observability ? 1 : 0
  metadata { name = local.prometheus_sa }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role_v1.prometheus[0].metadata[0].name
  }
  subject {
    kind      = "ServiceAccount"
    name      = local.prometheus_sa
    namespace = "kube-system"
  }
}

resource "helm_release" "prometheus" {
  count      = var.enable_observability ? 1 : 0
  name       = "think-meet-prometheus"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "prometheus"
  version    = local.prometheus_chart_version
  namespace  = "kube-system"
  atomic     = true
  timeout    = 900
  wait       = true

  values = [yamlencode({
    rbac = { create = false }
    serviceAccounts = {
      server = {
        create = true
        name   = local.prometheus_sa
        annotations = merge(local.regional_sts, {
          "eks.amazonaws.com/role-arn" = module.prometheus_irsa[0].role_arn
        })
      }
    }
    alertmanager               = { enabled = false }
    "kube-state-metrics"       = { enabled = false }
    "prometheus-node-exporter" = { enabled = false }
    "prometheus-pushgateway"   = { enabled = false }
    # 차트의 기본 탐색 작업을 모두 끄고 아래에 명시한 수집 작업만 실행합니다.
    scrapeConfigs = null
    server = {
      image            = { tag = local.prometheus_image_tag }
      replicaCount     = 1
      nodeSelector     = local.application_nodes
      persistentVolume = { enabled = false }
      emptyDir         = { sizeLimit = "8Gi" }
      retention        = "2h"
      retentionSize    = "6GB"
      strategy         = { type = "Recreate" }
      service          = { type = "ClusterIP" }
      global = {
        scrape_interval     = "15s"
        scrape_timeout      = "10s"
        evaluation_interval = "30s"
        external_labels = {
          cluster = local.cluster_name
          region  = local.platform.region
        }
      }
      resources = {
        requests = { cpu = "500m", memory = "1Gi", "ephemeral-storage" = "8Gi" }
        limits   = { memory = "2Gi", "ephemeral-storage" = "10Gi" }
      }
      remoteWrite = [{
        url   = "${aws_prometheus_workspace.main[0].prometheus_endpoint}api/v1/remote_write"
        sigv4 = { region = local.platform.region }
        queue_config = {
          max_samples_per_send = 1000
          max_shards           = 10
          capacity             = 5000
        }
      }]
    }
    serverFiles = {
      "prometheus.yml" = {
        scrape_configs = [
          {
            job_name       = "prometheus"
            static_configs = [{ targets = ["localhost:9090"] }]
          },
          {
            job_name     = "think-meet-livekit"
            metrics_path = "/metrics"
            sample_limit = 100000
            kubernetes_sd_configs = [{
              role       = "pod"
              namespaces = { names = [var.observed_namespace] }
            }]
            relabel_configs = [
              { source_labels = ["__meta_kubernetes_pod_label_app"], regex = "think-meet-livekit", action = "keep" },
              { source_labels = ["__meta_kubernetes_pod_phase"], regex = "Running", action = "keep" },
              { source_labels = ["__meta_kubernetes_pod_container_port_name"], regex = "metrics", action = "keep" },
              { source_labels = ["__meta_kubernetes_pod_container_port_number"], regex = "6789", action = "keep" },
              { source_labels = ["__meta_kubernetes_namespace"], target_label = "namespace" },
              { source_labels = ["__meta_kubernetes_pod_name"], target_label = "pod" },
              { source_labels = ["__meta_kubernetes_pod_node_name"], target_label = "node" },
            ]
          },
          {
            # API·SFU 컨테이너의 CPU·메모리를 수집합니다. API HTTP·
            # Socket.IO 지연·Prisma 풀·브라우저 RTCStats 계측은 별도 구현이 필요합니다.
            # kubelet TLS와 nodes/metrics를 직접 사용해 광범위한 nodes/proxy 접근을 피합니다.
            job_name              = "think-meet-container-resources"
            scheme                = "https"
            metrics_path          = "/metrics/cadvisor"
            sample_limit          = 100000
            kubernetes_sd_configs = [{ role = "node" }]
            tls_config = {
              ca_file = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
            }
            authorization = {
              credentials_file = "/var/run/secrets/kubernetes.io/serviceaccount/token"
            }
            relabel_configs = [
              { source_labels = ["__meta_kubernetes_node_address_InternalIP"], target_label = "__address__", replacement = "$1:10250" },
              { source_labels = ["__meta_kubernetes_node_name"], target_label = "node" },
            ]
            metric_relabel_configs = [
              { source_labels = ["namespace"], regex = var.observed_namespace, action = "keep" },
              { source_labels = ["__name__"], regex = "container_(cpu_.*|memory_.*|network_.*|fs_.*|start_time_seconds)", action = "keep" },
            ]
          },
        ]
      }
    }
  })]

  depends_on = [kubernetes_cluster_role_binding_v1.prometheus]
}

# 단일 수집기는 emptyDir를 사용합니다. 로컬 TSDB는 영속 저장되지 않으며 AMP가
# 수신한 표본만 보관합니다. 수집기 Pod·노드가 사라지면 미전송 WAL이 유실될 수 있습니다.
# 수집기 중단은 관측 공백을 뜻하며 앱 장애 조치 신호로 사용하지 않습니다.
# 알림 전송·Grafana·API 업무 지표는 별도 구성이 필요합니다.

output "cluster_name" {
  value = local.cluster_name
}

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
