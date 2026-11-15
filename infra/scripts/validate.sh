#!/usr/bin/env bash
# 로컬 검증만 수행하며 plan/apply나 서비스 시작은 실행하지 않습니다.
set -euo pipefail
infra_dir="$(cd "$(dirname "$0")/.." && pwd)"
initialize=false
for argument in "$@"; do
  case "$argument" in
    --init) initialize=true ;;
    --help|-h)
      printf 'Usage: %s [--init]\n' "$0"
      printf 'Run Python/contract tests, shell syntax, and Terraform fmt/validate for production and test stacks.\n'
      printf '%s\n' '--init explicitly permits provider downloads with backend initialization disabled.'
      exit 0
      ;;
    *) printf 'Unknown argument: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

command -v python3 >/dev/null || { printf 'python3 is required.\n' >&2; exit 1; }
command -v terraform >/dev/null || { printf 'terraform is required.\n' >&2; exit 1; }
command -v rg >/dev/null || { printf 'ripgrep is required.\n' >&2; exit 1; }

# AST를 한 번만 파싱하고 메모리에서 컴파일해 __pycache__를 만들지 않습니다.
python3 -B - "$infra_dir" <<'PY'
import ast
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
for directory in (root / "scripts", root / "tests"):
    for path in sorted(directory.rglob("*.py")):
        source = path.read_text()
        tree = ast.parse(source, filename=str(path))
        compile(tree, str(path), "exec")
print("Python syntax: passed")
PY

while IFS= read -r -d '' script; do
  bash -n "$script"
done < <(rg --files -0 "$infra_dir/scripts" -g '*.sh' -g '*.sh.tftpl')
printf 'Shell syntax: passed\n'

PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s "$infra_dir/tests" -p 'test_*.py' -v

# 전체 트리의 형식을 한 번만 검사합니다.
terraform -chdir="$infra_dir/terraform" fmt -check -recursive

# 검증용 초기화는 공급자 캐시를 공유하고 종료 시 임시 데이터와 함께 정리합니다.
if "$initialize"; then
  validation_dir="$(mktemp -d "${TMPDIR:-/tmp}/think-meet-terraform-check.XXXXXX")"
  trap 'rm -rf "$validation_dir"' EXIT
  provider_cache="${TF_PLUGIN_CACHE_DIR:-$validation_dir/providers}"
  mkdir -p "$provider_cache"
fi

for stack in bootstrap platform addons workloads test; do
  stack_dir="$infra_dir/terraform/$stack"
  printf '\nChecking Terraform stack: %s\n' "$stack"
  if "$initialize"; then
    stack_data="$validation_dir/$stack"
    TF_DATA_DIR="$stack_data" TF_PLUGIN_CACHE_DIR="$provider_cache" \
      terraform -chdir="$stack_dir" init -backend=false -input=false -lockfile=readonly -no-color
    TF_DATA_DIR="$stack_data" terraform -chdir="$stack_dir" validate -no-color
  elif [[ ! -d "$stack_dir/.terraform/providers" ]]; then
    printf 'Providers are missing for %s. Run this script with --init to download them.\n' "$stack" >&2
    exit 1
  else
    terraform -chdir="$stack_dir" validate -no-color
  fi
done
printf '\nAll local infrastructure checks passed. No AWS resources were created or changed.\n'
