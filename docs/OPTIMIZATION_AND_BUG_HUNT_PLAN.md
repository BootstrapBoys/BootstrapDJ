# Optimization and Bug-Hunt Plan

Target: `experimental/rewrite` (code checkpoint `1d5bcff`, docs `a92b636`)
Baseline: 209 tests, build/lint/tsc clean, staging matrix passed
Production: `DJBoot` remains the reference deployment and must stay untouched

## Goals

- Find correctness bugs, races, leaks, and silent failure paths.
- Reduce unnecessary complexity and duplicate logic introduced by the rewrite.
- Improve startup, command latency, queue operations, memory use, and DB access.
- Preserve behavior and public APIs unless a bug fix requires a deliberate change.
- Produce a ranked issue list with evidence and regression tests.

## Non-Goals

- New user-facing features.
- Schema/package changes without explicit approval.
- Production deployment during the audit.
- Rewriting every file again; optimize what the rewrite produced.

## Metrics to Capture

Record before/after for:

- startup to Discord ready and Lavalink ready
- command latency: ping, play search, queue render, playlist load
- memory RSS after 1h / 6h / 24h
- DB query count for queue/session operations
- event listener/collector counts after 100 track changes
- timer counts after pause/destroy/restart cycles
- log volume and error/warn counts
- crash/restart count during soak
- audit overlap and test coverage

## Severity and Triage

| Level | Meaning | Action |
|---|---|---|
| P0 | crash, data loss, security bypass, production outage | stop and fix immediately |
| P1 | playback stops, queue corruption, auth failure, persistent leak | fix before merge |
| P2 | wrong reply/state, recoverable error, noisy logs | fix in batch |
| P3 | cleanup, naming, minor perf | schedule |

Rules:
- One bug per commit.
- Add a regression test before/with the fix.
- If behavior is ambiguous, preserve current behavior and file a question.
- Do not “fix” by adding casts or ignoring errors.

## Phase 0 — Freeze and Instrument

- Tag the audit baseline: `optimization-baseline-a92b636`.
- Back up BotTest DB and `.env`.
- Capture baseline metrics (above) on BotTest.
- Enable coverage:
  `node --test --experimental-test-coverage`
- Record current audit:
  `node tooling/rewrite-audit.mjs <upstream-src>`
- Capture `pm2` memory/CPU and log sizes before testing.

Deliverable: `docs/OPTIMIZATION_BASELINE.md`.

## Phase 1 — Static and Structural Audit

Run:
- `tsc --noEmit`
- `oxlint --type-aware --type-check --deny-warnings`
- `knip` / `ts-prune` (dev-only, no package change) for unused exports/files
- `madge --circular src` for cycles
- `npm audit --omit=dev`
- `git grep` for `TODO`, `FIXME`, `@ts-`, `as any`, `console.log`, `catch {}` and
  silent catches
- `git grep` for timers/listeners/collectors without cleanup

Review:
- duplicate helpers between `lib`, `core/player`, and command folders
- unused config keys and env aliases (`BOT_TOKEN`/`DISCORD_TOKEN`/`TOKEN`)
- dead compatibility exports and old path shims
- overly broad catches that hide failures
- import cycles between core, data, dashboard, and plugins
- dependency versions and known CVEs

Deliverable: ranked static issue list; no behavior changes.

## Phase 2 — Domain Bug Hunt

### Startup and client
- Boot before Lavalink ready; retries and watchdog
- BOT_TOKEN precedence, missing token, malformed OWNER_IDS
- plugin load order and duplicate event registration
- shard/fleet heartbeat and lease behavior
- graceful shutdown and signal handling

### Playback engine
- `play` retry/backoff and third-failure drop
- stale player/rebuild during `play`
- pause timeout vs destroy vs resume
- skip/seek/stop during a pending retry
- previous/history and queue-head semantics
- volume persistence and loudness override interaction
- loop/autoplay interaction at track end/queue end

### Queue and session
- rebuild/migration double-transfer and skipped-track loss
- lease contention between two bots
- restore with empty channel, paused state, 24/7, expired session
- persist/delete race during stop/restart
- stale now-playing and setup-panel cleanup
- `leavePromise` ordering

### Commands and context
- interaction defer/edit/10062/40060 paths
- ephemeral vs public replies
- prefix/slash argument parity, especially playlist/autoplay
- permission/DJ gates and owner-only commands
- autocomplete failures and timeouts
- auto-delete timers after channel deletion

