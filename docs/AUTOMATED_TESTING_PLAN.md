# Automated Testing Plan

Goal: make every merge independently verifiable and add the missing long-run
proof: a repeatable **24-hour soak with performance capture** on an isolated test
bot.

Current baseline:
- `node --test tests/*.test.mjs`: **353 tests**
- CI: format, lint, build, tests
- BotTest: isolated Discord app, SQLite DB, dashboard `8796`, bridge `8792`
- 10-stage staging matrix is in the maintenance skill's `references/staging-and-failover.md`
- Missing: scheduled integration/E2E runs, chaos automation, soak metrics,
  long-run thresholds, and artifact retention

## Test Pyramid

| Level | Scope | Where | Cadence | Target |
|---|---|---|---|---|
| L0 Static | format, lint, tsc, build | CI | every push/PR | < 2 min |
| L1 Unit | pure logic, stores, state machines | CI | every push/PR | < 5 min |
| L2 Integration | temp SQLite, fake player/Lavalink, dashboard HTTP | CI | every PR + nightly | < 10 min |
| L3 Staging E2E | real Discord + Lavalink | BotTest host | nightly + pre-merge | < 20 min |
| L4 Chaos | node loss, failover, restore, restart | BotTest host | weekly + pre-release | < 1 h |
| L5 Soak | 24 h mixed workload + metrics | BotTest host | weekly/monthly | 24 h |
| L6 Security | auth, CSRF, rate limits, owner gate | CI + BotTest | every PR + nightly | < 5 min |

No level replaces another. A green unit suite does not approve a playback or
migration change without L3.

## Highest-Value Additions

These are worth building into the first version, not deferring:

1. **A test control plane instead of UI automation.** Drive the BotTest player
   through the authenticated bridge (`POST /voice/command`) and read state from
   the dashboard API. Reserve CDP/Discord UI automation for presentation checks
   only; UI automation is brittle and slow for soak runs.
2. **A metrics endpoint on the dashboard.** Add `GET /api/metrics`, behind the
   existing dashboard auth, returning process memory, event-loop percentiles,
   active resources, player/queue counts, uptime, and guild count. It is the
   only reliable way to sample event-loop lag from inside the bot.
3. **Schema migration tests.** Apply the Prisma schema to a temp DB, seed legacy
   rows, run startup initialization twice, and assert required columns,
   backfills, and idempotence. This would have caught the playlist-order class of
   bug.
4. **A release gate, not just a test list.** A release candidate must pass L0–L3,
   a 1-hour soak smoke, and (for playback/session/schema changes) the full 24-hour
   soak. Record the commit SHA and artifact path in the release note.
5. **Coverage on changed lines.** Keep the global target, but block a PR when
   changed lines drop below 70% or a critical lifecycle branch is untested.
6. **Secret and artifact hygiene.** Redact tokens/ARLs, never upload `.env`, raw
   production DBs, or Discord identifiers beyond the test guild. Scan artifacts
   for secret patterns before retention.
7. **Flake policy.** Quarantine a flaky test with an owner and expiry; never
   silently skip. Infrastructure retries are allowed; product assertions are not.
8. **A test-only precondition check.** The soak runner must refuse to start
   unless `PRODUCTION=false`, the guild equals the test guild, the DB is not the
   production path, and the bridge and dashboard are loopback-only.
9. **Performance budgets in CI.** Assert the fast unit suite stays under its
   time budget and the build stays deterministic; fail if the suite regresses by
   more than 25% over a 5-run baseline.

## Execution Workflow

| Step | Deliverable | Gate |
|---|---|---|
| 1 | Metrics endpoint + tests | unit + dashboard 200 |
| 2 | Soak runner, workload, report, thresholds | 5-minute dry run |
| 3 | Coverage script + CI step | CI green |
| 4 | BotTest smoke wrapper | unattended nightly |
| 5 | Chaos wrapper | failover/restart pass |
| 6 | 1-hour soak smoke | summary + no threshold breach |
| 7 | 24-hour soak | weekly artifact + report |

## What to Automate First

1. **CI quality gate** — already present; add coverage reporting.
2. **Integration suite** — temporary SQLite plus fake Shoukaku player and fake
   Discord interactions; no real network.
3. **BotTest smoke** — non-interactive commands through the bridge/REST or a
   test-only command runner; avoid UI/CDP for the routine path.
4. **Session/restart test** — start playback, restart, assert current track,
   position tolerance, queue, loop, volume, autoplay.
5. **Failover test** — primary → backup → primary, assert resume and no queue
   loss.
6. **Soak harness** — the main missing piece.

## Test Data and Isolation

- Dedicated test guild, test bot token, test DB, test dashboard port, test
  bridge port.
- Never point tests at `prisma/bootstrapdj.db`, production token, production
  dashboard, or the production Lavalink session.
