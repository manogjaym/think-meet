#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
command -v python3 >/dev/null 2>&1 || { printf 'Python 3가 필요합니다.\n' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { printf 'Docker와 Compose가 필요합니다.\n' >&2; exit 1; }
docker info >/dev/null 2>&1 || { printf 'Docker Desktop을 먼저 실행해 주세요.\n' >&2; exit 1; }
python3 scripts/bootstrap.py
docker compose up -d --build --wait --wait-timeout 180
docker compose exec -T api npm run seed
mkdir -p certs
docker compose cp web:/data/caddy/pki/authorities/local/root.crt certs/think-meet-root.crt
printf '\nReady. Open PUBLIC_ORIGIN from .env. Trust certs/think-meet-root.crt on each client.\n'
