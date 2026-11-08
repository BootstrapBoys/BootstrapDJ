#!/usr/bin/env bash
# Isolated failover drill. Refuses to run against shared nodes or during a soak.
#
# Required:
#   CHAOS_ALLOW=1
#   ISOLATED_TEST_NODES=1
#   PM2_PRIMARY=<dedicated test primary process>
#   PM2_BACKUP=<dedicated test backup process>
#
# Do not point this at the production Lavalink processes.
set -euo pipefail

BOT_DIR="${BOT_DIR:-/root/BotTest}"
METRICS_URL="${METRICS_URL:-http://127.0.0.1:8796/api/metrics}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"

fail() {
    echo "chaos: $*" >&2
    exit 2
}

[[ "${CHAOS_ALLOW:-}" == "1" ]] || fail "set CHAOS_ALLOW=1 to acknowledge the drill"
[[ "${ISOLATED_TEST_NODES:-}" == "1" ]] || fail "set ISOLATED_TEST_NODES=1; never use shared nodes"
[[ "${PRODUCTION:-}" != "true" ]] || fail "PRODUCTION=true is forbidden"
[[ -n "${PM2_PRIMARY:-}" && -n "${PM2_BACKUP:-}" ]] ||
    fail "PM2_PRIMARY and PM2_BACKUP must name dedicated test processes"
if pgrep -f 'tooling/soak/run.mjs' >/dev/null 2>&1; then
    fail "a soak is active; wait for it to finish"
fi

cd "$BOT_DIR"
for process in "$PM2_PRIMARY" "$PM2_BACKUP" BotTest; do
    if ! pm2 describe "$process" >/dev/null 2>&1; then
        fail "pm2 process not found: $process"
    fi
done

wait_for_log() {
    local pattern="$1"
    local log=/root/.pm2/logs/BotTest-out.log
    local start="${2:-}"
    if [[ -z "$start" ]]; then
        start=$(wc -l <"$log" 2>/dev/null || echo 0)
    fi
    local deadline=$((SECONDS + TIMEOUT_SECONDS))
    while ((SECONDS < deadline)); do
        if tail -n "+$((start + 1))" "$log" 2>/dev/null | grep -aE "$pattern" | tail -1 | grep -qE "$pattern"; then
            return 0
        fi
        sleep 2
    done
    return 1
}

echo "chaos: stopping isolated primary $PM2_PRIMARY"
baseline=$(wc -l </root/.pm2/logs/BotTest-out.log 2>/dev/null || echo 0)
pm2 stop "$PM2_PRIMARY" >/dev/null
if ! wait_for_log '\[queue\] rebuilding|\[queue\] rebuilt' "$baseline"; then
    fail "no queue rebuild observed after primary loss"
fi

echo "chaos: restoring isolated primary $PM2_PRIMARY"
baseline=$(wc -l </root/.pm2/logs/BotTest-out.log 2>/dev/null || echo 0)
pm2 start "$PM2_PRIMARY" >/dev/null
if ! wait_for_log '\[queue\] rebuilt on|\[queue\] moved' "$baseline"; then
    fail "no switch-back/move observed after primary recovery"
fi

if ! curl -fsS "$METRICS_URL" >/dev/null; then
    fail "metrics endpoint unavailable after failover"
fi

echo "chaos: PASS"
