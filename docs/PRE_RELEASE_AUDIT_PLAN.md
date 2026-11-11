# Pre-release audit and optimization plan

**Release candidate:** `dev` at `42fdbe2d`<br>
**Production baseline:** `main` / `/root/Bot` at `dfd7ccb`<br>
**Production state:** `DJBoot`, `dashboard`, `Lavalink`, and `Lavalink-Backup` online; untouched<br>
**Scope:** 26 commits, 34 files, +1,585 / −79; performance, dashboard SSE/cache, audio-stream test
control, soak tooling and documentation<br>
**Rule:** no production deploy until every gate below passes and the user explicitly approves.

## 0. What is already proven

- `npm test`: **423/423**, `npm run build`, `npm run lint`, and CI green on `dev`.
- Ten-player, 30-minute BotTest soak **PASS**: 120 samples, RSS growth **1.13%**, heap growth
  **10.22%**, event-loop p99 **22.07 ms**, max **42.57 ms**, max queue depth **47**, zero crashes,
  zero workload failures.
- Ten dashboard audio streams against three players completed with no tap `429`s; server load was
  low (load average ~1.08 on four cores).
- Real OAuth login, OAuth callback, SSE handshake, hidden-tab pause/resume, guild switch, logout,
  session expiry, and member permissions were exercised.
- Bun 1.4.4 is rejected as a runtime because the Prisma `better-sqlite3` adapter fails.
- The only schema change is the additive `RecentTrack(guildId, id)` index.

## 1. Principles and non-goals

### Principles

1. **Audit first, optimize second.** A green unit suite does not prove release readiness.
2. **Every optimization needs a measurement and a rollback.** No speculative refactor.
3. **One behavioral change per commit.** Do not mix cleanup, tuning, and fixes.
4. **Production is a separate action.** Audit and optimization happen on `dev`/integration branches.
5. **Re-run the 10-player soak if playback, persistence, timers, or dashboard state change.**

### Non-goals

- No Go/Rust rewrite.
- No Bun migration.
- No Docker or infrastructure change.
- No audio-tap plugin rewrite.
- No broad `Dispatcher` refactor before release unless the audit finds a correctness or measured
  performance defect that requires it.
- No changing queue semantics, session recovery, audio quality, or dashboard UX.

## 2. Phase 0 — Freeze and baseline

**Goal:** make the reviewed commit unambiguous.

- [ ] Record `dev` SHA and confirm `git status` is clean.
- [ ] Verify `main` is still `dfd7ccb` and production still runs `dfd7ccb`.
- [ ] Confirm no test `.env`, test token, tunnel, or test route is in the working tree.
- [ ] Archive the passing soak artifact path and the 10-stream load result.
- [ ] Review the `main..dev` file list and commit list; classify every change as:
      persistence, timers/stats, dashboard cache/SSE, audio-limit test support, soak tooling,
      schema, or documentation.
- [ ] Freeze `dev` except for fixes found by this audit.

**Gate:** no unreviewed commit and no uncommitted artifact.

## 3. Phase 1 — Correctness and release audit

### 3.1 Static and repository gates

- [ ] `npm ci` from a clean checkout.
- [ ] `npm run format` (repository-wide check).
- [ ] `npm run lint`.
- [ ] `npm run build`.
- [ ] `npx tsc --noEmit -p tsconfig.json`.
- [ ] `npm test` and `npm run test:coverage`; record coverage, do not silently lower it.
- [ ] Verify the CI workflow still covers format → lint → build → test/coverage.
- [ ] `git diff --check`.
- [ ] Confirm `.env`, databases, soak artifacts, and test credentials are not tracked.
- [ ] Run a secret scan (`gitleaks detect --source . --redact`) and inspect every finding.
- [ ] Run `npm audit`; triage production dependencies separately from dev dependencies.

### 3.2 Code review of the release diff

Review every source file in `main..dev`, with emphasis on:

- **Persistence:** `PlaybackEngine`, `SessionWriter`, `PerformanceCounters` — state signature,
  2-second position threshold, coalesced writes, shutdown `await persist()`.
