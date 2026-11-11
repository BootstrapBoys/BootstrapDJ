# BootstrapDJ performance optimization plan

**Status:** implemented on `dev`; 30-minute 10-player BotTest soak **PASS**; production rollout pending<br>
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

## 5. Implementation status on `dev`

The following work is committed on `dev`; `main` and production remain unchanged.

| Workstream | Implementation | Verification |
|---|---|---|
| Counters | Process counters for session writes/bytes/skips/errors, stats batches/rows/flush time, autoplay cache/coalescing/search, dashboard requests | `/internal/metrics` exposes them; dashboard metrics test |
| Persistence | Signature + 2 s position threshold, in-flight coalescing, queued follow-up write | `tests/session-persistence.test.mjs` |
| Scheduler | One unref'd process timer; per-guild deadlines; paused/empty/missing players skipped; destroy/register race covered | `tests/playback-scheduler.test.mjs` |
| Listener stats | In-memory cross-guild accumulation, one transaction per minute, flush on graceful shutdown | `tests/listener-stats-batcher.test.mjs` |
| Dashboard polling | 2 s visible poll, no hidden-tab polls, in-flight guard | dashboard UI test |
| Autoplay | In-flight mix coalescing, 60 s negative cache, bounded Deezer track-id cache | `tests/autoplay-mix.test.mjs` |
| Database | `RecentTrack(guildId, id)` index for the retention query | SQLite microbenchmark below |

### Measured query result

The retention query is:

```sql
SELECT id FROM RecentTrack WHERE guildId = ? ORDER BY id DESC LIMIT 1 OFFSET 100
```

With the existing `(guildId, playedAt)` index, SQLite used a covering index but still built a temp
B-tree for `ORDER BY id`. Adding `(guildId, id)` removed the sort. On 4,000 seeded rows, 5,000
warm runs measured:

| Index | Mean query time | Plan |
|---|---:|---|
| `(guildId, playedAt)` | 0.0845 ms | covering index + temp B-tree for order |
| `(guildId, id)` | 0.0073 ms | covering index, no sort |

This is a local microbenchmark, not a production query profile. The index is a schema change and
therefore requires `prisma db push` and a production DB backup before it is deployed.

### Bun spike result (2026-11-11)

- Bun **1.4.4** was installed at `/root/.bun/bin/bun` (the pre-existing 1.0.2 was too old).
- A separate `/root/BotBunTest` clone of `dev` was created; `bun install` and `bun run build`
  succeeded, including Prisma client generation.
- Under Bun, the bot connected to the Discord Gateway (`BootstrapDJ-DEV#7138 is ready`) and both
  Lavalink nodes became ready.
- **Runtime blocker:** Prisma's `@prisma/adapter-better-sqlite3` fails with
  `'better-sqlite3' is not yet supported in Bun`. Setup, session restore, 24/7 and lease queries
  all fail. The same test run also lacked dashboard auth in the copied BotTest env, but the database
  adapter is the hard blocker for the music bot.
- Decision: do not migrate to Bun. Node 24 remains the supported production runtime. A future Bun
  path would require replacing the SQLite adapter/provider, which is a larger change than a runtime
  swap and is not justified by the current evidence.

### Verification status

- `npm run build`, `npm run lint`, and `npm test` pass on `dev` with **428/428 tests**.
- The required active BotTest soak (10 players, 30 minutes) **PASSED**: 120 samples, 10 players
  present in every sample, **30/30 workload commands**, **0 crashes**, **0 workload failures**,
  RSS growth **-1.11%**, heap growth **9.45%**, event-loop p99 **22.41 ms**, max **32.95 ms**,
  maximum queue depth **6**.
  Artifact: `/root/BotBunTest/artifacts/soak/2026-11-11T09-47-32-981Z`.
- Bun **1.4.4** was installed and the compatibility spike reached the database blocker described
  above. Node 24 remains the supported runtime; no Bun path is pending.
- The sidecar/language decision remains deferred until telemetry shows the sidecar is a bottleneck.
  No active-node cache was added: the resolver is an in-memory connected-node sort, and caching it
  would introduce a stale-node failure mode without a measured hot path.
- The P2 SSE endpoint is implemented and measured below. The sidecar cache and SSE fan-out are
  active; browser transport, hidden-tab behavior, logout teardown, session expiry and backend-loss
  fallback were exercised in Chromium 145 against the isolated loopback sidecar.
- Real Discord OAuth login was exercised against the isolated sidecar through a temporary HTTPS
  tunnel using the production Discord application. The signed-in account was `zebz213`
  (`174244315302854657`, a configured owner), and the sidecar logged SSE attachments for the
  production guild and `Zebz Testing Server`. No production process was deployed or restarted.

### 10-client polling test (2026-11-11)

The test used an isolated `ViewerTest` process from the `BotBunTest` clone of `dev` on the bot
host, with token-mode dashboard access and `timeoutlisteners=0` on the test guild so the player
stayed alive. It was embedded dashboard mode, not the production sidecar topology.

- 10 concurrent clients, 2-second interval, 30 seconds
- Each client used a distinct loopback `X-Forwarded-For` address so the dashboard's 300-read/minute
  per-IP limiter did not turn the test into a rate-limit test
- **150/150 successful requests, 0 failures**
- p95 **9 ms**, max **11 ms**
- Server `dashboardPlayerRequests` counter: **4 → 154**, exactly **+150**

This validates the polling path and the counter. It does not validate OAuth permissions, audio
Listen concurrency (token mode uses one fallback identity), hidden-tab suspension, or sidecar
upstream fan-out.

