# BootstrapDJ handoff

Updated: **2026-11-12 07:10 UTC**

Workspace: `/home/hermes/projects/Discord/Music Bot`

Repository: `BootstrapBoys/BootstrapDJ` (GPL-3.0, fork of `appujet/lavamusic`)

## Current state

- Working tree: clean on `dev`; `docs/MAINTENANCE_PLAN.md` tracks the pending
  i18n/help/CI/docs work.
- `dev` contains the undeployed feature commit **`eb4953f9`** (`feat: add
  dashboard health and playlist export`); `main`/`origin/main` are at
  **`dd93b937`** (`docs: record backup and ignore hardening`).
- Last production code release: **`c41be815`** (`feat: localize node audit
  notices`). The health/export commit is **not deployed**.
- CI: green on `dev` through the docs cleanup (runs `43170550563`,
  `43171114410`, `43171295788`, `43172472916`, `43173230630`); `dd93b937`
  green on `main`.
- Pending maintenance: phases 1–3 of `docs/MAINTENANCE_PLAN.md` (option
  localization, help UX, CI guardrails); phase 4 is complete after the docs
  cleanup and count refresh. Ops hardening is deployed; the health/export
  feature is implemented on `dev` but not deployed.
- Production `/root/Bot`: HEAD **`dd93b937`** (docs/ops only), runtime code
  **`c41be815`** in `.boot-state`. No restart after these commits.
- Automatic DB backups: `bootstrapdj-db-backup.timer` runs daily at 04:15 UTC
  (persistent, randomized); integrity-checked copies under
  `/root/BotDBBackups/auto-*`, 14 kept. Env backups moved to
  `/root/BotEnvBackups` (mode 600).
- Production services: `DJBoot`, `dashboard`, `Lavalink`, `Lavalink-Backup`,
  `earl-listener`, `whisper-tiny`, `whisper-base` online.
- Dashboard: `0.0.0.0:8795`, control `127.0.0.1:8797`; control
  `/internal/metrics` **200**, public `/` and `/api/state` **401** without a
  session. `/health` is added on `dev` but is not in production yet.
- Discord global command registration: **74** commands, including `language`
  and `playlocal`.
- Production DB backup from this deploy:
  `/root/BotDBBackups/20261112T030746Z` (DB, WAL, SHM).

## What shipped to production

The long-tail i18n release is complete:

- 16 locales: `en-US`, `en-GB`, `de`, `es-ES`, `fr`, `id`, `it`, `ja`, `ko`,
  `nl`, `pl`, `pt-BR`, `ru`, `tr`, `zh-CN`, `zh-TW`.
- `/language` and `/settings language` provide per-guild selection;
  `DEFAULT_LANGUAGE` is the fallback (`en-US` by default).
- Commands, buttons, playback notices, dashboard chrome/settings/statistics/
  playlists, playback-limit messages, guild notices, and Lavalink node audit
  messages are catalog-backed.
- The former `TrackStart` `"Now Playing"` sentinel was replaced by translated
  author lookup, so stale-panel cleanup works in every locale.
- `/playlocal` is attachment-only (Discord audio/video, 25 MB, MIME-gated) and
  plays through the existing Lavalink `http` source. The node has no `local`
  source manager.
- README now documents 74 commands, `/language`, `/playlocal`, the 16 locales,
  and the community translation path.

AI-translated catalogs retain the exact top-level note:

```text
**AI Translated, awaiting native translation**
```

Native corrections are community work on GitHub via
`.github/ISSUE_TEMPLATE/translation.yml` or locale-only PRs. Do not block a
release on an internal native-review pass.

## Pending release on `dev` (not deployed)

`eb4953f9` adds two user-facing features; they are built, tested and pushed to
`dev`, but are not on `main` or in production:

- **`GET /health`** — public readiness probe. Returns `200` only when the
  gateway is ready, at least one Lavalink node reports state 1 and SQLite
  answers `SELECT 1`; otherwise `503`. The payload is counts/booleans only
  (uptime, guilds, players, connected/total nodes, database) with no guild ids,
  user ids, node names or credentials. Works in embedded and sidecar mode; the
  sidecar uses the authenticated `/internal/health` control route.
