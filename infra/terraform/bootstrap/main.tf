terraform {
  required_version = ">= 1.5.7, < 2.0"
  required_providers {
    aws = {
      source = "hashicorp/aws", version = "~> 6.0"
    }
    local = {
      source = "hashicorp/local", version = "~> 2.0"
    }
  }
}
provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project = "think-meet", ManagedBy = "Terraform", Purpose = "remote-state"
    }
  }
}
variable "region" {
  type    = string
  default = "ap-northeast-2"
}
variable "state_bucket_name" {
  description = "전 세계에서 중복되지 않는 비공개 버킷 이름입니다."
  type        = string
}
resource "aws_kms_key" "state" {
  description             = "Think Meet Terraform state encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  lifecycle {
    prevent_destroy = true
  }
}
resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name
  lifecycle {
    prevent_destroy = true
  }
}
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
    bucket_key_enabled = true
  }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
data "aws_iam_policy_document" "state" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
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
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json
}
# 설치된 Terraform 1.5.7과 호환되도록 DynamoDB 잠금을 사용합니다.
# 모든 운영자가 Terraform 1.10 이상을 사용하면 검토 후 S3 use_lockfile로 전환합니다.
resource "aws_dynamodb_table" "lock" {
  name         = "${var.state_bucket_name}-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.state.arn
  }
  point_in_time_recovery {
    enabled = true
  }
  lifecycle {
    prevent_destroy = true
  }
}

# 실제 bootstrap 리소스 값으로 각 계층의 backend 설정을 생성합니다.
# 운영의 분리된 스택에만 적용합니다. 단일 테스트 구성은 이 bootstrap에 의존하지 않습니다.
locals {
  backend_keys = {
    "platform"  = "think-meet/prod/platform.tfstate"
    "addons"    = "think-meet/prod/addons.tfstate"
    "workloads" = "think-meet/prod/workloads.tfstate"
  }
}
resource "local_file" "backend" {
  for_each        = local.backend_keys
  filename        = "${path.module}/../${each.key}/backend.hcl"
  file_permission = "0600"
  content         = <<-HCL
    bucket         = ${jsonencode(aws_s3_bucket.state.id)}
    key            = ${jsonencode(each.value)}
    region         = ${jsonencode(var.region)}
    encrypt        = true
    kms_key_id     = ${jsonencode(aws_kms_key.state.arn)}
    dynamodb_table = ${jsonencode(aws_dynamodb_table.lock.name)}
  HCL
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}
output "lock_table" {
  value = aws_dynamodb_table.lock.name
}
output "state_kms_key_arn" {
  value = aws_kms_key.state.arn
}
