#!/usr/bin/env bash
# Read-only gate for the dashboard audio tap. Run on the bot host.
#
#   GUILD_ID=<id> DASHBOARD_TOKEN=<token> tooling/audio-tap-smoke.sh
#   GUILD_ID=<id> DASHBOARD_COOKIE='bdj_session=...' tooling/audio-tap-smoke.sh
#
# Never pass the tap token here; the dashboard holds it server-side.
set -euo pipefail

BASE="${DASHBOARD_BASE:-http://127.0.0.1:8795}"
GUILD_ID="${GUILD_ID:?set GUILD_ID to a guild with an active player}"

CURL_AUTH=()
if [[ -n "${DASHBOARD_TOKEN:-}" ]]; then
    CURL_AUTH+=(-H "x-dashboard-token: ${DASHBOARD_TOKEN}")
fi
if [[ -n "${DASHBOARD_COOKIE:-}" ]]; then
    CURL_AUTH+=(-H "Cookie: ${DASHBOARD_COOKIE}")
fi

fail=0
ok() { printf 'ok   %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; fail=1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# 1. The dashboard advertises the tap on state.
if curl -fsS --max-time 10 "${CURL_AUTH[@]}" \
    "${BASE}/api/state?guildId=${GUILD_ID}" > "$work/state.json"; then
    if grep -q '"available":true' "$work/state.json"; then
        ok "state reports audio.available"
    else
        bad "state does not report audio.available (is DASHBOARD_TAP_URL/TOKEN set?)"
    fi
else
    bad "GET /api/state failed (auth or dashboard down)"
fi

# 2. Served page carries the client pieces.
if curl -fsS --max-time 10 "${CURL_AUTH[@]}" "${BASE}/" > "$work/index.html"; then
    for needle in 'id="listen-btn"' 'AudioDecoder' '__bdjAudio'; do
        if grep -qF "$needle" "$work/index.html"; then
            ok "page contains ${needle}"
        else
            bad "page missing ${needle}"
        fi
    done
    if [[ -n "${DASHBOARD_TOKEN:-}" ]] && grep -qF "$DASHBOARD_TOKEN" "$work/index.html"; then
        bad "dashboard token leaked into the HTML"
    fi
else
    bad "GET / failed"
fi

# 3. The audio route streams bytes. A paused player still sends hello/ping
# control frames, so any non-empty body with a 200 is enough here.
set +e
curl -sS --max-time 4 "${CURL_AUTH[@]}" -D "$work/audio.headers" \
    -o "$work/audio.bin" "${BASE}/api/audio?guildId=${GUILD_ID}"
curl_status=$?
set -e

if [[ $curl_status -ne 0 && $curl_status -ne 28 ]]; then
    bad "GET /api/audio failed with curl exit ${curl_status}"
elif ! head -n 1 "$work/audio.headers" | grep -q ' 200'; then
    bad "GET /api/audio status: $(head -n 1 "$work/audio.headers")"
elif [[ ! -s "$work/audio.bin" ]]; then
    bad "GET /api/audio returned an empty body"
else
    first_byte="$(od -An -tu1 -N1 "$work/audio.bin" | tr -d ' ')"
    if [[ "$first_byte" == "1" || "$first_byte" == "2" ]]; then
        ok "GET /api/audio streamed $(wc -c < "$work/audio.bin") bytes (first frame type ${first_byte})"
    else
        bad "GET /api/audio first byte ${first_byte} is not a tap frame"
    fi
fi

# 4. Mute must not be a player action.
if grep -R "mute" src/dashboard/browser.ts | grep -q "playerAction"; then
    bad "browser mute is wired to a player action"
else
    ok "mute is not wired to a player action"
fi

if [[ $fail -ne 0 ]]; then
    printf '\naudio tap smoke: FAILED\n' >&2
    exit 1
fi
printf '\naudio tap smoke: PASSED\n'