- **Timers and stats:** `PlaybackScheduler`, `ListenerStatsBatcher`, `stats.ts` — one process-wide
  timer, one transaction per flush, no per-`Dispatcher` interval.
- **Dashboard reads:** `playerCache.ts`, `server.ts`, `events.ts` — single-flight refresh,
  stale-while-revalidate, guild scoping, client cap, logout/expiry teardown.
- **Dashboard browser:** `browser.ts` — SSE only in OAuth mode, token-mode polling fallback,
  hidden-tab pause, guild-switch cleanup, playlist shuffle, PWA install path.
- **Autoplay/search:** `YouTubeMix.ts`, `DeezerClient.ts` — in-flight coalescing, negative cache,
  cache bounds, no duplicate queue entries.
- **Schema:** `RecentTrack(guildId, id)` only; verify no accidental migration.
- **Process counters:** no secret data, no unbounded counters or memory retention.
- **Test tooling:** `limits.ts`, soak multi-guild support, no production imports from test code.

**Review output:** a table of finding, severity, file, fix, and evidence. Block on any
correctness/security issue.

### 3.3 Behavioral verification

Use the isolated BotTest instance and test guilds:

- [ ] Session restore after restart: queue, position, volume, loop, autoplay and current track.
- [ ] Queue semantics: play, play-next, skip, previous, pause/resume, stop, loop modes.
- [ ] Playlist load, shuffle-before-load, saved order unchanged.
- [ ] Autoplay on/off and search coalescing; no duplicate tracks.
- [ ] Dashboard owner/admin/DJ/member/outsider permission matrix.
- [ ] Real OAuth login, callback, session cookie, logout.
- [ ] SSE: initial snapshot, guild switch, hidden/visible, logout, expiry, backend outage, reconnect.
- [ ] Audio tap: Listen, Mute, Disconnect, no-listener cleanup, 4-per-guild/16-total limits.
- [ ] 10 audio streams across three guilds; no dashboard or plugin errors.
- [ ] PWA install/service worker; dashboard assets still load when unauthenticated.
- [ ] `timeoutlisteners=0` behavior for test-only unattended players.

**Gate:** every behavioral check either PASS or explicitly waived with a reason and owner.

### 3.4 Schema and production-data audit

- [ ] Back up production SQLite plus WAL/SHM to a timestamped directory outside the repo.
- [ ] Measure production row counts and query plans for `RecentTrack` before/after the index.
- [ ] Dry-run `prisma db push` from the `dev` checkout against a **copy** of the production DB.
- [ ] Verify `PRAGMA index_list('RecentTrack')` contains the new `(guildId, id)` index.
- [ ] Confirm the migration is additive and rollback-safe.
- [ ] Check production disk space, database size, and WAL growth.

**Gate:** a verified backup and a successful dry-run; no production schema command yet.

### 3.5 Operational and security audit

- [ ] Production `.env` key parity against `.env.example`; print key names/booleans only.
- [ ] `PRODUCTION=true`, Node 24, dashboard OAuth callback, sidecar control secret, Lavalink node
      credentials and fallbacks.
- [ ] Dashboard default audio cap remains `1`; test override is absent from production.
- [ ] Remove the temporary OAuth redirect from the production Discord app.
- [ ] Verify no test tunnel, Edge/CDP port, test dashboard, or test bot process is left running.
- [ ] Confirm the Lavalink tap plugin pair (`4.2.2-tap.2` + `0.3.1`) is unchanged; no plugin deploy
      is needed.
- [ ] Check log rotation, pm2 save state, boot script, and rollback path.

## 4. Phase 2 — Performance deep-dive and optimization

**Only after Phase 1 passes.** Each item gets a hypothesis, a measurement, a change, a gate, and a
revert point. Do not bundle candidates.

