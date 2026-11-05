#!/usr/bin/env bash
# Usage: ./golive.sh <CA>   Run locally. Writes web/token.json (ca, launched:true, launchedAt) and uploads ONLY that file.
# Env: NO_UPLOAD=1 write the local file only (dry run) · HOST=us1 DOMAIN=rollycall.xyz
# The server re-reads token.json every 60 s. Re-render og.png afterwards if the landing shows the CA.
set -euo pipefail
cd "$(dirname "$0")"
CA="${1:-}"
[[ "$CA" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "usage: $0 0x<40 hex>"; exit 1; }
LC="$(echo "$CA" | tr 'A-F' 'a-f' | sed 's/^0X/0x/')"   # Pons lookup is lowercase; the site shows the CA as typed
HOST="${HOST:-$(cat .deploy-host 2>/dev/null || echo us1)}"; DOMAIN="${DOMAIN:-rollycall.xyz}"
[ -f web/token.json ] || { echo "web/token.json missing"; exit 1; }
BODY="$(timeout 30 curl -fsS -H "user-agent: $DOMAIN/0.1 golive" "https://ponsfamily.com/api/launches/$LC")" || { echo "Pons does not know $CA"; exit 1; }
SYM="$(printf '%s' "$BODY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s).symbol||'')))")"
[ -n "$SYM" ] || { echo "no symbol from Pons"; exit 1; }
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node - "$CA" "$SYM" "$NOW" <<'JS'
const fs = require('fs'); const [ca, sym, now] = process.argv.slice(2);
const f = 'web/token.json', t = JSON.parse(fs.readFileSync(f, 'utf8'));
const same = t.launched === true && String(t.ca).toLowerCase() === ca.toLowerCase();
t.symbol = sym; t.ca = ca; t.launched = true; t.launchedAt = same && t.launchedAt ? t.launchedAt : now;
fs.writeFileSync(f, JSON.stringify(t, null, 2) + '\n');
JS
echo "token.json written:"; cat web/token.json
if [ -z "${NO_UPLOAD:-}" ]; then
  timeout 60 rsync -az -e 'ssh -o ConnectTimeout=15 -o BatchMode=yes' web/token.json "$HOST:/opt/rollycall/repo/web/token.json"
  echo "uploaded; the server picks it up within 60 s"
fi
echo "--- post text (copy) ---"
echo "CA is live: \$$SYM"
echo "$CA"
echo "The CA is only ever posted here and on the site."
