#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."

usage() {
    printf '사용법: %s [--lan | --lan-ip IP]\n' "$0"
}

use_lan=no
lan_ip=
case "${1:-}" in
    '') ;;
    --help|-h) usage; exit 0 ;;
    --lan) [ "$#" -eq 1 ] || { usage >&2; exit 2; }; use_lan=yes ;;
    --lan-ip)
        [ "$#" -eq 2 ] && [ -n "$2" ] || { usage >&2; exit 2; }
        use_lan=yes
        lan_ip=$2
        ;;
    *) usage >&2; exit 2 ;;
esac

command -v python3 >/dev/null 2>&1 || { printf 'Python 3가 필요합니다.\n' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { printf 'Docker와 Compose가 필요합니다.\n' >&2; exit 1; }
docker info >/dev/null 2>&1 || { printf 'Docker Desktop을 먼저 실행해 주세요.\n' >&2; exit 1; }

if [ "$use_lan" = yes ]; then
    lan_ip=$(PYTHONPATH=scripts python3 - "$lan_ip" <<'PY'
from ipaddress import IPv4Address
import sys
from local_stack import detect_lan_ip

try:
    print(IPv4Address(sys.argv[1] or detect_lan_ip()))
except (OSError, ValueError):
    sys.exit('LAN IPv4 주소를 확인할 수 없습니다. --lan-ip에 사용할 주소를 지정하세요.')
PY
    )
    LAN_IP="$lan_ip" python3 scripts/bootstrap.py
    THINK_MEET_LAN_AUTHORITY=$(PYTHONPATH=scripts python3 - "$lan_ip" <<'PY'
import os
import sys
from local_stack import read_env

port = os.environ.get('HTTPS_PORT', read_env().get('HTTPS_PORT')) or '443'
print(sys.argv[1] if port == '443' else f'{sys.argv[1]}:{port}')
PY
    )
    export THINK_MEET_LAN_IP="$lan_ip" THINK_MEET_LAN_AUTHORITY
    export COMPOSE_FILE=compose.yaml:compose.lan.yaml
    public_origin="https://$THINK_MEET_LAN_AUTHORITY"
else
    python3 scripts/bootstrap.py
    public_origin=$(PYTHONPATH=scripts python3 -c 'from local_stack import read_env; print(read_env()["PUBLIC_ORIGIN"])')
fi

docker compose up -d --build --wait --wait-timeout 180
docker compose exec -T api npm run seed
mkdir -p certs
docker compose cp web:/data/caddy/pki/authorities/local/root.crt certs/think-meet-root.crt
printf '\nThink Meet: %s\n공개 CA: certs/think-meet-root.crt\n' "$public_origin"
