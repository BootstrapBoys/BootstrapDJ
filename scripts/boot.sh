#!/usr/bin/env bash
# Smart launcher: pull, then run only the steps whose inputs actually changed.
#
#   plan only:  PLAN_ONLY=1 bash scripts/boot.sh
#   normal:     bash scripts/boot.sh   (execs node dist/index.js at the end)
#
# Decisions are keyed on hashes, not timestamps:
#   package-lock.json → npm ci (only when the lockfile or node version changed)
#   prisma/schema.prisma → prisma generate + db push
#   src/*.ts newer than dist/index.js → tsc build
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR" || exit 1

STATE_FILE=".boot-state"
PLAN_ONLY="${PLAN_ONLY:-0}"

log() { printf '[boot] %s\n' "$*"; }

run() {
    if [ "$PLAN_ONLY" = "1" ]; then
        log "would run: $*"
    else
        log "run: $*"
        "$@" || {
            log "FAILED: $*"
            exit 1
        }
    fi
}

state_get() {
    [ -f "$STATE_FILE" ] && sed -n "s/^$1=//p" "$STATE_FILE" | head -1
}

sha() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }

# 1. Update the tree.
BEFORE=$(git rev-parse HEAD 2>/dev/null || echo none)
if git pull --ff-only --quiet; then
    AFTER=$(git rev-parse HEAD 2>/dev/null || echo none)
else
    AFTER=$BEFORE
    # A pull that fails because tracked files are dirty must not fall through
    # to "start whatever is here": that silently runs the previous build.
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
        log "git pull failed and tracked files have local changes — refusing to start stale code"
        git status --porcelain --untracked-files=no | sed -n '1,5p' | while read -r line; do log "  $line"; done
        exit 1
    fi
    log "git pull failed (network?) — continuing with the current tree"
fi
if [ "$BEFORE" != "$AFTER" ]; then
    log "updated ${BEFORE:0:7} -> ${AFTER:0:7}"
else
    log "no new commits"
fi

LOCK_HASH=$(sha package-lock.json)
SCHEMA_HASH=$(sha prisma/schema.prisma)
NODE_V=$(node -v 2>/dev/null || echo missing)
BUILD_STAMP="dist/index.js"

# 2. Install only when the lockfile, node version or node_modules changed.
NEED_INSTALL=0
[ -d node_modules ] || NEED_INSTALL=1
[ "$(state_get lock)" = "$LOCK_HASH" ] || NEED_INSTALL=1
[ "$(state_get node)" = "$NODE_V" ] || NEED_INSTALL=1

if [ "$NEED_INSTALL" = "1" ]; then
    run npm ci
else
    log "dependencies unchanged — skipping npm ci"
fi

# 3. Regenerate the client and sync the schema only when the schema changed.
#    npm ci already ran prisma generate through postinstall.
if [ "$(state_get schema)" != "$SCHEMA_HASH" ]; then
    [ "$NEED_INSTALL" = "1" ] || run npx prisma generate
    run npx prisma db push
else
    log "schema unchanged — skipping prisma generate/db push"
fi

# 4. Build when dist is missing or any source is newer than the build.
NEED_BUILD=0
[ -f "$BUILD_STAMP" ] || NEED_BUILD=1
if [ "$NEED_BUILD" = "0" ] && [ -n "$(find src -name '*.ts' -newer "$BUILD_STAMP" -print -quit 2>/dev/null)" ]; then
    NEED_BUILD=1
fi

if [ "$NEED_BUILD" = "1" ]; then
    run npm run build
else
    log "dist up to date — skipping build"
fi

if [ "$PLAN_ONLY" = "1" ]; then
    log "would start: node dist/index.js"
    exit 0
fi

cat >"$STATE_FILE" <<EOF
lock=$LOCK_HASH
schema=$SCHEMA_HASH
node=$NODE_V
commit=$AFTER
booted=$(date -Is)
EOF

log "starting the bot"
exec node dist/index.js
