#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export THINK_MEET_LAN_IP=${THINK_MEET_LAN_IP:-$(python3 -c 'import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(("192.0.2.1",80)); print(s.getsockname()[0]); s.close()')}
cd "$SCRIPT_DIR/../../infra/local"
export COMPOSE_FILE="compose.yaml:compose.lan.yaml"
./scripts/start.sh
printf '\nThink Meet: https://%s\n' "$THINK_MEET_LAN_IP"
