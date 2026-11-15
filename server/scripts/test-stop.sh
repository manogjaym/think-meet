#!/usr/bin/env sh
# Stop only Think Meet's workers and application containers; preserve shared services/data.
set -u
cd "$(dirname "$0")/.."
command -v docker >/dev/null 2>&1 || { printf 'Docker를 찾을 수 없습니다.\n' >&2; exit 1; }
docker info >/dev/null 2>&1 || { printf 'Docker가 실행되어 있지 않습니다.\n'; exit 0; }
result=0
if [ -f .loadtest/compose.yaml ]; then
  printf '가상 학생을 먼저 중지합니다.\n'
  docker compose --project-directory . -f .loadtest/compose.yaml stop || result=1
fi
printf 'API·LiveKit·웹 서버를 중지합니다.\n'
docker compose stop || result=1
if [ "$result" -eq 0 ]; then
  printf '\n프로젝트 컨테이너가 모두 중지되었습니다. DB·파일·인증서와 기존 PostgreSQL·MinIO는 보존했습니다.\n'
fi
exit "$result"
