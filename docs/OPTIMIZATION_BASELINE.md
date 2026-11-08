# Optimization Baseline

Captured: 2026-11-08
Branch: `experimental/rewrite`
Baseline commit: `a92b636`
Baseline tag: `optimization-baseline-a92b636`

## Static gates

- `npm run build`: pass
- `npm run lint`: 0 warnings / 0 errors
- `npx tsc --noEmit -p tsconfig.json`: pass
- `npm test`: **209/209**
- `git diff --check`: clean
- `npm audit --omit=dev`: **0 vulnerabilities**
- TODO/FIXME/type-escape/silent-catch marker scan: **0**

## Coverage

`node --test --experimental-test-coverage`:

- Line coverage: **67.64%**
- Branch coverage: **61.48%**
- Function coverage: **87.00%**

Coverage is lowest around lifecycle/error paths; the optimization plan targets
those with characterization tests before refactoring.

## Provenance audit

`node tooling/rewrite-audit.mjs <upstream-src>`:

- same-basename files: **84**
- raw shared-line floor: **1,821**
- substantive shared lines (>=40 chars, excluding imports/braces/comments/type
  shells): **184 across 54 files**

## Runtime baseline

BotTest: `BootstrapDJ-DEV#7138`
Production: `DJBoot` online, both Lavalink nodes online, untouched.

Measurements still to capture during Phase 0/3:

- time to Discord ready
- time to Lavalink ready
- RSS after 1h / 6h / 24h
- command latency: ping, play search, queue render, playlist load
- listener/collector and timer counts after repeated cycles
- log volume at debug level

## Notes

The baseline is intentionally the final rewrite checkpoint, not production.
Production remains the stable reference for behavior comparisons.