- Use a copy/seed DB with known playlists and deterministic tracks.
- Clean up guild messages, voice connections, sessions and temp DBs in
  `after()` hooks.
- Unit tests use fake clocks/timers; only L3+ may sleep for real.

## Coverage

Add `node --test --experimental-test-coverage` to CI and publish:
- lines, branches, functions
- per-directory summary
- diff coverage on PRs

Initial targets:
- overall: **75% lines / 65% branches** (from 67.64 / 61.48)
- critical modules (`core/player`, `data`, `dashboard/auth`): **85% lines**
- no decrease on changed lines

Do not chase coverage with assertion-free tests. Critical lifecycle branches
must be exercised: stop/retry, rebuild, restore failure, node loss, queue end.

## 24-Hour Soak Harness

Create `tooling/soak/`:

```
tooling/soak/
  run.mjs          # orchestrator, checkpoints, teardown
  workload.mjs     # scripted Discord/Lavalink actions
  metrics.mjs      # process, DB, node and queue sampling
  thresholds.json  # pass/fail limits
  report.mjs       # JSON + Markdown summary
```

### Run contract

```bash
SOAK_HOURS=24 \
SOAK_GUILD_ID=... \
SOAK_TEXT_CHANNEL_ID=... \
SOAK_VOICE_CHANNEL_ID=... \
node tooling/soak/run.mjs
```

Required environment: test token, test DB, BotTest API/bridge, primary and
backup Lavalink. Refuse to start if `PRODUCTION=true`, the guild is not the test
guild, or the DB is the production path.

### Workload loop

Every 5–10 minutes, mix:
- play a search result, skip, pause/resume, seek, volume, loop
- enqueue 10–50 tracks, remove/move/shuffle/clear
- load a playlist, add/remove a playlist track
- toggle autoplay, let it run for several tracks
- idle for 10 minutes
- read `/nowplaying`, `/queue`, dashboard state
- every 2 hours: restart the bot and verify restore
- every 4 hours: primary → backup → primary failover
- once: session row deletion after natural queue end

Add bounded randomization and a fixed seed for reproducibility.

### Recommended 24-hour scenario matrix

Run these as separate soak profiles, or as phases in one run:

| Profile | 24/7 | Autoplay | What it proves | What it hides |
|---|---|---|---|---|
| Continuous | on | on | track transitions, cache, Lavalink, always-on stability | queue end, leave, session deletion |
| Lifecycle | off | mixed | queue end, leave/rejoin, session cleanup, idle timers | long continuous playback |
| Stress | either | on | queue churn, failover, restart, memory under load | clean idle behavior |

Recommended single-run schedule:
- **0–1h:** warmup, baseline, short functional probe
- **1–8h:** 24/7 on + autoplay on, plus queue/playlist mutations every 10 min
- **8–16h:** 24/7 off, mixed normal playback, force queue end and leave/rejoin
- **16–22h:** 24/7 on + autoplay, restart and failover probes
- **22–24h:** teardown, final functional probe, artifact flush

24/7 + autoplay is worth enabling because it exercises the long-lived player,
track replacement, autoplay resolution/cache, and repeated Lavalink updates.
Do not use it as the only profile: it prevents the queue-end session deletion
and leave path from ever running.

Soak-specific controls:
- cap the queue (for example 50) so a stuck autoplay cannot grow unbounded
- use a fixed seed and a known playlist for reproducibility
- monitor autoplay resolution failures, 429s, and source API latency
- record autoplay cache size and hit/miss counts
- run a separate cleanup assertion after disabling 24/7
- keep the test guild and voice channel dedicated; never use production

### Metrics sampled every 15–30 seconds

Process:
- RSS, heap used/total, external, array buffers
- CPU user/system
- event-loop delay p50/p95/p99/max (`perf_hooks.monitorEventLoopDelay`)
- active handles/requests (`process.getActiveResourcesInfo()`)
- GC count/pause if `--trace-gc` is enabled

Application:
- dispatchers, players, queue depth, sessions
- timers/listeners/collectors created vs cleared
- command success/error counts
- unhandled rejections/exceptions
- Lavalink `/v4/stats` (players, playing, memory, CPU)
- DB size, WAL size, Song/Session/Playlist row counts
- dashboard request latency/error rate

Write JSONL continuously; flush on every sample so a crash keeps evidence.

### Checkpoints

At start, 1h, 6h, 12h, 24h:
- write a summary row
- optionally take a heap snapshot at 1h and 24h
- record DB row counts and file sizes
- record queue/session/timer counts
- run a short functional probe (play/skip/pause/queue/stop)

### Pass/fail thresholds (initial)

- zero unhandled rejections and zero process exits
- RSS after 24h within **10%** of the 1h warm baseline, or explained
- heap used after 24h within **15%** of the 1h baseline
- event-loop p99 **< 50 ms**, max **< 500 ms**
- timers/listeners/collectors return to baseline after cleanup ± small constant
- no dispatcher, player, session, or queue-row leak after teardown
- restore and failover probes pass at every checkpoint
- DB/WAL growth bounded; no unbounded Song/Session accumulation
- dashboard p95 **< 250 ms** on loopback

