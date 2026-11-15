# Authenticate API origin requests from this CloudFront distribution.
resource "random_password" "cloudfront_origin" {
  length  = 64
  special = false
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

data "aws_iam_policy_document" "api_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.eks.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub"
      values   = ["system:serviceaccount:${var.namespace}:${var.api_service_account}"]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${aws_eks_cluster.main.name}-api"
  assume_role_policy = data.aws_iam_policy_document.api_assume.json
}

data "aws_iam_policy_document" "api" {
  statement {
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.materials.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.materials.arn}/*"]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

# 로드밸런서와 비어 있는 대상 그룹만 생성합니다. 서버 대상 등록은 별도 배포에서 수행합니다.

resource "aws_lb" "application" {
  count                      = var.deploy_edge ? 1 : 0
  name_prefix                = "app-"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.ingress[*].id
  idle_timeout               = 3600
  drop_invalid_header_fields = true
  enable_deletion_protection = var.deletion_protection
  access_logs {
    bucket  = aws_s3_bucket.logs.id
    prefix  = "alb"
    enabled = true
  }
  tags = { Name = "${local.name}-application" }
  depends_on = [
    aws_s3_bucket_policy.logs,
    aws_s3_bucket_server_side_encryption_configuration.logs,
    aws_s3_bucket_ownership_controls.logs,
  ]
}

resource "aws_lb_target_group" "api" {
  count                = var.deploy_edge ? 1 : 0
  name_prefix          = "api-"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 60
  health_check {
    path                = var.api_health_check_path
    port                = "traffic-port"
    matcher             = "200"
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400
    enabled         = true
  }
}

resource "aws_lb_target_group" "media_gateway" {
  count                = var.deploy_edge ? 1 : 0
  name_prefix          = "gate-"
  port                 = 8080
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 300
  health_check {
    path                = var.gateway_health_check_path
    port                = "traffic-port"
    matcher             = "200"
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "application" {
  count             = var.deploy_edge ? 1 : 0
  load_balancer_arn = aws_lb.application[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.regional.certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "api" {
  count        = var.deploy_edge ? 1 : 0
  listener_arn = aws_lb_listener.application[0].arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }
  condition {
    host_header { values = ["origin.${var.domain_name}"] }
  }
  condition {
    http_header {
      http_header_name = "X-Think-Meet-Origin"
      values           = [random_password.cloudfront_origin.result]
    }
  }
  condition {
    path_pattern { values = ["/api", "/api/*", "/socket.io", "/socket.io/*"] }
  }
}

resource "aws_lb_listener_rule" "media_signal" {
  count        = var.deploy_edge ? 1 : 0
  listener_arn = aws_lb_listener.application[0].arn
  priority     = 20
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.media_gateway[0].arn
  }
  condition {
    host_header { values = ["rtc.${var.domain_name}"] }
  }
}

resource "aws_wafv2_web_acl_association" "application" {
  count        = var.deploy_edge ? 1 : 0
  resource_arn = aws_lb.application[0].arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}

resource "aws_lb" "turn" {
  count                            = var.deploy_edge ? 1 : 0
  name_prefix                      = "turn-"
  load_balancer_type               = "network"
  internal                         = false
  security_groups                  = [aws_security_group.turn.id]
  subnets                          = aws_subnet.ingress[*].id
  enable_cross_zone_load_balancing = true
  enable_deletion_protection       = var.deletion_protection
  tags                             = { Name = "${local.name}-turn" }
}

resource "aws_lb_target_group" "turn" {
  count                  = var.deploy_edge ? 1 : 0
  name_prefix            = "turn-"
  port                   = 5349
  protocol               = "TCP"
  target_type            = "ip"
  vpc_id                 = aws_vpc.main.id
  proxy_protocol_v2      = true
  deregistration_delay   = 300
  connection_termination = false
  health_check {
    protocol            = "TCP"
    port                = "7880"
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "turn" {
  count             = var.deploy_edge ? 1 : 0
  load_balancer_arn = aws_lb.turn[0].arn
  port              = 443
  protocol          = "TLS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.regional.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.turn[0].arn
  }
}

resource "aws_acm_certificate" "edge" {
  provider          = aws.us_east_1
  count             = var.deploy_edge ? 1 : 0
  domain_name       = var.domain_name
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "edge_certificate" {
  for_each = var.deploy_edge ? {
    for dvo in aws_acm_certificate.edge[0].domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
    } : {
  }
  zone_id = var.hosted_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.value]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "edge" {
  provider                = aws.us_east_1
  count                   = var.deploy_edge ? 1 : 0
  certificate_arn         = aws_acm_certificate.edge[0].arn
  validation_record_fqdns = [for r in aws_route53_record.edge_certificate : r.fqdn]
}

resource "aws_cloudfront_origin_access_control" "web" {
  count                             = var.deploy_edge ? 1 : 0
  name                              = "${aws_eks_cluster.main.name}-web"
  description                       = "Private frontend S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "static" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "dynamic" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "api" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_function" "spa" {
  count   = var.deploy_edge ? 1 : 0
  name    = "${aws_eks_cluster.main.name}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  comment = "SPA routing applies only to the static behavior; API errors remain API errors."
  code    = <<-JS
    function handler(event) {
      var r = event.request;
      var last = r.uri.substring(r.uri.lastIndexOf('/') + 1);
      if (r.uri.endsWith('/') || last.indexOf('.') === -1) r.uri = '/index.html';
      return r;
}
  JS
}

resource "aws_cloudfront_response_headers_policy" "security" {
  count = var.deploy_edge ? 1 : 0
  name  = "${aws_eks_cluster.main.name}-web-security"
  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }
  }
  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(self), microphone=(self), display-capture=(self)"
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "web" {
  count               = var.deploy_edge ? 1 : 0
  web_acl_id          = aws_wafv2_web_acl.edge[0].arn
  enabled             = true
  is_ipv6_enabled     = true
  aliases             = [var.domain_name]
  default_root_object = "index.html"
  price_class         = "PriceClass_All"
  comment             = "Think Meet static web plus same-origin API and Socket.IO; RTC bypasses CloudFront."
  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "web-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.web[0].id
  }
  origin {
    domain_name = "origin.${var.domain_name}"
    origin_id   = "api-alb"
    custom_header {
      name  = "X-Think-Meet-Origin"
      value = random_password.cloudfront_origin.result
    }
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }
  }
  default_cache_behavior {
    target_origin_id           = "web-s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.static.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security[0].id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa[0].arn
    }
  }
  dynamic "ordered_cache_behavior" {
    for_each = ["/api/*", "/socket.io/*"]
    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = "api-alb"
      viewer_protocol_policy     = "https-only"
      allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = data.aws_cloudfront_cache_policy.dynamic.id
      origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.api.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.security[0].id
    }
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.edge[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
  depends_on = [aws_route53_record.origin]
}

data "aws_iam_policy_document" "web" {
  count = var.deploy_edge ? 1 : 0
  statement {
    sid       = "CloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web[0].arn]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.web.arn, "${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  count  = var.deploy_edge ? 1 : 0
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web[0].json
}

resource "aws_route53_record" "origin" {
  count   = var.deploy_edge ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = "origin.${var.domain_name}"
  type    = "A"
  alias {
    name                   = aws_lb.application[0].dns_name
    zone_id                = aws_lb.application[0].zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "rtc" {
  count   = var.deploy_edge ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = "rtc.${var.domain_name}"
  type    = "A"
  alias {
    name                   = aws_lb.application[0].dns_name
    zone_id                = aws_lb.application[0].zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "turn" {
  count   = var.deploy_edge ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = "turn.${var.domain_name}"
  type    = "A"
  alias {
    name                   = aws_lb.turn[0].dns_name
    zone_id                = aws_lb.turn[0].zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "web" {
  for_each = var.deploy_edge ? toset(["A", "AAAA"]) : toset([])
  zone_id  = var.hosted_zone_id
  name     = var.domain_name
  type     = each.value
  alias {
    name                   = aws_cloudfront_distribution.web[0].domain_name
    zone_id                = aws_cloudfront_distribution.web[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# CloudFront는 사용자 IP를 확인하지만 리전 ALB에는 API 요청의 CloudFront edge IP가 보입니다.
# 교실·학교가 NAT를 공유할 수 있으므로 이 경계 제한은 계정별 제한으로 사용하지 않습니다.

resource "aws_wafv2_web_acl" "edge" {
  provider = aws.us_east_1
  count    = var.deploy_edge ? 1 : 0
  name     = "${aws_eks_cluster.main.name}-edge"
  scope    = "CLOUDFRONT"
  default_action {
    allow {
    }
  }
  rule {
    name     = "Reputation"
    priority = 10
    override_action {
      none {
      }
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "think-meet-edge-reputation"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "CommonRulesExceptBinaryUpload"
    priority = 20
    override_action {
      none {
      }
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
        # WAF는 500 MiB 파일의 내용을 검사하지 않으므로 앱에서 코덱·PDF를 검증합니다.
        scope_down_statement {
          not_statement {
            statement {
              and_statement {
                statement {
                  byte_match_statement {
                    positional_constraint = "EXACTLY"
                    search_string         = "/api/v1/materials"
                    field_to_match {
                      uri_path {
                      }
                    }
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
                statement {
                  byte_match_statement {
                    positional_constraint = "EXACTLY"
                    search_string         = "POST"
                    field_to_match {
                      method {
                      }
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
      metric_name                = "think-meet-edge-common"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "CoarseViewerRate"
    priority = 30
    action {
      block {
      }
    }
    statement {
      rate_based_statement {
        limit              = var.edge_rate_limit
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "think-meet-edge-rate"
      sampled_requests_enabled   = false
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "think-meet-edge"
    sampled_requests_enabled   = false
  }
}
