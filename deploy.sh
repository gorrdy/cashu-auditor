#!/usr/bin/env bash
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
APP=/srv/cashu-auditor/app
NODE_BIN=/opt/node-v24.21.0/bin

sudo rsync -a --delete \
  --exclude .git --exclude node_modules --exclude .next --exclude lib/generated \
  --exclude '.env*' --exclude 'prisma/*.db*' --exclude tsconfig.tsbuildinfo \
  "$SRC/" "$APP/"
sudo chown -R cashu-audit:cashu-audit "$APP"

sudo -u cashu-audit env -i HOME=/srv/cashu-auditor PATH="$NODE_BIN:/usr/bin:/bin" bash -c "
  set -euo pipefail
  set -a; . /etc/cashu-auditor/env; set +a
  cd $APP
  npm ci --no-audit --no-fund
  npx prisma generate
  npx prisma db push
  npx next build
  mkdir -p .next/cache
"
AUTH="$HOME/.config/cashu-audit/cron-auth"
STATUS="http://$(sudo grep -oP '^BIND_HOST=\K.+' /etc/cashu-auditor/env):$(sudo grep -oP '^PORT=\K.+' /etc/cashu-auditor/env)/api/status"
for _ in $(seq 1 60); do
  holder=$(curl -s --max-time 5 -H @"$AUTH" "$STATUS" | sed -n 's/.*"wallet":\("[^"]*"\|null\).*/\1/p')
  [ -z "$holder" ] || [ "$holder" = "null" ] && break
  echo "waiting for wallet operation $holder to finish"
  sleep 3
done
sudo systemctl restart cashu-auditor
systemctl --no-pager --lines=0 status cashu-auditor
