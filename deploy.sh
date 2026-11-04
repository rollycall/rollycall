#!/usr/bin/env bash
# Deploy Rollycall: rsync ONLY this repo dir -> us1:/opt/rollycall/repo -> npm ci + web build on the server -> systemd -> nginx -> certbot (first time).
# Env: HOST=us1 PORT=4830 DOMAIN=rollycall.xyz CERTBOT_EMAIL=<email for the first certificate>
#      SEED=db      upload a WAL-safe snapshot of local state/rollycall.db as the starting index (first deploy)
#      SEED=remote  run the full crawl on the server instead (about an hour)
#      SKIP_SMOKE=1
# Run by the lead after user confirmation. DNS A for $DOMAIN and www must already point at the server.
set -euo pipefail
cd "$(dirname "$0")"
HOST="${HOST:-$(cat .deploy-host 2>/dev/null || echo us1)}"; PORT="${PORT:-4830}"; DOMAIN="${DOMAIN:-rollycall.xyz}"
APP=/opt/rollycall
SSH="timeout 600 ssh -o ConnectTimeout=15 -o BatchMode=yes $HOST"
SSHO="ssh -o ConnectTimeout=15 -o BatchMode=yes"

# 1. tests
npm test >/dev/null 2>&1 || { echo "ABORT: tests fail (run npm test)"; exit 1; }

# 2. token.json guard: pre-launch means zero CA, no hour or time fields; post-launch needs a real CA and the wallet
node - <<'JS' || exit 1
const t = JSON.parse(require('fs').readFileSync('web/token.json', 'utf8'));
const bad = [];
const zero = /^0x0{40}$/.test(t.ca || '');
if (t.launched && zero) bad.push('launched:true but ca is zero');
if (!t.launched && !zero) bad.push('launched:false but ca is set');
if (t.launched && !/^0x[0-9a-fA-F]{40}$/.test(t.teamWallet || '')) bad.push('post-launch needs teamWallet');
if (t.launched && !(Number(t.minHold) > 0)) bad.push('post-launch needs minHold');
if (t.tickerPublic && !t.symbol) bad.push('tickerPublic:true but symbol empty');
if (t.launchDate && !/^\d{4}-\d{2}-\d{2}$/.test(t.launchDate)) bad.push('launchDate must be date only (no hour)');
for (const k of Object.keys(t)) if (/time|hour|countdown|at$/i.test(k) && !(k === 'launchedAt' && t.launched)) bad.push('forbidden field: ' + k);
if (bad.length) { console.error('ABORT: web/token.json: ' + bad.join('; ')); process.exit(1); }
JS

# 3. copy rules for user-facing files
if grep -rInE '\bWIB\b|\b(soon|coming)\b' --include=*.mjs --include=*.js --include=*.html --include=*.css --include=*.json --include=*.txt \
     server/src shared web/src web/token.json mcp/index.mjs README.md 2>/dev/null | grep -v '/test/' ; then echo "ABORT: banned word in user-facing files (above)"; exit 1; fi

# 4. deploy files
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
for f in rollycall.service rollycall-cycle.service rollycall-cycle.timer nginx-rollycall.conf nginx-rollycall-http.conf rollycall-headers.conf rollycall-zones.conf; do
  sed -e "s/__PORT__/$PORT/g" -e "s/__DOMAIN__/$DOMAIN/g" "deploy/$f" > "$TMP/$f"; done
if [ "${SEED:-}" = db ]; then node scripts/snapshot-db.mjs state/rollycall.db "$TMP/rollycall.db"; fi

# 5. sync (only this directory)
$SSH "mkdir -p $APP/repo $APP/state"
rsync -az --delete -e "$SSHO" --exclude .git --exclude node_modules --exclude state --exclude web/dist --exclude 'mcp/node_modules' \
  --exclude '*.log' --exclude '.env*' --exclude 'wallet*' --exclude 'WALLETS*' ./ "$HOST:$APP/repo/"
