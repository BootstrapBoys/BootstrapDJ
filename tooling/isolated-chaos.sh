#!/usr/bin/env bash
# Wait for the 24h soak to finish, run an isolated failover drill, restore env.
# Safe defaults: aborts without changing BotTest if the soak summary is missing
# or failed, or if the dedicated nodes are unavailable.
set -euo pipefail

BOT_DIR="${BOT_DIR:-/root/BotTest}"
SOAK_ARTIFACT="${SOAK_ARTIFACT:-/root/BotTest/artifacts/soak/2026-11-08T20-40-53-391Z}"
SOAK_PATTERN="${SOAK_PATTERN:-tooling/soak/run.mjs}"
PRIMARY="Lavalink-Test-2443"
BACKUP="Lavalink-Test-2444"
ENV_FILE="$BOT_DIR/.env"
BACKUP_ENV="$BOT_DIR/.env.shared-nodes.$(date +%Y%m%d-%H%M%S)"
LOG="$BOT_DIR/artifacts/chaos/isolated-chaos.log"
mkdir -p "$(dirname "$LOG")"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }
fail() {
    log "ABORT: $*"
    exit 1
}

if [[ "${PRODUCTION:-}" == "true" ]]; then
    fail "PRODUCTION=true"
fi
if [[ ! -f "$ENV_FILE" ]]; then
    fail "missing $ENV_FILE"
fi

log "waiting for soak process to exit"
while pgrep -f "$SOAK_PATTERN" >/dev/null 2>&1; do
    sleep 60
done

if [[ ! -f "$SOAK_ARTIFACT/summary.json" ]]; then
    fail "soak summary missing at $SOAK_ARTIFACT"
fi
python3 - "$SOAK_ARTIFACT/summary.json" <<'PY' || fail "soak did not pass; not changing BotTest"
import json, sys
summary = json.load(open(sys.argv[1]))
print(f"soak pass={summary.get('pass')} samples={summary.get('samples')}")
if not summary.get("pass"):
    raise SystemExit(1)
PY

for port in 2443 2444; do
    [[ -f "/root/.lavalink-test-$port.pass" ]] || fail "missing password for $port"
    if ! curl -fsS -H "Authorization: $(cat "/root/.lavalink-test-$port.pass")" \
        "http://127.0.0.1:$port/v4/info" >/dev/null; then
        fail "dedicated node $port is not healthy"
    fi
done

log "backing up BotTest env to $BACKUP_ENV"
cp -p "$ENV_FILE" "$BACKUP_ENV"
chmod 600 "$BACKUP_ENV"

restore_env() {
    if [[ -f "$BACKUP_ENV" ]]; then
        cp -p "$BACKUP_ENV" "$ENV_FILE"
        chmod 600 "$ENV_FILE"
        pm2 restart BotTest >/dev/null 2>&1 || true
        log "restored shared-node env and restarted BotTest"
    fi
}
trap restore_env EXIT

python3 - "$ENV_FILE" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
passwords = {
    2443: Path("/root/.lavalink-test-2443.pass").read_text().strip(),
    2444: Path("/root/.lavalink-test-2444.pass").read_text().strip(),
}
import json
fallbacks = [{"name": "test-backup", "url": "127.0.0.1:2444", "auth": passwords[2444], "secure": False}]
values = {
    "LAVALINK_URL": "127.0.0.1:2443",
    "LAVALINK_AUTH": passwords[2443],
    "LAVALINK_NAME": "test-primary",
    "LAVALINK_SECURE": "false",
    "LAVALINK_FALLBACKS": json.dumps(fallbacks, separators=(",", ":")),
}
lines = p.read_text().splitlines()
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line else ""
    if key in values:
        out.append(f"{key}={values[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in values.items():
    if key not in seen:
        out.append(f"{key}={value}")
p.write_text("\n".join(out) + "\n")
PY
chmod 600 "$ENV_FILE"

log "restarting BotTest on isolated nodes"
pm2 restart BotTest >/dev/null
for _ in $(seq 1 45); do
    if curl -fsS http://127.0.0.1:8796/api/metrics >/dev/null 2>&1; then break; fi
    sleep 2
done
if ! curl -fsS http://127.0.0.1:8796/api/metrics >/dev/null; then
    fail "BotTest metrics unavailable on isolated nodes"
fi

log "running isolated failover drill"
CHAOS_ALLOW=1 ISOLATED_TEST_NODES=1 \
    PM2_PRIMARY="$PRIMARY" PM2_BACKUP="$BACKUP" BOT_DIR="$BOT_DIR" \
    bash "$BOT_DIR/tooling/chaos/failover.sh" | tee -a "$LOG"

log "isolated chaos PASS"
