# Pre-release audit report

**Candidate:** `dev` at `35de1d9e`<br>
**Audit date:** 2026-11-11<br>
**Production baseline:** `main` / `/root/Bot` at `dfd7ccb`<br>
**Production status:** `DJBoot`, `dashboard`, `Lavalink`, and `Lavalink-Backup` online; no deploy<br>
**Scope:** `main..dev`, 29 commits, 35 files (performance, dashboard SSE/cache, audio-stream test
control, soak tooling, schema index, documentation)<br>
**Overall result:** **conditional pass** — no remaining source blocker found; one historical
credential finding and a required post-fix re-soak remain open.

## 1. Static and repository gates

| Check | Result | Evidence |
|---|---|---|
| Working tree clean | PASS | `git status` clean; only ignored local `.env` present |
| `npm run format` | PASS | Prettier check completed |
| `npm run lint` | PASS | Oxlint exit 0 |
| `npm run build` | PASS | `tsc --project tsconfig.json` exit 0 |
| `npm test` | PASS | **425/425** |
| Coverage | PASS (target 75% lines) | **76.04% lines**, 80.40% functions, 70.35% branches |
| `npm audit --omit=dev` | PASS | 0 production vulnerabilities (276 dependencies) |
| `git diff --check` | PASS | no whitespace errors |
| Tracked `.env`/DB check | PASS | no `.env`, SQLite DB, token or secret file tracked |
| Current release diff secret scan | PASS | gitleaks `main..dev`: no leaks |
| Full-history secret scan | **OPEN** | 5 historical findings, detailed in §3 |
| Local Node version | NOTE | local audit ran Node 22; CI uses Node 24 and is the release runtime |

## 2. Schema and production-data dry run

Production DB was copied with SQLite backup to a timestamped audit directory; no production write
occurred.

- `RecentTrack` rows before: **61**
- Indexes before: `RecentTrack_guildId_playedAt_idx`
- `prisma db push` against the copy: **in sync**
- Indexes after: `RecentTrack_guildId_id_idx`, `RecentTrack_guildId_playedAt_idx`
- Row count after: **61**
- Result: additive, rollback-safe; the copy will be removed after this audit.

## 3. Security findings

### 3.1 Historical 2021 client secret — RESOLVED

`gitleaks` found two matching **32-character hexadecimal `clientSecret`** values in the 2021
`config.json` and `README.md` commits (`077f4a5302ba`, `f4bb0fea2fbb`). The files are removed from
the current tree, and the value does **not** match any current production `.env` value. Production
currently has no Spotify key configured.

The credential owner confirmed the application was deleted and the token revoked. No Git history
rewrite is needed for this audit. The three `curl-auth-header` findings are the upstream
`youshallnotpass` placeholders in removed Docker files. No current release diff leaks were found.

### 3.2 Local `.env` — controlled

The local ignored `.env` is not tracked, but was group-readable. Permissions were tightened to
**600**. It is not part of the release artifact.

### 3.3 OAuth and dashboard

- Production OAuth keys are configured; `PRODUCTION` parses as true.
- `DASHBOARD_MAX_AUDIO_STREAMS_PER_USER` is absent in production, so the default **1** applies.
- The temporary test OAuth redirect still needs removal from the Discord app by the user.
- No test tunnel, test bot, or test dashboard remains running.

## 4. Code review findings

### Fixed before release

1. **`PlaybackEngine.persist()` shutdown race** — a queued caller previously received the older
   in-flight promise, so shutdown could exit before the latest snapshot was written. Changed the
   queued caller to wait for the follow-up write; added a regression test. Commit `0f4ef3f5`.
2. **Listener stats loss on DB error** — pending rows were cleared before the batch write and
   dropped when the transaction failed. Failed rows are now requeued; added a regression test.
   Commit `35de1d9e`.

### Remaining minor / decision items

- **SSE permission revocation:** `/api/events` checks guild membership at connect, but does not
  periodically re-check access after a member is removed. Session expiry and logout are covered.
  Decide whether to add a 60-second access revalidation before release (small security improvement,
  extra control reads) or accept the session-lifetime window.
- Audio-cap rejection text still says “Only one audio stream per dashboard user” even when the
  test-only limit is greater than one. Cosmetic; fix when touching that route.
- `PlaybackTimers` still carries unused `persist`/`stats` fields after scheduling moved to the
  process scheduler. Cleanup only; no behavior impact.
- Local audit Node was 22; CI release runtime is Node 24. CI is the authoritative runtime gate.

## 5. Behavioral evidence

Previously verified on the same performance code path:

- Real Discord OAuth login and callback as `zebz213` (owner).
- Owner/admin/DJ/member/outsider permission matrix.
- SSE initial snapshot, guild switch, hidden-tab pause/resume, logout teardown, session expiry,
  backend outage fallback.
- 10 dashboard audio streams across three players (4 + 4 + 2), 10 active tap listeners, no `429`s.
- 10-player / 30-minute BotTest soak PASS: 120 samples, RSS growth 1.13%, heap growth 10.22%,
  event-loop p99 22.07 ms, max 42.57 ms, max queue depth 47, 0 crashes, 30/30 workload commands.

**Required after the two fixes:** re-run the 10-player / 30-minute soak on the new candidate before
merge. The earlier soak predates `0f4ef3f5` and `35de1d9e`; unit tests alone do not replace it.

## 6. Production configuration audit

- `PRODUCTION` parses true.
- Dashboard OAuth client/redirect/session settings are present.
- Per-user audio limit is not overridden; production default is 1.
- No production deploy or restart was performed.
- Lavalink tap plugin pair remains unchanged; no plugin deploy is part of this release.
- Production DB backup and schema dry-run completed; actual production backup remains a deploy
  prerequisite.

## 7. Release recommendation

**Do not merge/deploy yet.** Complete these gates in order:

1. ~~Rotate/revoke the historical Spotify credential~~ — resolved; app deleted and token revoked.
2. Re-run the **10-player, 30-minute soak** on `35de1d9e` (deferred by user).
3. Decide whether SSE permission revalidation is required before release.
4. Remove the temporary Discord OAuth redirect (done).
5. Create the integration branch, merge `main`, run the full gate and CI, then follow the production
   rollout procedure in `docs/PRE_RELEASE_AUDIT_PLAN.md`.

No source-level correctness blocker remains in the reviewed diff. The release is gated by the
open security decision and the post-fix soak.
