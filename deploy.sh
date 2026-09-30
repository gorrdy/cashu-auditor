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
sudo systemctl restart cashu-auditor
systemctl --no-pager --lines=0 status cashu-auditor
