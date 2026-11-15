#!/usr/bin/env sh
# Start the application and a reproducible virtual-student session.
set -eu
cd "$(dirname "$0")/.."

students=5
rebuild=false
churn=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --students) [ "$#" -ge 2 ] || { printf '학생 수를 입력해 주세요.\n' >&2; exit 2; }; students=$2; shift 2 ;;
    --build) rebuild=true; shift ;;
    --churn) churn=true; shift ;;
    -h|--help) printf '사용법: %s [학생 수] [--students 학생 수] [--churn] [--build]\n기본 학생 수: 5명 (1~100)\n--churn: 각 학생이 1분마다 50%% 확률로 퇴장하고, 1분 뒤 재입장합니다.\n' "$0"; exit 0 ;;
    *[!0-9]*|'') printf '알 수 없는 옵션입니다: %s\n' "$1" >&2; exit 2 ;;
    *) students=$1; shift ;;
  esac
done
case "$students" in ''|*[!0-9]*) printf '학생 수는 1~100의 정수여야 합니다.\n' >&2; exit 2;; esac
if [ "${#students}" -gt 3 ] || [ "$students" -lt 1 ] || [ "$students" -gt 100 ]; then
  printf '학생 수는 1~100 사이로 입력해 주세요.\n' >&2; exit 2
fi
command -v python3 >/dev/null 2>&1 || { printf 'Python 3가 필요합니다.\n' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { printf 'Docker Desktop을 설치해 주세요.\n' >&2; exit 1; }
docker info >/dev/null 2>&1 || { printf 'Docker Desktop을 먼저 실행한 뒤 다시 시도해 주세요.\n' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { printf 'Docker Compose를 사용할 수 없습니다.\n' >&2; exit 1; }
printf 'PostgreSQL·MinIO와 로컬 연결 설정을 준비합니다.\n'
python3 scripts/bootstrap.py
for image in think-meet-api think-meet-web; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then rebuild=true; fi
done
printf '수업 서버를 시작합니다.\n'
if [ "$rebuild" = true ]; then
  docker compose up -d --build --wait --wait-timeout 180
else
  docker compose up -d --wait --wait-timeout 180
fi
docker compose exec -T api npm run seed
mkdir -p certs
docker compose cp web:/data/caddy/pki/authorities/local/root.crt certs/think-meet-root.crt

printf '가상 학생 %s명을 시작합니다.\n' "$students"
set -- start --students "$students"
if [ "$churn" = true ]; then
  set -- "$@" --churn
  printf '무작위 퇴장·재입장 모드를 사용합니다 (1분 간격).\n'
fi
# Churn needs the updated worker even when an older image already exists.
if [ "$rebuild" = true ] || [ "$churn" = true ] || ! docker image inspect think-meet-virtual-student:local >/dev/null 2>&1; then
  python3 loadtest/manage.py "$@"
else
  python3 loadtest/manage.py "$@" --no-build
fi
printf '\n테스트 준비가 끝났습니다. 출력된 참여 링크에서 teacher1로 로그인하세요.\n'
printf '전체 중지: %s/stop-test.command\n' "$(pwd)"
