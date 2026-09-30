#!/usr/bin/env bash
set -euo pipefail
. /etc/cashu-audit-probe.env
export UA="cashu-audit/1.0 (+https://audit.cashu.cz/methodology) frankfurt"
T=$(mktemp -d)
export T
trap 'rm -rf "$T"' EXIT

probe() {
  local id=$1 url=$2 meta code dns conn tls ttfb total exitc ok=false err=""
  meta=$(curl -s -o "$T/$id.body" --proto =https --max-redirs 0 --max-time 8 --max-filesize 1000000 \
    -H 'Accept: application/json' -A "$UA" \
    -w '%{http_code} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{exitcode}' \
    "$url/v1/info" 2>/dev/null) || true
  read -r code dns conn tls ttfb total exitc <<<"$meta"
  if [ "${code:-000}" = "200" ] && jq -e '(.nuts // .pubkey) != null' "$T/$id.body" >/dev/null 2>&1; then ok=true
  elif [ "${code:-000}" = "000" ]; then err="Connection failed (curl exit ${exitc:-?})"
  elif [ "$code" = "200" ]; then err="Not a Cashu mint info response"
  else err="HTTP $code"; fi
  jq -nc --arg id "$id" --argjson ok "$ok" --arg err "$err" --arg code "${code:-0}" \
    --arg dns "${dns:-0}" --arg conn "${conn:-0}" --arg tls "${tls:-0}" --arg ttfb "${ttfb:-0}" --arg total "${total:-0}" \
    '{id: $id, ok: $ok, error: $err, code: ($code|tonumber), dns: ($dns|tonumber), connect: ($conn|tonumber), tls: ($tls|tonumber), ttfb: ($ttfb|tonumber), total: ($total|tonumber)}' \
    > "$T/$id.json"
}
export -f probe

curl -sf --max-time 20 -H "Authorization: Bearer $PROBE_SECRET" "$API/api/probe/targets" \
  | jq -r '.mints[] | .id + " " + .url' \
  | xargs -r -P 8 -n 2 bash -c 'probe "$@"' _

shopt -s nullglob
files=("$T"/*.json)
[ ${#files[@]} -gt 0 ] || exit 0
jq -s '{results: .}' "${files[@]}" \
  | curl -sf --max-time 30 -X POST -H "Authorization: Bearer $PROBE_SECRET" -H 'Content-Type: application/json' \
      --data-binary @- "$API/api/probe/results?location=frankfurt" >/dev/null