### Sidecar fan-out test (2026-11-11)

A second isolated run used separate `ViewerBot` and `ViewerDashboard` processes from the same `dev`
checkout, with the bot control API on `8798` and the dashboard on `8796`. The bot-side
`dashboardControlPlayerRequests` counter was added specifically to measure the upstream calls.

- 10 concurrent clients, 2-second interval, 30 seconds
- **150/150 successful dashboard requests, 0 failures**
- p95 **23 ms**, max **27 ms**
- Bot control reads: **1 → 151**, exactly **+150**
- The sidecar currently performs **one control read per browser poll**, confirming a 1:1 fan-out

The cache and SSE fan-out are now implemented; together they collapse many viewers' reads into one
control call per interval and stop per-client polling. The next step is browser/OAuth acceptance and
connection-failure testing.

### Player cache result (2026-11-11)

The same 10-client, 30-second run was repeated after `PlayerStateCache` was added:

- **150/150 successful dashboard requests, 0 failures**
- Bot control reads: **15** in 30 seconds
- Previous uncached result: **150** control reads
- Reduction: **90%**, with p95 **26 ms** and max **33 ms**

The cache reads one snapshot per guild and shares the refresh across all viewers.

### SSE result (2026-11-11)

Ten authenticated fetch streams subscribed to `/api/events` for 30 seconds:

- **10/10 streams stayed connected**
- **60 data events total**, 6 per client (the track's position payload updates about every 5 seconds)
- Bot control reads: **15** for the whole 30-second run
- **0 stream failures**
- No per-client polling requests

The browser uses `EventSource` only in OAuth mode because `EventSource` cannot send the token-mode
header; token mode retains the polling fallback. This test used a token-authenticated fetch stream,
so it validates the server hub and fan-out, not the final browser `EventSource` handshake.

### Browser and failure acceptance (2026-11-11)

The browser pass used Chromium 145 against the isolated sidecar on loopback `8796`, first with a
signed session cookie, then with a real Discord OAuth login through a temporary HTTPS tunnel. This
exercises both the browser cookie/`EventSource` path and the Discord authorization-code exchange.

- Initial `/api/events` stream for the default guild: **OPEN**
- Guild switch: old stream **CLOSED**, new guild stream **OPEN**
- Simulated hidden tab: open stream **CLOSED**; returning visible opened a fresh stream
- Backend sidecar stop: open stream **CLOSED**; recovery used `/api/player-state` polling fallback
- Logout: existing stream **CLOSED**; session and CSRF cookies cleared; handshake returned `401`
- Session expiry: stream closed at the next heartbeat and the page redirected to the Discord
  authorization URL; an expired-cookie handshake returned `401`

Permission matrix against the test guild:

| Identity | Member | Admin | Controls | Settings | Listen |
|---|---:|---:|---:|---:|---:|
| Owner | yes | yes | yes | yes | yes |
| Admin (test bot in production guild) | yes | yes | yes | yes | yes |
| DJ role (`Role` row, test bot) | yes | no | yes | no | yes |
| Ordinary member (test bot) | yes | no | no | no | yes |
| Outsider | no | no | denied `403` on state | no | no |

The DJ branch was exercised with a temporary `Role` row and removed afterwards. The outsider was a
signed session for a non-member; `/api/guilds` returned an empty list and `/api/state` returned
`403`. The real OAuth account was the configured owner `zebz213`; its sidecar log showed SSE
attachments for both the production guild and the test guild. The active BotTest soak closed with a
pass on `1252b093`.

### Ten-stream audio load test (2026-11-11)

The temporary per-user limit was set to **10** only in the isolated test checkout. The bot was
seeded with one player in each of three test guilds; ten dashboard tabs were then opened as
4 + 4 + 2 across `Zebz Testing Server`, `BootstrapTester's server`, and
`BootstrapTester's server2`.

- Lavalink logged **10 active tap listeners** (4 + 4 + 2) with no listener-limit `429`s.
- The dashboard had **10 established audio streams** (plus the control/SSE connection).
- 30-second sample: host load average **1.08 on 4 cores**; Lavalink **0.5% CPU / ~455 MB RSS**;
  dashboard **0.4% / ~114 MB**; cloudflared **0.4% / ~47 MB**; total memory used **1.67 GB**.
- Dashboard control reads moved from **172 to 192** in 30 seconds; no stream/tap errors appeared.

This validates the temporary per-user cap and the audio fan-out path. It is not the 10-player
engine soak: only three players were active, and the dashboard was in anonymous loopback mode, so
all tabs shared one fallback identity. Production remains at the default limit of **1**.

Neither feature changes the audio tap or Discord playback.

## 6. Execution order and gates

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

## 7. Production rollout

- Use BotTest for every behavior change; do not restart production for benchmarks.
- Deploy one workstream at a time; record the commit and before/after metrics.
- Bot-side changes require `DJBoot` restart; dashboard-only changes require only the `dashboard`
  sidecar restart.
- The recent-track index is the only schema change in this pass. Back up the production DB, run
  `npx prisma db push`, and verify the index exists before restarting. No other migration is expected.
  If one appears, back up the production DB first and follow the migration checklist.
- Roll back by restoring the previous deployed SHA and restarting the affected process.

## 8. Definition of done

- Baseline and final active-soak reports exist.
- All prior tests plus new regression tests pass; CI is green.
- Session restore, queue, autoplay, dashboard, PWA and audio tap are unchanged from the user's
  perspective.
- The measured improvement is stated as actual before/after numbers, not LOC or intuition.
- No optimization is kept if it only adds complexity without a measured gain.
