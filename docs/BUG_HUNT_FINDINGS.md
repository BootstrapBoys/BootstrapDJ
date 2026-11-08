# Bug-Hunt Findings

Baseline: `a92b636` / docs `3a0d0c6`
Sources: four read-only domain audits; probes under
`/home/hermes/.hermes/cache/scratch/`; static gates 209/209.

## Fix status — P0/P1

BUG-001 through BUG-010 are fixed on `experimental/rewrite`, one commit per
finding with a regression test. Final gate: 242/242 tests, `npm run build`,
`npm run lint`, `npx tsc --noEmit`, `git diff --check` clean.

| ID | Status | Fix |
|---|---|---|
| BUG-001 | fixed | strict snowflake-array parse; both dev gates fail closed |
| BUG-002 | fixed | per-guild session write queue in the data facade |
| BUG-003 | fixed | explicit `DASHBOARD_ALLOW_ANONYMOUS`, loopback-only, refused with a public URL |
| BUG-004 | fixed | engine-owned retry handle, control generation, `current` cleared on stop |
| BUG-005 | fixed | per-guild in-flight rebuild/create promises; `create()` awaits the replacement |
| BUG-006 | fixed | prefix paginators delete on collector end/stop |
| BUG-007 | fixed | ephemeral defer plus `deferred || replied` edit path |
| BUG-008 | fixed | startup rejection logs and exits 1 |
| BUG-009 | fixed | per-node incidents; primary failover runs outside the alert gate |
| BUG-010 | fixed | transient restore failures keep the row with bounded backoff |

## Fix status — P2 dashboard / plugin / data batch

The dashboard, plugin, bridge and data-store subset of P2 is fixed on
`experimental/rewrite`, with one regression suite per area:

| Finding | Fix |
|---|---|
| XFF rate-limit bypass and unbounded buckets | `X-Forwarded-For` is trusted only from a loopback proxy (last hop); the bucket map has a 5k hard cap and LRU pruning |
| GET amplification | `/api/*` reads are rate-limited per verified client, not just POSTs |
| Stale guild access cache for writes | mutating routes re-check access and invalidate the guild's cached entries; cached objects are copied |
| Dashboard autoplay source forced curated | one validated `AutoplaySetting` upsert merges source and seeds; editing seeds preserves a stored `chart`/`legacy` source |
| Settings validation / partial writes | every key and value is validated before a single Prisma transaction writes the form; bad input returns 400 |
| `.env.example` OAuth lockout | the example leaves all four OAuth values blank; a non-blank redirect URI no longer forces incomplete OAuth |
| Settings cache copy / TTL | cache reads return copies; guild and settings entries expire (30 s / 5 s) so another bot process' write is eventually seen |
| Plugin shutdown never invoked | `loadPlugins` keeps the plugin list, `shutdownPlugins` runs reverse-order teardown with error isolation, and antiCrash calls it on a signal |
| Public fallback never drained | the watchdog removes a fallback only when no local dispatcher is bound; active players migrate to the primary and idle ones are torn down first |
| Earl validates after joining, opt-out after DJ, bypasses limits | verb/argument validation and dedupe run before `queue.create`; opt-out precedes the DJ gate; `PlayLimits` covers tracks and playlists; a playlist persists once |
| Autocomplete rejection | a failed playlist/search lookup answers `[]` instead of timing out |

Skipped: playlist track ordering is stored in the Prisma `Song` table without a
stable position column. Fixing random UUID order needs a schema change, which
this batch explicitly excludes.

## P0 — fix immediately

### BUG-001 — OWNER_IDS parse is fail-open
`src/config.ts`, `src/lib/CommandGate.ts`, `src/events/client/InteractionCreate.ts`

`JSON.parse(env.OWNER_IDS)` is cast to `string[]` without validation. Values
`null`, `""`, numbers, comma-separated IDs, or a JSON string can crash startup,
throw, or make `.includes()` a substring match. `CommandGate` skips the dev gate
when `owners` is falsy, so a malformed but valid JSON value can let any member
run `eval`, `shutdown`, or `reload`.

Fix: validate an array of snowflake strings, fail closed, log a clear startup
error, and use `Array.isArray`/length checks in both gates.

## P1 — fix before merge

### BUG-002 — Session save/delete race
`PlaybackEngine.persist()` and `stop()`/`DestroyCoordinator` fire session writes
without ordering. A late save after stop can recreate the deleted row, causing a
restart to replay a cleared queue. `session-race-probe` reproduced 50/50.

Fix: per-guild serialized session write queue or await/delete barrier; test with
the real adapter.

### BUG-003 — Anonymous loopback dashboard grants owner access
With no token/OAuth, loopback mode returns full owner access. If the loopback
port is proxied, anonymous clients can control the bot. README recommends a
proxy, so this is a real deployment risk.

