"""Single-entry test infrastructure contracts; no AWS credentials or resources needed."""
import json
import pathlib
import re
import unittest

INFRA = pathlib.Path(__file__).resolve().parents[1]
ROOT = INFRA / "terraform"
TEST = ROOT / "test"
DECLARATION = r'^(?:terraform|provider|data|resource|module|output|locals|variable)\b'


def resource(source, kind, name):
    match = re.search(r'^resource "' + kind + '" "' + name + r'" \{.*?(?=' + DECLARATION + r'|\Z)', source, re.M | re.S)
    if match is None:
        raise AssertionError("Missing Terraform resource: " + kind + "." + name)
    return match.group(0)


def default(variable):
    source = (TEST / "variables.tf").read_text()
    match = re.search(r'variable "' + variable + r'" \{.*?\bdefault\s*=\s*([^\n]+)', source, re.S)
    if match is None:
        raise AssertionError("Missing default for " + variable)
    return json.loads(match.group(1).strip())


class UnifiedTestProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.platform = (TEST / "platform.tf").read_text()
        cls.addons = (TEST / "addons.tf").read_text()
        cls.edge = (TEST / "edge.tf").read_text()
        cls.source = "\n".join(path.read_text() for path in TEST.glob("*.tf"))

    def test_single_entry_needs_no_other_state_or_bootstrap(self):
        for directory in ("platform", "addons", "workloads"):
            self.assertFalse((TEST / directory).exists())
        self.assertNotIn('data "terraform_remote_state"', self.source)
        self.assertNotIn('backend "s3"', self.source)
        variables = (TEST / "variables.tf").read_text()
        self.assertNotRegex(variables, r'variable "(?:platform_state_|state_bucket)')
        self.assertTrue((TEST / "terraform.tfvars").is_file())
        self.assertNotRegex((ROOT / "bootstrap/main.tf").read_text(), r'"test/(?:platform|addons|workloads)"\s*=')

    def test_aws_resources_and_server_handoff_outputs_survive_consolidation(self):
        pattern = r'^resource "(aws_[^"]+)" "([^"]+)"'
        expected = set()
        outputs = set()
        for stack in ("platform", "addons", "workloads"):
            source = (ROOT / stack / "main.tf").read_text()
            expected.update(re.findall(pattern, source, re.M))
            outputs.update(re.findall(r'^output "([^"]+)"', source, re.M))
        self.assertEqual(expected, set(re.findall(pattern, self.source, re.M)))
        self.assertFalse(outputs - set(re.findall(r'^output "([^"]+)"', self.source, re.M)))
        for relative in ("modules/irsa/main.tf", "policies/aws-load-balancer-controller-v3.6.2.json"):
            self.assertEqual((ROOT / "addons" / relative).read_bytes(), (TEST / relative).read_bytes())

    def test_fixed_steady_state_capacity(self):
        configuration = (TEST / "terraform.tfvars").read_text()
        for name in ("app_node_min", "app_node_desired", "app_node_max", "media_nodes_per_az_min",
                     "media_nodes_per_az_desired", "media_nodes_per_az_max"):
            self.assertEqual(default(name), 1)
            self.assertRegex(configuration, r'(?m)^' + name + r'\s*=\s*1\s*$')
        for name in ("app", "media"):
            block = resource(self.platform, "aws_eks_node_group", name)
            self.assertNotIn("ignore_changes", block)
        self.assertRegex(resource(self.platform, "aws_eks_node_group", "media"), r'(?m)^  count\s*=\s*1\s*$')
        self.assertEqual(default("app_instance_type"), "m7i.large")
        self.assertEqual(default("media_instance_type"), "c7i.xlarge")
        self.assertFalse(default("enable_cluster_autoscaler"))
        self.assertEqual(default("environment"), "test")
        self.assertIn('cidr_block           = "10.41.0.0/16"', self.platform)

    def test_helm_waits_for_nodes_cluster_access_and_managed_addons(self):
        for name in ("load_balancer_controller", "metrics_server", "autoscaler", "prometheus"):
            block = resource(self.addons, "helm_release", name)
            dependencies = re.search(r'depends_on\s*=\s*\[([^]]+)\]', block).group(1)
            for prerequisite in ("aws_eks_access_policy_association.admin", "aws_eks_node_group.app", "aws_eks_addon.after_nodes"):
                self.assertIn(prerequisite, dependencies)
        self.assertNotIn('provider "kubernetes"', self.source)
        self.assertNotIn('data "aws_eks_cluster"', self.source)
        self.assertIn("host                   = aws_eks_cluster.main.endpoint", self.addons)
        self.assertIn("aws_eks_cluster.main.certificate_authority[0].data", self.addons)

    def test_collector_retains_read_only_rbac_in_helm(self):
        collector = resource(self.addons, "helm_release", "prometheus")
        self.assertIn("extraManifests", collector)
        for kind in ("ClusterRole", "ClusterRoleBinding"):
            self.assertIn('"' + kind + '"', collector)
        self.assertIn('["nodes/metrics"]', collector)
        self.assertIn('["pods", "nodes"]', collector)
        for permission in ('"secrets"', '"nodes/proxy"', '"create"', '"update"', '"delete"', '"*"'):
            self.assertNotIn(permission, collector)

    def test_single_node_controllers_allow_maintenance_and_fit_cpu_budget(self):
        requested_cpu = 0
        for name in ("load_balancer_controller", "metrics_server", "autoscaler"):
            block = resource(self.addons, "helm_release", name)
            self.assertRegex(block, r'\b(?:replicaCount|replicas)\s*=\s*1\b')
            self.assertRegex(block, r'updateStrategy\s*=\s*\{\s*type\s*=\s*"Recreate"')
        metrics = resource(self.addons, "helm_release", "metrics_server")
        self.assertRegex(metrics, r'podDisruptionBudget\s*=\s*\{\s*enabled\s*=\s*true,\s*maxUnavailable\s*=\s*1\s*\}')
        for name in ("load_balancer_controller", "metrics_server", "prometheus"):
            requests = re.search(r'requests\s*=\s*\{([^}]+)\}', resource(self.addons, "helm_release", name), re.S).group(1)
            value = re.search(r'cpu\s*=\s*"([^"]+)"', requests).group(1)
            requested_cpu += float(value[:-1]) / 1000 if value.endswith("m") else float(value)
        self.assertLessEqual(requested_cpu, 2 * 0.7)

    def test_private_api_is_default_and_public_access_requires_explicit_cidrs(self):
        self.assertEqual(default("eks_public_access_cidrs"), [])
        cluster = resource(self.platform, "aws_eks_cluster", "main")
        self.assertIn("endpoint_private_access = true", cluster)
        self.assertRegex(cluster, r'endpoint_public_access\s*=\s*length\(var.eks_public_access_cidrs\) > 0')
        self.assertIn('tonumber(split("/", cidr)[1]) >= 24', (TEST / "variables.tf").read_text())

    def test_edge_waits_for_log_delivery_permissions_and_authenticates_origin(self):
        alb = resource(self.edge, "aws_lb", "application")
        self.assertIn("aws_s3_bucket_policy.logs", alb)
        self.assertNotIn('data "aws_s3_bucket"', self.edge)
        listener = resource(self.edge, "aws_lb_listener_rule", "api")
        distribution = resource(self.edge, "aws_cloudfront_distribution", "web")
        for block in (listener, distribution):
            self.assertIn('"X-Think-Meet-Origin"', block)
            self.assertIn("random_password.cloudfront_origin.result", block)
        for name in ("api", "media_gateway", "turn"):
            resource(self.edge, "aws_lb_target_group", name)
        self.assertNotIn('resource "aws_lb_target_group_attachment"', self.edge)
        self.assertTrue(default("deploy_edge"))

    def test_no_application_build_or_untracked_deployment_side_effects(self):
        self.assertTrue(all(name.startswith('aws_') or name == 'random_password' for name in re.findall(r'^resource "([^"]+)"', self.edge, re.M)))
        for forbidden in ("api_image", "local-exec", "remote-exec", "../server", "terraform_data"):
            self.assertNotIn(forbidden, self.source)
        self.assertNotIn('resource "aws_s3_bucket" "state"', self.source)

    def test_redis_credentials_are_generated_and_not_exposed_in_outputs(self):
        self.assertIsNone(default("redis_auth_tokens"))
        resource(self.platform, "random_password", "redis")
        for kind, name in (("aws_secretsmanager_secret_version", "redis"), ("aws_elasticache_replication_group", "main")):
            self.assertIn("local.redis_auth_tokens[each.key]", resource(self.platform, kind, name))
        outputs = (TEST / "outputs.tf").read_text()
        for secret in ("password.result", "redis_auth_tokens", "cloudfront_origin.result"):
            self.assertNotIn(secret, outputs)


if __name__ == "__main__":
    unittest.main()
