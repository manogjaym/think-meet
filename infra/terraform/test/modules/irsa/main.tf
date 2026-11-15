terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "name" { type = string }
variable "oidc_provider_arn" { type = string }
variable "oidc_issuer_url" { type = string }
variable "namespace" { type = string }
variable "service_account" { type = string }
variable "policy_json" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}

locals {
  issuer = trimprefix(var.oidc_issuer_url, "https://")
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.issuer}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.issuer}:sub"
      values   = ["system:serviceaccount:${var.namespace}:${var.service_account}"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.name
  assume_role_policy = data.aws_iam_policy_document.trust.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "this" {
  name   = "controller-permissions"
  role   = aws_iam_role.this.id
  policy = var.policy_json
}

output "role_arn" {
  value      = aws_iam_role.this.arn
  depends_on = [aws_iam_role_policy.this]
}