- **`/playlist export`** — new `export` action on `/playlist` (prefix aliases
  included). Produces a versioned `application/json` attachment
  (`format: bootstrapdj-playlist`, `version: 1`) with the stored track payloads,
  order preserved and legacy array rows handled. Unreadable entries are skipped
  and counted; the file is capped at 24 MB. Responses are translated in all 16
  locales.

The `/health` route sits behind the existing read rate limiter and sends
`cache-control: no-store`; export attachment names are sanitized and oversized
documents are refused before the Discord upload.

Helper: `src/lib/PlaylistExport.ts`; tests:
`tests/playlist-export.test.mjs`, `tests/dashboard-health.test.mjs`.

## Ops hardening

- `.gitignore` now covers `.env.*` (except `.env.example`), `DJBoot.sh*`, and
  `prisma/*.db*`, so env backups, launcher backups, and SQLite WAL/SHM files
  cannot be staged by a bulk add.
- `scripts/backup-db.py` uses SQLite's online backup API, checks integrity
  before publishing, writes mode-600 copies, and prunes only its own `auto-*`
  directories. `docs/STORAGE.md` documents the timer and the restore test.
- The service was exercised on production; the backup copy matched the live
  database across all 30 application tables and passed `foreign_key_check`.

## Docs cleanup

- Removed nine completed rewrite/staging plans in the first pass:
  `BUG_HUNT_FINDINGS`, `FULL_REWRITE_PLAN`, `OPTIMIZATION_AND_BUG_HUNT_PLAN`,
  `OPTIMIZATION_BASELINE`, `PLAYLIST_ORDER_PLAN`, `REWRITE_AUDIT`,
  `REWRITE_PLAN`, `STAGING_TEST_PLAN`, `STAGING_TEST_RESULTS`.
- Removed the eleven remaining release/parity/feature plans in the second pass:
  `JOCKIE_PARITY`, `PARITY_WORKFLOW`, `PRE_RELEASE_AUDIT`,
  `PRE_RELEASE_AUDIT_PLAN`, `I18N_AND_PLAYLOCAL_PLAN`,
  `LONGTAIL_I18N_WORKFLOW`, `UPSTREAM_4.2-4.7_REVIEW`,
  `UPSTREAM_PARITY_AUDIT`, `AUDIO_TAP_PLAN`, `AUTOMATED_TESTING_PLAN`,
  `PERFORMANCE_PLAN`.
- Inbound links were updated; the 10-stage staging matrix was preserved in the
  maintenance skill's `references/staging-and-failover.md`, and the performance
  evidence was carried into this handoff.
- `docs/MAINTENANCE_PLAN.md` phase 4 is complete after the count refresh;
  `docs/` contains current references only.

## Verification

Latest full local gate (`eb4953f9` code, re-run at `7e9dbfdb`, 2026-11-12):

- `npm run i18n:validate`: 16 locales valid
- `npm test`: **454/454**
- Coverage: **76.06% lines / 80.70% functions / 70.92% branches**
- `npm run format`, `npm run lint`, `npm run build`: clean
- CI: green on `dev` for `eb4953f9` (run `43170550563`); `main` green for
  `dd93b937`
- Production API/registration checks passed at `c41be815`.

No live Discord slash/button pass and no live browser/dashboard visual pass were
run for this release. The new `/health` and `/playlist export` paths are
unit-tested but have not run on a live bot; they are not deployed.

### Performance evidence

- 10-player / 30-minute BotTest soak **PASS** on `1252b093`: 120 samples, 10
  players present in every sample, 30/30 workload commands, 0 crashes, 0
  workload failures, RSS growth -1.11%, heap growth 9.45%, event-loop p99
  22.41 ms, max 32.95 ms, max queue depth 6. Artifact:
  `/root/BotBunTest/artifacts/soak/2026-11-11T09-47-32-981Z`.
