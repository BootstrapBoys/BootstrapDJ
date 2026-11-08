#!/usr/bin/env bash
# Safe staging smoke check. Read-only: never starts, stops or reconfigures the bot.
set -u

BOT_HOST="${BOT_HOST:-root@192.168.1.235}"
BOT_DIR="${BOT_DIR:-/root/BotTest}"
DASH_PORT="${DASH_PORT:-8796}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_bot}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"

ssh_opts=(-o BatchMode=yes -o ConnectTimeout=5 -i "$SSH_KEY")
fail=0

pass() { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; fail=1; }

remote() {
    ssh "${ssh_opts[@]}" "$BOT_HOST" "$1"
}

echo "== staging smoke: $BOT_HOST:$BOT_DIR =="

commit=$(remote "git -C '$BOT_DIR' rev-parse --short HEAD" 2>/dev/null || true)
if [ -n "$commit" ]; then
    pass "repo commit $commit"
    if [ -n "$EXPECTED_COMMIT" ] && [ "$commit" != "$EXPECTED_COMMIT" ]; then
        bad "expected commit $EXPECTED_COMMIT"
    fi
else
    bad "cannot read BotTest repo commit"
fi

status=$(remote "pm2 jlist" 2>/dev/null | python3 -c '
import json,sys
try:
    for p in json.load(sys.stdin):
        if p.get("name") == "BotTest":
            print(p.get("pm2_env", {}).get("status", "unknown"))
            break
except Exception:
    pass
' 2>/dev/null)
if [ "$status" = "online" ]; then pass "BotTest online"; else bad "BotTest status=${status:-unknown}"; fi

ready=$(remote "grep -a 'ready!' /root/.pm2/logs/BotTest-out.log | tail -1" 2>/dev/null || true)
if printf '%s' "$ready" | grep -q 'ready!'; then pass "BotTest reached ready"; else bad "no ready line in BotTest log"; fi

nodes=$(remote "grep -aE 'Lavalink node .* is ready|standby node .* is ready' /root/.pm2/logs/BotTest-out.log | tail -2" 2>/dev/null || true)
if printf '%s' "$nodes" | grep -q 'Lavalink node'; then pass "configured Lavalink node connected"; else bad "no Lavalink ready line"; fi

for path in / /api/guilds; do
    code=$(remote "curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:$DASH_PORT$path'" 2>/dev/null || true)
    if [ "$code" = "200" ]; then pass "dashboard $path HTTP 200"; else bad "dashboard $path HTTP ${code:-none}"; fi
done

prod=$(remote "pm2 jlist" 2>/dev/null | python3 -c '
import json,sys
try:
    names={p.get("name"):p.get("pm2_env",{}).get("status") for p in json.load(sys.stdin)}
    print("DJBoot="+str(names.get("DJBoot")), "Lavalink="+str(names.get("Lavalink")), "Backup="+str(names.get("Lavalink-Backup")))
except Exception:
    pass
' 2>/dev/null)
if [ "$prod" = "DJBoot=online Lavalink=online Backup=online" ]; then
    pass "production processes online ($prod)"
else
    bad "production process state unexpected ($prod)"
fi

errors=$(remote "tail -100 /root/.pm2/logs/BotTest-out.log | grep -aiE 'unhandled|uncaught|TokenMissing|EADDRINUSE' | tail -3" 2>/dev/null || true)
if [ -z "$errors" ]; then pass "no recent fatal patterns"; else bad "recent fatal patterns: $errors"; fi

echo
if [ "$fail" -eq 0 ]; then
    echo "RESULT: PASS"
else
    echo "RESULT: BLOCKED"
fi
exit "$fail"