Thresholds live in `thresholds.json`; changing one requires a note in the report.

### Artifacts

Per run, keep:
- commit SHA, branch, dirty state, Node/npm versions, OS, Lavalink versions
- `metrics.jsonl`
- `summary.json` and `summary.md`
- BotTest stdout/stderr logs
- heap snapshots (if enabled)
- DB copy and row counts
- failure screenshots only for UI-driven runs

Retain 30 days locally; upload the summary and JSONL to CI artifacts or the
wiki. Never upload tokens, `.env`, or raw DB containing user data.

## Automation and Scheduling

- **Every push/PR:** L0 + L1 + fast L2, coverage summary.
- **Nightly:** full L2, L3 BotTest smoke, security suite, restore test.
- **Weekly:** chaos/failover and a **24-hour soak** on BotTest.
- **Pre-release:** L3 + L4 + 24-hour soak; production deploy only after pass.

Use a systemd timer or cron on the BotTest host for L3–L5, because Discord voice
and Lavalink are not suitable for GitHub-hosted runners. The job must:
1. pull the target SHA
2. build and migrate a disposable test DB
3. start BotTest
4. run the harness
5. stop BotTest and clean up
6. write summary + exit non-zero on threshold failure

A simple lock file prevents overlapping soak runs. Notify on failure with the
summary and the first failing metric.

## Failure Handling

- Fail on product errors; retry only infrastructure failures (Lavalink connect,
  network) with bounded backoff.
- On crash, preserve logs/metrics and mark the run failed; do not auto-restart
  into a passing result.
- Quarantine flaky tests with an owner and expiry; do not silently skip.
- A soak failure blocks the release until triaged or explicitly waived.

## Security Tests

- `OWNER_IDS` missing/empty/malformed fails closed
- dashboard anonymous mode refused unless explicit loopback opt-in
- OAuth state/session/CSRF negative cases
- XFF spoofing and rate-limit bucket cap
- bridge auth timing-safe, 401 without secret
- no token/error leakage in logs or user replies

## Implementation Phases

1. **Harness foundation (1–2 days):** metrics sampler, workload driver, run
   lock, JSONL, summary, teardown.
2. **Integration suite (2–3 days):** fake player/Lavalink/Discord, temp DB
   fixtures, dashboard HTTP tests.
3. **BotTest automation (1–2 days):** start/stop, test-only command runner,
   nightly smoke, restore test, artifact upload.
4. **Chaos (1–2 days):** automated node stop/start, migration assertions,
   switch-back.
5. **Soak and thresholds (1–2 days):** 1h dry run, 6h tuning, then 24h;
   calibrate thresholds from 3 clean runs.
6. **CI/reporting (1 day):** coverage, nightly/weekly schedules, notifications,
   documentation.

Total: **7–12 focused days**, then weekly soak maintenance.

## Implementation Status

- `GET /api/metrics` is implemented behind dashboard auth.
- `tooling/soak/{run,metrics,workload,report}.mjs`, `thresholds.json`, and
  `README.md` are implemented.
- `tooling/bottest-soak.sh` builds/restarts BotTest, waits for metrics, runs the
  soak, and can stop the test bot afterward.
- CI runs format, lint, build, and coverage (`test:coverage`).
- BotTest 5-minute dry run passed: 31 samples, RSS -17.7%, heap -18.0%,
  event-loop p99 21.4 ms, no uptime resets.
- Fake-Lavalink contract tests cover search prefixing, URL passthrough, fallback
  retry, transport failure, and no-node behavior.
- `tooling/chaos/failover.sh` is implemented with `CHAOS_ALLOW`,
  `ISOLATED_TEST_NODES`, production, soak-active, and PM2 process guards. It was
  not run during the active soak.
- 24-hour workload soak **PASS**: 1,435 samples, RSS +2.7%, heap -0.8%,
  event-loop p99 21.6 ms, max 49.8 ms, max queue 2, zero uptime resets. Artifact:
  `/root/BotTest/artifacts/soak/2026-11-08T20-40-53-391Z`.
- Isolated failover drill **PASS** on `Lavalink-Test-2443`/`2444` after seeding a
  live player; BotTest was restored to the shared nodes and the temporary nodes
  were stopped. The first automated attempt timed out because it had no active
  player; it restored the original env without changing production.

## Definition of Done

- CI enforces format/lint/build/tests and publishes coverage.
- Integration suite runs without real Discord/Lavalink and is green.
- BotTest nightly smoke and restart/failover tests run unattended.
- A 24-hour soak completes with metrics, summary, and no threshold breach.
- Failures produce a useful artifact bundle and a non-zero exit.
- Runbook documents how to start, stop, inspect, and waive a soak.
