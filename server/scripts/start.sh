#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
python3 scripts/bootstrap.py
docker compose up -d --build --wait --wait-timeout 180
docker compose exec -T api npm run seed
mkdir -p certs
docker compose cp web:/data/caddy/pki/authorities/local/root.crt certs/think-meet-root.crt
printf '\nReady. Open PUBLIC_ORIGIN from .env. Trust certs/think-meet-root.crt on each client.\n'
