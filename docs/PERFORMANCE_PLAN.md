# BootstrapDJ performance optimization plan

**Status:** proposed; no runtime changes yet<br>
**Baseline commit:** `dfd7ccb`<br>
**Scope:** bot process, dashboard sidecar, persistence, autoplay, and runtime experiments

## 1. Goal

Reduce avoidable CPU, SQLite writes, timers, and dashboard traffic without changing playback behavior,
queue semantics, session recovery, audio-tap quality, or the dashboard UX.

The audio path is not the target: Lavalink performs decoding and Discord transport, and the bot's
frame handling is already off the critical path. The measurable work is around it.

## 2. Non-goals

- No full rewrite in Go, Rust, JavaScript, or another language.
- No production Bun migration until a compatibility spike passes on BotTest.
- No Lavalink hook/plugin changes in this plan.
- No Prisma schema changes unless a measured query needs one.
- No cache that makes a user's setting or queue stale for longer than the existing contract allows.

## 3. Baseline

Measured from the current tree:

| Item | Value |
|---|---:|
| Application source | 226 TypeScript files, ~28.1k lines |
| Tests | 69 `.mjs` files, ~9.4k lines |
| Test suite | 402 passing |
| Production snapshot | 4 guilds, 0 players, 26,495 s uptime |
| RSS / heap | 187.4 MB / 39.8 MB |
| Event-loop p95 | 21.1 ms (monitor resolution 20 ms) |
| WebSocket ping | 27 ms |

This is an **idle** snapshot. It is only a sanity baseline; no target is set from it. The real
baseline must be captured on BotTest with active players and queues.

### Required baseline run

Capture before changing code:

1. Start the isolated Lavalink/BotTest pair.
2. Run `tooling/soak/run.mjs` with at least 10 active players, mixed autoplay, queue mutations and
   session restores for 30 minutes.
3. Record:
   - event-loop p50/p95/p99 and max;
   - RSS/heap and active resource counts;
   - number of `saveSession` calls and rows changed;
   - number of stats transactions and rows;
   - Lavalink search count from autoplay;
   - dashboard `/api/player-state` request count per viewer;
   - p95 command latency for `/play`, `/skip`, `/queue`.
4. Store the raw JSON and a short summary in `docs/PERFORMANCE_RESULTS.md`.

## 4. Workstreams

### P0 — Instrumentation and counters

**Priority:** first; no behavior change<br>
**Files:** `src/dashboard/metrics.ts`, `src/core/player/*`, `src/data/stats.ts`, optional
`src/data/session.ts`

Add counters to the existing `/internal/metrics` snapshot:

- session writes attempted, completed, skipped as unchanged, and bytes serialized;
- stats transactions/rows and flush duration;
- autoplay cache hits/misses and Lavalink searches;
- dashboard player-state requests and bytes;
- event-loop lag and memory (already present).

Acceptance:

- counters are visible in `/internal/metrics` and `/api/metrics`;
- no new secret or user data is exposed;
- metrics overhead is below 1% in a short benchmark;
- existing 402 tests remain green.

### P1 — Dirty/debounced session persistence

**Priority:** high, low risk<br>
**Current path:** `Dispatcher.startTimers()` persists every 10 s while playing; `PlaybackEngine.persist()`
serializes the full queue through `SessionWriter`.

Changes:

1. Add a per-dispatcher dirty generation for queue/state changes.
2. Persist immediately, coalesced within a short window, on meaningful mutations:
   enqueue, enqueueNext, remove, clear, loop, autoplay, volume, pause/resume, skip.
3. Keep periodic position checkpoints while a track is playing, but skip the write when neither
   state nor position changed enough to matter.
4. Do not write while paused or idle unless a state mutation occurred.
5. Keep the existing guaranteed writes on shutdown and state transitions.

Acceptance:

- session-restore tests pass for crash, pause, resume, skip, queue mutation and shutdown;
- no increase in stale-position loss beyond the chosen checkpoint interval;
- at least 30% fewer session writes in a 30-minute active soak where the queue is unchanged
  between track ends; report the exact number;
- no duplicate writes per mutation.

Risk: losing the last few seconds of position on a crash if the checkpoint interval is increased.
Keep a 10 s maximum unless the measured write cost justifies a change.

### P1 — Central scheduler for recurring work

**Priority:** high, low–medium risk<br>
**Current path:** every `Dispatcher` owns a 10 s persist interval and a 60 s stats interval
(`startTimers()` in `src/core/Dispatcher.ts`).

Changes:

1. Add a core `PlaybackScheduler` owned by `BootstrapClient` (or the audio loop owner).
2. Register each dispatcher's next persist/stats deadline instead of creating two intervals per guild.
3. Remove/ignore destroyed, replaced, or stale dispatchers by identity and `isStale`.
4. Batch work that is due in the same tick where possible.
5. Keep `unref()` behavior so the scheduler never holds the process open.

Acceptance:

- one timer/resource footprint per process instead of two per guild;
- no lost persist/stats work across 20+ guilds;
- replacement-player and destroy races are covered by tests;
- active soak shows no event-loop regression.

### P1 — Batched listener statistics

**Priority:** high, low risk<br>
**Current path:** `sampleListeners()` runs per dispatcher every 60 s and calls
`recordListenerStatsBulk()` per guild.

Changes:

1. Accumulate listener seconds in memory.
2. Flush all guilds in one transaction per minute (or one batch call) instead of one transaction per
   guild.
