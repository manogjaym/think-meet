#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export THINK_MEET_LAN_IP=${THINK_MEET_LAN_IP:-$(ipconfig getifaddr en0)}
cd "$SCRIPT_DIR/../../server"
docker compose -f compose.yaml -f "$SCRIPT_DIR/compose.local.yml" up -d
printf '\nThink Meet: https://%s\n' "$THINK_MEET_LAN_IP"