Fix: require an explicit `DASHBOARD_ALLOW_ANONYMOUS=1` (or generated token) even
on loopback; refuse anonymous mode when a public/proxy URL is configured.

### BUG-004 — `/stop` does not cancel a pending play retry
`PlaybackEngine.play()` schedules a retry and leaves `current`; `stop()` clears
queue but not `current`/retry timer. The retry can restart audio after `/stop`
and skip/pause during the window is lost.

Fix: own the retry timer, clear it on stop/skip/pause/destroy, clear current on
stop, validate a generation/stopped token in the callback.

### BUG-005 — `Queue.create()` returns the dying dispatcher during rebuild
`Queue.rebuilding` returns the old dispatcher; enqueues are lost when the
migrator installs the replacement. A second spawn can also race after the map
entry is removed.

Fix: store an in-flight `Promise<Dispatcher>` per guild; `create()` awaits it and
returns the replacement; never expose a rebuilding dispatcher.

### BUG-006 — Prefix paginated replies are never deleted
`Utils` only deletes when `!ctx.ephemeral`; prefix contexts default ephemeral,
and component messages are delete-exempt. Collectors end but messages remain
with dead buttons.

Fix: use `ctx.isInteraction ? ctx.ephemeral : false` for delete decisions, or
set prefix contexts non-ephemeral; delete on collector stop.

### BUG-007 — Setup panel buttons leave a deferred “thinking” reply
`SetupButtons` defers publicly; `SetupSystem.buttonReply` checks only
`interaction.replied`, so it always follows up and never edits the deferred
reply. Placeholders accumulate.

Fix: defer ephemerally and branch on `deferred || replied` when editing; or
acknowledge with an ephemeral reply.

### BUG-008 — Startup rejection becomes a live zombie
`ShardClient.start()` is fire-and-forget; an invalid token or bind failure is
logged by antiCrash as an unhandled rejection and the process stays alive,
never connecting.

Fix: catch `start()` and exit non-zero for startup failures; keep antiCrash’s
runtime rejection policy unchanged.

### BUG-009 — Global incident suppresses failover/outage alerts
`NodeStatus` has one module-global incident; `NodeError`/`NodeDisconnect` open it
and standby recovery never closes it. `NodeDestroy` gates `failOver()` on it, so
a primary crash after an error/standby event may never migrate.

Fix: per-node incident state; run primary failover outside the incident gate,
once per loss.

### BUG-010 — Failed restore deletes the saved queue
`SessionRestorer` catch-all calls `deleteSession` after transient join/play
failures. One Lavalink hiccup destroys a 200-track queue.

Fix: delete only permanent validation failures; keep the row for transient
transport failures, release lease, bounded retry/backoff.

## P2 — fix in batches after P0/P1

- Natural queue end leaves a session row; restart replays last track.
- Stale players not rebuilt on non-play commands; success replies with no effect.
- Queue/loop/shuffle/remove/clearqueue mutations bypass persistence while paused.
- Autoplay lookahead null is terminal; bot sits idle in voice.
- `defaultshuffle` shuffles an empty new queue.
- Migration drops filters/`previous`/ephemeral flags and races volume.
- Restore lease can expire during `SESSION_EMPTY_WAIT`; double restore.
- Paginated/prefix argument parsing: multi-word add/profile/mappings/playlist,
  move `to`, playlist rename/copy/remove offsets, requested mention.
- `/playnext <playlist>` bypasses queue/user limits.
- Setup request flow drops failures and reports requested track as current.
- `deleteafter=0` ignored; DJ role removal leaves DJ mode on; permissions/prefix
  unknown subcommands silent.
- Dashboard XFF rate-limit bypass/unbounded buckets; guild access cache stale
  for writes; GET amplification; autoplay source forced curated; playlist random
  UUID order; `.env.example` OAuth lockout; missing auth/CSRF tests.
- Plugin shutdown never called; watchdog public-fallback migration edge; Earl
  bridge validates after joining, opt-out after DJ gate, bypasses play limits.
- Multiple smaller issues captured in audit transcripts.

## P3 — cleanup/hardening

Cooldowns/alias buckets, filter awaits, endtime timers, raw error replies,
autocomplete failure path, reply fetch cost, guild command defer, setup
permissions, channel formatting, stats skip counting, queue max mismatch, bulk
persist, vote-skip state, session write ordering, guild data retention, bridge
mention injection, dashboard validation/error codes, cache TTLs, dependency
runtime version mismatch.

## Status

P0, all P1, assigned P2, and high-value P3 findings are fixed with regression tests. Final code checkpoint: `f5103b9`; tests: 351/351. Remaining known exceptions: playlist UUID ordering requires a schema position column; repo-wide `npm run format` is red on pre-existing files; 24-hour soak and long-run performance capture remain.