3. Flush on graceful shutdown and on a bounded shutdown deadline.
4. Add a metric for pending statistics.

Acceptance:

- one stats write batch per minute regardless of active guild count;
- at most 60 s of statistics can be lost on a hard crash (same or better than current sampling);
- statistics totals match the existing behavior within sampling tolerance.

### P2 — Autoplay and search efficiency

**Priority:** medium<br>
**Files:** `src/core/Dispatcher.ts` (`ensureLookahead`), `src/core/player/YouTubeMix.ts`,
`src/core/player/DeezerClient.ts`, node selection in player resolution.

Changes:

1. Cache the active Lavalink node per guild and reuse it while the node/session is unchanged.
2. Coalesce concurrent autoplay lookups for the same seed; never issue duplicate in-flight searches.
3. Cache negative/short-lived autoplay results separately from the 10-minute mix cache.
4. Cache Deezer track IDs by ISRC and normalized title/artist; keep the existing bounded LRU behavior.
5. Keep the existing bounded retry/backoff; do not remove the empty-queue protection.

Acceptance:

- autoplay search count falls in a drain-heavy soak and no duplicate track is queued;
- cache memory stays bounded (report entries/bytes);
- autoplay behavior and seed weighting tests pass;
- no new blocking work on the audio thread.

### P2 — Dashboard state transport

**Priority:** medium<br>
**Current path:** browser polls `/api/player-state` every 1 s (`POLL_MS`); sidecar mode forwards each
read through the loopback control API.

Options, in order:

1. **Low risk:** poll every 2 s while visible, pause/slow polling when `document.visibilityState` is
   hidden, and skip a request if the previous one is still in flight.
2. **Better scale:** add an authenticated SSE endpoint for player snapshots, with a polling fallback.
   Send only when the snapshot changes, plus a heartbeat.
3. Keep progress animation client-side with the existing rAF clock; do not poll faster to animate the
   bar.

Acceptance:

- 50% fewer player-state requests in a multi-viewer test;
- no visible progress/track lag beyond the existing refresh contract;
- SSE reconnect, tab hidden/visible, logout and guild switch are tested;
- no unauthenticated or cross-guild stream.

### P2 — Database hot paths

**Priority:** medium; only after counters show a real problem<br>
**Files:** `src/data/guilds.ts`, `src/data/stats.ts`, `src/data/playlists.ts`

Steps:

1. Measure p95 query time and call counts for settings, session saves, stats and queue reads.
2. Keep Prisma for schema/migrations, but use prepared/raw SQLite statements for a measured hot
   read or write if it is materially faster.
3. Add or verify indexes only with a concrete query plan; no speculative schema changes.
4. Keep the existing short settings TTL and invalidate on writes.

Acceptance:

- the chosen query improves by a measured margin (target agreed from baseline, typically ≥20%);
- no behavioral change to validation or cache invalidation;
- no migration required for an optimization that cannot prove its benefit.

### P3 — Bun compatibility spike

**Priority:** timeboxed experiment, not production<br>
**Context:** current LavaMusic 4.7 uses Bun; we use Node 24 + Shoukaku + Prisma.

Timebox one branch and BotTest run:

1. Build and start under Bun.
2. Verify Discord gateway, voice join, DAVE, Opus encode/decode, Lavalink, dashboard, Prisma SQLite.
3. Run a 30-minute soak and compare startup, RSS, event-loop p95 and command latency.
4. Document native-module or adapter failures.

Decision gate: merge only if it is measurably better and all voice/PWA/audio-tap tests pass. Keep Node
as the supported production path by default.

### P3 — Sidecar/language decision

**Priority:** defer until telemetry<br>
A Go/Rust service could reduce the dashboard sidecar's memory or HTTP overhead, but it duplicates
the dashboard contract and is not worth it unless the sidecar is a measured bottleneck. A full bot
rewrite is explicitly out of scope: Discord voice/DAVE, Opus and Lavalink integration carry the risk,
while the audio work is already outside the bot process.

## 5. Execution order and gates

| Phase | Work | Gate |
|---|---|---|
| 0 | Baseline and counters | active soak report committed |
| 1 | Dirty persistence | session tests + write-count reduction |
| 2 | Central scheduler | 20-guild timer/race tests + soak |
| 3 | Batched stats | one-batch verification + totals |
| 4 | Dashboard transport | multi-viewer request reduction |
| 5 | Autoplay/search | duplicate/search-count tests |
| 6 | DB hot paths | measured query improvement only |
| 7 | Bun spike | BotTest soak + explicit decision |

One workstream per branch/commit. Each commit must pass:

```bash
npm run build
npm run lint
npm run format
npm test
```

`npm run format` is a repository-wide check; the untracked handoff markdown is not part of the commit.

## 6. Production rollout

- Use BotTest for every behavior change; do not restart production for benchmarks.
- Deploy one workstream at a time; record the commit and before/after metrics.
- Bot-side changes require `DJBoot` restart; dashboard-only changes require only the `dashboard`
  sidecar restart.
- No schema migration is expected. If one appears, back up the production DB first and follow the
  migration checklist.
- Roll back by restoring the previous deployed SHA and restarting the affected process.

## 7. Definition of done

- Baseline and final active-soak reports exist.
- All prior tests plus new regression tests pass; CI is green.
- Session restore, queue, autoplay, dashboard, PWA and audio tap are unchanged from the user's
  perspective.
- The measured improvement is stated as actual before/after numbers, not LOC or intuition.
- No optimization is kept if it only adds complexity without a measured gain.