### Dashboard and auth
- OAuth state/cookie/session revocation
- CSRF enforcement on every mutating route
- token/loopback mode fail-closed behavior
- guild access and DJ/owner escalation
- rate limits and body size limits
- player actions against stale/missing dispatchers
- stats/settings error paths

### Plugins and bridge
- Earl bridge auth, opt-out silence, channel resolution
- listener-stopped reconciliation cadence
- node watchdog overlap/idempotent migration
- anti-crash rejection/uncaught/signal paths
- advice/status startup-only behavior

### Data layer
- cache invalidation and TTL correctness
- transaction boundaries and partial writes
- playlist dedupe/legacy JSON rows
- session/lease cleanup
- stats pruning cutoffs
- concurrent SQLite writer behavior (`busy_timeout`/WAL)

Deliverable: bug list with reproduction steps and evidence.

## Phase 3 — Concurrency and Timing Audit

Use fake timers or a controlled clock where possible.

Test:
- two `play()` calls racing
- skip while a retry timer is pending
- destroy during pause timeout
- destroy during restore
- node migration while a track ends
- two guild restores racing for the same lease
- dashboard action during player destroy
- collector/message deletion after channel removal
- repeated pause/resume (timer leak)
- 100 restarts/queue cycles (listener/timer leak)

Tools:
- heap snapshots before/after cycles
- `process._getActiveHandles()` / timer counts in a test harness
- `EventEmitter.listenerCount` checks
- SQLite `PRAGMA`/query counters

Deliverable: race/leak findings with sequence diagrams where useful.

## Phase 4 — Performance Audit

Measure:
- startup: module load, DB init, command/event loading, plugin loading
- search/play request latency (Deezer/Lavalink)
- queue render with 200 tracks
- playlist load with 200 tracks
- session persist/restore with 200 tracks
- dashboard state payload size and query count
- memory after repeated track changes
- log overhead at debug level

Optimize only with evidence:
- avoid duplicate DB reads/caches
- batch queue/session writes where safe
- bound caches and remove expired entries
- avoid re-resolving unchanged tracks
- reduce per-message work in mock/setup rendering
- ensure timers are `unref()` where appropriate
- avoid synchronous work in interaction handlers

Deliverable: benchmark table and accepted/rejected optimizations.

## Phase 5 — Security and Reliability Review

- `npm audit --omit=dev`
- secret scan of tracked files and logs
- dashboard auth/CSRF/state tests
- bridge bearer auth timing-safe check
- owner/dev command guards
- input length/URL validation
- permission overwrites on setup channels
- rate limits and body limits
- error messages that leak tokens/paths
- log redaction for tokens/ARLs/passwords

Deliverable: security findings, severity, and fixes.

## Phase 6 — Fix Batches

Order:
1. P0/P1 correctness and security
2. races/leaks
3. performance with measured wins
4. P2 behavior/logging
5. P3 cleanup

Each batch:
- add regression test
- run full gate
- commit separately
- update the bug list with status and evidence

Do not bundle unrelated fixes.

## Phase 7 — Soak and Chaos

On BotTest:
- 24-hour soak with mixed queue/playlist/autoplay
- restart every 2 hours; verify restore
- pause/resume/seek loops
- 200-track queue and playlist
- repeated dashboard requests and player actions
- bridge auth probes
- node failover/switch-back using isolated Lavalink
- memory/timer/listener snapshots at start/end
- log scan for unhandled rejections and leaks

Gate: no P0/P1, no monotonic memory growth, no stuck queue, no duplicate
players, restart restores correctly.

## Phase 8 — Final Audit and Merge Gate

- Re-run static gates, coverage, audit, benchmarks.
- Review all P1/P2 fixes and tests.
- Update `docs/OPTIMIZATION_BASELINE.md` and a final findings report.
- Confirm production remained untouched.
- Merge/deploy is a separate approval step.

## Workflow Commands

```bash
# static
npm run build
npm run lint
npx tsc --noEmit -p tsconfig.json
npm test
node --test --experimental-test-coverage

# audit
node tooling/rewrite-audit.mjs <upstream-src>

# staging
BOT_HOST=root@192.168.1.235 BOT_DIR=/root/BotTest \
  ./tooling/staging-smoke.sh
```

## Deliverables

- `docs/OPTIMIZATION_BASELINE.md`
- `docs/BUG_HUNT_FINDINGS.md`
- `docs/PERFORMANCE_BENCHMARKS.md`
- regression tests for every fix
- final merge-gate report
