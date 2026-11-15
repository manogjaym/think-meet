#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
python3 scripts/local_stack.py
if [ -f .loadtest/compose.yaml ]; then
  python3 loadtest/manage.py stop
fi
docker compose stop