- 10 dashboard audio streams across three players (4 + 4 + 2), 10 active tap
  listeners, no `429`s.

## Open items

- Merge `dev` to `main` and deploy only when the user asks. After deploying
  `eb4953f9`, smoke `GET /health` (200; 503 with a node stopped) and
  `/playlist export` (download and parse the attachment; empty playlist case).
- Optional live acceptance: language switching, localized command replies,
  dashboard locale switch, and a real playback smoke test.
- Native translation review is crowd-sourced on GitHub; not tracked as a local
  task.
- Internal-only diagnostics and brand/technical tokens still do not need
  translation (for example `BootstrapDJ`, stored option values, internal logger
  prefixes). User-facing BotLog/embed surfaces are catalog-backed.

## Next-chat runbook

1. Read `README.md`, `docs/I18N.md`, `docs/PLAYBACK_ARCHITECTURE.md`, and
   `docs/MAINTENANCE_PLAN.md`.
2. Check `git branch --show-current`, `git status`, and the latest CI before
   editing. `dev` carries the undeployed feature commit; use `dev` for changes
   and merge to `main` only when asked.
3. Standard gate:

   ```bash
   npm run i18n:validate
   npm run format
   npm run lint
   npm run build
   npm test
   npm run test:coverage
   ```

4. i18n changes use root `locales/<locale>/` and the `longtail` namespace.
   Domain batches write an English fragment under
   `/home/hermes/.hermes/cache/scratch/i18n-fragments/`, then:

   ```bash
   npm run i18n:merge
   npm run i18n:validate
   ```

   Never let parallel agents edit shared locale files. Translate only the new
   keys and preserve `_meta.note`.

5. Production deploy is explicit-request only. Standing rule: do not update the
   active bot unless testing or the user asks to deploy. The pending health/export
   work is on `dev`; merge `dev` into `main` first when deploying it. Deploy
   procedure is in the `discord-music-bot-maintenance` skill at
   `references/deploy-host.md`: stop `DJBoot`/`dashboard`, back up
   `prisma/*.db*`, `git pull --ff-only origin main`, run
   `PLAN_ONLY=1 bash scripts/boot.sh`, start/restart, then verify readiness,
   Lavalink nodes, dashboard HTTP auth, and Discord command count. Never print
   tokens or control secrets.
6. Rollback target for the pre-i18n runtime was `4a70708d`; restore the DB backup
   only if a migration/data change caused the failure.

## Key files

- `README.md` — user-facing feature, command and language documentation
- `docs/I18N.md` — catalogs, validator, community translation policy
- `docs/PLAYBACK_ARCHITECTURE.md` — playback core module map and teardown order
- `docs/STORAGE.md` — SQLite WAL, retention and backup policy
- `docs/DASHBOARD_OAUTH.md` — dashboard login and authorization model
- `docs/MAINTENANCE_PLAN.md` — pending i18n metadata, help UX, CI and doc-truth plan
- `src/lib/i18n.ts` — i18next initialization and supported locales
- `src/lib/i18nContext.ts` — `tr(ctx, key, vars)` command helper
- `src/dashboard/browser.ts` / `src/dashboard/page.ts` — localized dashboard
- `src/dashboard/health.ts` / `src/dashboard/server.ts` — public `/health`
  readiness probe (embedded and sidecar)
- `src/lib/PlaylistExport.ts` / `src/commands/manage/Collection.ts` — playlist
  JSON export
- `tests/dashboard-health.test.mjs`, `tests/playlist-export.test.mjs` — new
  feature gates
- `src/lib/GuildNotice.ts`, `src/events/player/Node*.ts` — localized notices
- `src/core/player/SessionRestorer.ts` — translated now-playing cleanup
- `locales/` — 16 locale directories; `longtail.json` is the migration lane
- `tooling/i18n-validate.mjs` / `tooling/i18n-merge-fragments.mjs` — gates and
  fragment merge
- `.github/ISSUE_TEMPLATE/translation.yml` — community correction form
