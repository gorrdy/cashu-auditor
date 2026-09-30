#!/usr/bin/env bash
set -euo pipefail

DB=/srv/cashu-auditor/data/dev.db
ENV_FILE=/etc/cashu-auditor/env
PASS_FILE=/root/.config/cashu-audit/backup.pass
DST_DIR=/var/backups/cashu-audit
REMOTE=${CASHU_AUDIT_BACKUP_REMOTE:-gdrive:nuc-backup/cashu-audit}
RETENTION_DAYS=14
REMOTE_RETENTION=30d

[[ $EUID -eq 0 ]] || { echo "ERROR: run as root" >&2; exit 1; }
[[ -f $PASS_FILE ]] || { echo "ERROR: missing $PASS_FILE" >&2; exit 1; }

install -d -m 700 "$DST_DIR"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

TS=$(date -u +%Y%m%dT%H%M%SZ)
sqlite3 "$DB" ".backup '$WORK/dev.db'"
RESULT=$(sqlite3 "$WORK/dev.db" "PRAGMA integrity_check;")
[[ $RESULT == "ok" ]] || { echo "ERROR: integrity_check failed: $RESULT" >&2; exit 1; }
cp "$ENV_FILE" "$WORK/env"

OUT="$DST_DIR/cashu-audit-$TS.tar.gz.gpg"
tar -C "$WORK" -czf - dev.db env \
  | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASS_FILE" \
        --symmetric --cipher-algo AES256 -o "$OUT"
chmod 600 "$OUT"

find "$DST_DIR" -maxdepth 1 -name 'cashu-audit-*.tar.gz.gpg' -type f -mtime "+$RETENTION_DAYS" -delete

if rclone copy "$OUT" "$REMOTE" --quiet; then
  rclone delete "$REMOTE" --min-age "$REMOTE_RETENTION" --include 'cashu-audit-*.tar.gz.gpg' --quiet || true
  UP=uploaded
else
  UP="upload FAILED"
fi
echo "OK $(date -u +%Y-%m-%dT%H:%M:%SZ) $OUT ($(stat -c%s "$OUT") bytes, $UP)"
