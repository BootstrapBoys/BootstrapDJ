#!/usr/bin/env bash
# Run on the BotTest host (not production). Builds, restarts BotTest, waits for
# the metrics endpoint, runs a soak, and optionally stops the test bot.
set -euo pipefail

BOT_DIR="${BOT_DIR:-/root/BotTest}"
METRICS_URL="${SOAK_METRICS_URL:-http://127.0.0.1:8796/api/metrics}"
STOP_AFTER="${STOP_AFTER:-1}"

if [[ -z "${SOAK_GUILD_ID:-}" ]]; then
    echo "SOAK_GUILD_ID is required (test guild only)" >&2
    exit 2
fi
if [[ "${PRODUCTION:-}" == "true" ]]; then
    echo "refusing to run with PRODUCTION=true" >&2
    exit 2
fi

cd "$BOT_DIR"
npm run build
pm2 restart BotTest

ready=0
for _ in $(seq 1 30); do
    if curl -fsS "$METRICS_URL" >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 2
done
if [[ "$ready" -ne 1 ]]; then
    echo "BotTest metrics endpoint did not become ready" >&2
    exit 1
fi

status=0
node tooling/soak/run.mjs || status=$?

if [[ "$STOP_AFTER" == "1" ]]; then
    pm2 stop BotTest >/dev/null 2>&1 || true
fi
exit "$status"
