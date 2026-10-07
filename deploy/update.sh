#!/usr/bin/env bash
# Pull the latest code, rebuild the web client and restart the server.
# Run as the "blackeye" user (the GitHub deploy workflow does this over SSH):
#   bash /opt/blackeye/app/deploy/update.sh [commit-sha] [--no-restart]
set -euo pipefail

APP=/opt/blackeye/app
REF=""
RESTART=1
for a in "$@"; do
  case "$a" in
    --no-restart) RESTART=0 ;;
    *) REF="$a" ;;
  esac
done

cd "$APP"
git fetch --quiet origin
if [[ -n "$REF" ]]; then
  git checkout --quiet --detach "$REF"
else
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  [[ "$BRANCH" == "HEAD" ]] && BRANCH=main
  git checkout --quiet "$BRANCH"
  git pull --quiet --ff-only origin "$BRANCH"
fi
echo "==> at $(git log -1 --format='%h %s')"

# the server never needs the Electron binary
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
npm ci --no-audit --no-fund
# region list / main data server for the web build, if configured (deploy/web.env)
if [[ -r "$APP/../web.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP/../web.env"
  set +a
fi
npx vite build

if [[ $RESTART -eq 1 ]]; then
  sudo /usr/bin/systemctl restart blackeye
  sleep 2
  curl -fsS "http://127.0.0.1:${PORT:-8787}/health" && echo
fi