scp -q -o ConnectTimeout=15 "$TMP"/* "$HOST:/tmp/"

$SSH "DOMAIN=$DOMAIN PORT=$PORT SEED='${SEED:-}' CERTBOT_EMAIL='${CERTBOT_EMAIL:-}' bash -s" <<'REMOTE'
set -euo pipefail
APP=/opt/rollycall
if ! systemctl is-active --quiet rollycall && ss -ltnp | grep -q ":$PORT "; then echo "ABORT: port $PORT in use"; ss -ltnp | grep ":$PORT "; exit 1; fi
id rollycall >/dev/null 2>&1 || useradd --system --home-dir $APP --shell /usr/sbin/nologin rollycall
cd $APP/repo
npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -2
node scripts/build-web.mjs
if [ "$SEED" = db ]; then install -m 0644 -o rollycall -g rollycall /tmp/rollycall.db $APP/state/rollycall.db; rm -f $APP/state/rollycall.db-wal $APP/state/rollycall.db-shm; fi
chown -R rollycall:rollycall $APP/state; chmod -R a+rX $APP/repo
install -m 0644 /tmp/rollycall-headers.conf /etc/nginx/snippets/rollycall-headers.conf
install -m 0644 /tmp/rollycall-zones.conf /etc/nginx/conf.d/rollycall-zones.conf
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  # first time: HTTP-only site, then certbot (webroot), then the full site
  install -m 0644 /tmp/nginx-rollycall-http.conf /etc/nginx/sites-available/rollycall
  ln -sf /etc/nginx/sites-available/rollycall /etc/nginx/sites-enabled/rollycall
  mkdir -p /var/www/html; nginx -t && systemctl reload nginx
  EM="--register-unsafely-without-email"; [ -n "$CERTBOT_EMAIL" ] && EM="-m $CERTBOT_EMAIL"
  timeout 300 certbot certonly --webroot -w /var/www/html -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos $EM
fi
install -m 0644 /tmp/rollycall.service /etc/systemd/system/rollycall.service
install -m 0644 /tmp/rollycall-cycle.service /etc/systemd/system/rollycall-cycle.service
install -m 0644 /tmp/rollycall-cycle.timer /etc/systemd/system/rollycall-cycle.timer
systemctl daemon-reload; systemctl enable rollycall >/dev/null 2>&1; systemctl restart rollycall
systemctl enable --now rollycall-cycle.timer >/dev/null 2>&1
install -m 0644 /tmp/nginx-rollycall.conf /etc/nginx/sites-available/rollycall
ln -sf /etc/nginx/sites-available/rollycall /etc/nginx/sites-enabled/rollycall
rm -f /tmp/rollycall* /tmp/nginx-rollycall*
nginx -t && systemctl reload nginx
if [ "$SEED" = remote ]; then
  systemd-run --unit=rollycall-seed --uid=rollycall --property=WorkingDirectory=$APP/repo --setenv=STATE_DIR=$APP/state /usr/bin/node scripts/index.mjs
  echo "full crawl running as unit rollycall-seed (journalctl -u rollycall-seed -f)"
fi
for i in $(seq 1 30); do curl -fsS "127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 2; done
systemctl is-active rollycall; curl -fsS "127.0.0.1:$PORT/api/health"; echo
node scripts/og.mjs "http://127.0.0.1:$PORT/api/stats" web/dist || echo "og skipped"
REMOTE

# 6. smoke
if [ -z "${SKIP_SMOKE:-}" ]; then
  timeout 30 curl -fsS "https://$DOMAIN/api/health" >/dev/null && echo "health OK"
  timeout 30 curl -fsS "https://$DOMAIN/api/stats" && echo
  timeout 30 curl -fsS -o /dev/null "https://$DOMAIN/dist/app.css" && echo "assets OK"
fi
echo "deploy done -> https://$DOMAIN"