| Candidate | Evidence to collect first | Decision rule |
|---|---|---|
| Session persistence | writes/bytes per 30 min at 10 players; compare with the pre-change counters if reproducible | Keep if writes fall without restore regressions |
| Scheduler/stats | timer counts, flush duration, transaction rows, event-loop p99 | Keep only if no per-guild timer remains |
| Dashboard cache/SSE | control-read ratio, connected clients, CPU/RSS at 1/10 viewers | Keep current; optimize only if a measured ceiling appears |
| Audio fan-out | CPU/RSS/network at 1/4/10 streams; browser CPU separately | No server rewrite at current load; consider tab-shared audio later |
| Autoplay/search | cache hit rate, Lavalink search count, duplicate-track rate | Keep caches; tune only with a measured miss pattern |
| DB hot paths | query plans and p95 for stats, settings, session, recent-track | Add/retain indexes only when the plan proves a scan |
| Code size | `Dispatcher` 776 lines vs upstream 235; maintenance risk | Refactor only after release unless a measured defect requires it |

### Optimization deliverable

- Before/after table with the exact command, workload, commit, and artifact.
- A short report in `docs/PERFORMANCE_RESULTS.md` (or the existing results section).
- Re-run the 10-player soak if the change touches playback, persistence, timers, schema, or
  dashboard state.
- Revert any change that fails a gate; do not keep complexity for an unmeasured gain.

## 5. Phase 3 — Integration and release candidate

- [ ] Create a temporary integration branch from `dev`.
- [ ] Merge `main` into it, resolve conflicts in favor of the audited architecture, keep newer
      `main` dependency changes, and regenerate `package-lock.json` if needed.
- [ ] Run the full local gate on the integration branch.
- [ ] Push the integration branch and wait for CI.
- [ ] Fast-forward `main` only after review and green CI.
- [ ] Tag or record the release SHA; prepare release notes without exposing test-only settings.
- [ ] Confirm `dev` is not used as the production deploy source.

**Gate:** green CI on the exact `main` SHA and an approved release note.

## 6. Phase 4 — Production rollout

Run only with explicit approval. Use the existing deploy procedure.

1. Stop `DJBoot`.
2. Back up `prisma/*.db*` outside the repo; record the timestamp and sizes.
3. `git fetch origin main && git pull --ff-only origin main` in `/root/Bot`.
4. `PLAN_ONLY=1 bash scripts/boot.sh`; confirm it will install/push/build only where expected.
5. Run the planned boot; verify the schema index and `.boot-state`.
6. Start `DJBoot`; wait for readiness, node connections, slash registration and session restore.
7. Restart `dashboard` if its code changed; verify OAuth login, `/api/state`, SSE and audio tap.
8. `pm2 save`; verify `DJBoot`, `dashboard`, both Lavalink nodes and ports.
9. Monitor for 30 minutes: RSS, heap, event-loop p95/p99, session errors, webhook/command errors,
   dashboard stream count, no rate-limit or tap disconnect storms.

**Rollback:** restore the previous production SHA and the backed-up DB, restart `DJBoot` and
`dashboard`, verify nodes. The additive index is safe to leave in place.

## 7. Phase 5 — Post-deploy

- [ ] Run a production smoke test with a real player and queue.
- [ ] Verify session restore after one controlled restart if safe.
- [ ] Record final production metrics and deployment evidence.
- [ ] Update the wiki/estate notes and release docs.
- [ ] Remove temporary test guilds/servers only after confirming they are not needed.
- [ ] Close the test OAuth redirect and any temporary tunnel.

## 8. Stop conditions

Do not deploy if any of these are true:

- Any `npm test`, build, lint, format, or CI failure on the release SHA.
- A real OAuth, permission, SSE, audio-tap, or session-restore check fails.
- The production DB backup or schema dry-run fails.
- Any secret scan finding is unexplained.
- A behavioral check was skipped without an explicit waiver.
- The release diff contains unreviewed changes.
- The 10-player soak or 10-stream load test regresses after a change.

## 9. Deliverables

1. `docs/PRE_RELEASE_AUDIT.md` — checklist results, findings, evidence, and sign-off.
2. `docs/PERFORMANCE_RESULTS.md` (or an updated results section) — before/after measurements.
3. Green CI run and release SHA.
4. Production backup path and rollback instructions.
5. A short user-facing release note.

**Estimated effort:** 1 focused day for the audit, 0–1 day for any evidence-backed optimization,
30 minutes for rollout plus 30 minutes of monitoring.
