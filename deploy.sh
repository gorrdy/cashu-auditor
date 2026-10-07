#!/usr/bin/env bash
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN=/opt/node-v24.21.0/bin
TARGET="${1:-dev}"

case "$TARGET" in
  prod) BASE=/srv/cashu-auditor; ENV_FILE=/etc/cashu-auditor/env; SERVICE=cashu-auditor; AUTH="$HOME/.config/cashu-audit/cron-auth" ;;
  dev) BASE=/srv/cashu-auditor-dev; ENV_FILE=/etc/cashu-auditor/dev.env; SERVICE=cashu-auditor-dev; AUTH="$HOME/.config/cashu-audit/cron-auth-dev" ;;
  *) echo "usage: $0 [dev|prod]" >&2; exit 2 ;;
esac
APP="$BASE/app"
echo "Deploying to $TARGET ($SERVICE)"

sudo rsync -a --delete \
  --exclude .git --exclude node_modules --exclude .next --exclude lib/generated \
  --exclude '.env*' --exclude 'prisma/*.db*' --exclude tsconfig.tsbuildinfo \
  "$SRC/" "$APP/"
sudo chown -R cashu-audit:cashu-audit "$APP"

sudo -u cashu-audit env -i HOME="$BASE" PATH="$NODE_BIN:/usr/bin:/bin" bash -c "
  set -euo pipefail
  set -a; . $ENV_FILE; set +a
  cd $APP
  npm ci --no-audit --no-fund
  npx prisma generate
  npx prisma db push
  npx next build
  mkdir -p .next/cache
"
STATUS="http://$(sudo grep -oP '^BIND_HOST=\K.+' "$ENV_FILE"):$(sudo grep -oP '^PORT=\K.+' "$ENV_FILE")/api/status"
for _ in $(seq 1 60); do
  holder=$(curl -s --max-time 5 -H @"$AUTH" "$STATUS" | sed -n 's/.*"wallet":\("[^"]*"\|null\).*/\1/p' || true)
  [ -z "$holder" ] || [ "$holder" = "null" ] && break
  echo "waiting for wallet operation $holder to finish"
  sleep 3
done
sudo systemctl restart "$SERVICE"
for _ in $(seq 1 30); do curl -sf -o /dev/null "${STATUS%/api/status}/methodology" && break; sleep 1; done
BASE_URL="${STATUS%/api/status}" "$NODE_BIN/node" "$SRC/scripts/smoke.mjs" || echo "SMOKE TESTS FAILED"
systemctl --no-pager --lines=0 status "$SERVICE"
