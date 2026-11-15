#!/usr/bin/env sh
# Stop all Think Meet containers; preserve volumes and unrelated projects.
set -u
cd "$(dirname "$0")/.."
command -v docker >/dev/null 2>&1 || { printf 'Docker를 찾을 수 없습니다.\n' >&2; exit 1; }
docker info >/dev/null 2>&1 || { printf 'Docker가 실행되어 있지 않습니다.\n'; exit 0; }
python3 scripts/local_stack.py || exit 1
result=0
if [ -f .loadtest/compose.yaml ]; then
  printf '가상 학생을 먼저 중지합니다.\n'
  python3 loadtest/manage.py stop || result=1
fi
printf 'API·LiveKit·웹·PostgreSQL·MinIO를 중지합니다.\n'
docker compose stop || result=1
if [ "$result" -eq 0 ]; then
  printf '\n프로젝트 컨테이너가 모두 중지되었습니다. DB·파일·인증서 볼륨과 다른 프로젝트는 보존했습니다.\n'
fi
exit "$result"
