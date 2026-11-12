# BootstrapDJ handoff

Updated: **2026-11-12 21:55 UTC**

Workspace: `/home/hermes/projects/Discord/Music Bot`

Repository: `BootstrapBoys/BootstrapDJ` (GPL-3.0, fork of `appujet/lavamusic`)

## Current state

- Working tree: clean on `dev`; `docs/MAINTENANCE_PLAN.md` records the
  completed maintenance plan (phases 0–5).
- `dev`, `main` and `origin/main` are in sync at **`30d38609`** (`docs:
  record live BotTest acceptance results`), a 14-commit fast-forward from
  `dd93b937` carrying `eb4953f9` (dashboard health + playlist export) and the
  phase 0-5 maintenance work.
- Last production code release: **`30d38609`**, deployed 2026-11-12 21:54
  UTC (previous runtime `c41be815`).
- CI: green on `30d38609` (run `43314095973`); earlier heads `ddf195b4`
  (run `43178687504`) and `8011257f` (run `43179434673`) were green too.
- Maintenance: phases 0–5 are complete on `dev` — option localization
  `b02e889b`, help UX `bd43d0b7`, CI guardrails `ddf195b4`, doc truth
  `6b59f4e4`/`65590d39`/`dd8742a6`, final gate recorded in the plan.
- Live acceptance ran on the disposable BotTest staging checkout (not
  production) at `8011257f` on 2026-11-12: guild language switching via
  `/language` and `/settings language` (`de`, `fr`, back to `en-US`), localized
  replies/help/autocomplete, a real join/play/queue/skip/leave smoke in French
  and German including now-playing panel cleanup, and the dashboard locale
  following the guild setting (`fr` → `en-US` → `de` → `en-US`). Evidence:
  kanban task `t_6a2ba550`. That run performed no merge or deploy.
- Production `/root/Bot`: runtime code **`30d38609`** in `.boot-state`
  (`booted=2026-11-12T21:54:07+00:00`). The checkout pulls `main`; this
  release-record commit is docs-only, so HEAD can read one commit ahead of the
  runtime.
- Automatic DB backups: `bootstrapdj-db-backup.timer` runs daily at 04:15 UTC
  (persistent, randomized); integrity-checked copies under
  `/root/BotDBBackups/auto-*`, 14 kept. Env backups moved to
  `/root/BotEnvBackups` (mode 600).
- Production services: `DJBoot`, `dashboard`, `Lavalink`, `Lavalink-Backup`,
  `earl-listener`, `whisper-tiny`, `whisper-base` online.
- Dashboard: `0.0.0.0:8795`, control `127.0.0.1:8797`; control
  `/internal/metrics` **200**, public `/` and `/api/state` **401** without a
  session. `/health` is live and returns **200** (`botReady`/`database` true,
  2/2 Lavalink nodes).
- Discord global command registration: **74** commands, including `language`
  and `playlocal`.
- Production DB backup from this deploy:
  `/root/BotDBBackups/20261112T215356Z` (DB, WAL, SHM).

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

## Shipped in `30d38609` (deployed 2026-11-12)

`eb4953f9` adds two user-facing features; they were built and tested on `dev`,
merged to `main` and are now live:

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

The maintenance work shipped in the same deploy: `b02e889b` (localized
option descriptions), `bd43d0b7` (`/help` UX and autocomplete) and `ddf195b4`
(CI guardrails, which only affects CI).

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
- `docs/MAINTENANCE_PLAN.md` phases 0–5 are complete, including the phase 5
  gate record; `docs/` contains current references only.

## Verification

Latest full local gate (2026-11-12, `dev` at **`ddf195b4`**, clean tree, Node
22.23.4, npm 12.2.1):

- `npm run i18n:validate`: 16 locales valid (`de`, `en-GB`, `en-US`, `es-ES`,
  `fr`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt-BR`, `ru`, `tr`, `zh-CN`,
  `zh-TW`)
- `npm run format`, `npm run lint`, `npm run build`: clean
- `npm test`: **471/471** pass, 0 fail, 0 skipped
- `npm run test:coverage`: **471/471** pass with source-only coverage
  **67.02% lines / 73.14% branches / 57.29% functions**, against enforced
  floors of 66 / 56 / 72
- `git diff --check`: clean
- CI: green on `dev` for `ddf195b4` (run `43178687504`) with the new
  `npm audit --omit=dev --audit-level=high` step reporting 0 vulnerabilities
  and the coverage floors active; `main` green for `30d38609` (run
  `43314095973`)
- Production API/registration checks passed at `30d38609` after the deploy.

### Production deploy record (2026-11-12 21:54 UTC)

- Deployed `30d38609` on `main` (fast-forward from `dd93b937`); rollback
  target `dd93b937` (runtime `c41be815`).
- `PLAN_ONLY=1 bash scripts/boot.sh` planned a clean build only: no `npm ci`
  (lockfile unchanged) and no `prisma generate`/`db push` (schema unchanged).
- DB backed up before the pull to `/root/BotDBBackups/20261112T215356Z`
  (`bootstrapdj.db`, `-wal`, `-shm`).
- New process anchored to `.boot-state` `commit=30d38609` /
  `booted=2026-11-12T21:54:07+00:00`; boot log shows `Shard 0 connected to
  Discord's Gateway.` (21:54:09), `Bootstrap DJ#8001 is ready!` (21:54:09),
  `Lavalink node "Bootstrap Node" is ready!` (21:54:10), `standby node
  "local-backup" is ready` (21:54:10) and `Successfully loaded slash commands`
  (21:54:11).
- `GET /health` returned **200** with `botReady:true`, `database:true`,
  `nodes:{connected:2,total:2}`; `/` and `/api/state` returned **401**;
  control `/internal/metrics` returned **200**.
- Discord global commands: **74** (`language`, `playlocal`, `playlist`, `help`
  present); no `GUILD_ID`, so registration is global.
- Services online after `pm2 save`: `DJBoot`, `dashboard`, `Lavalink`,
  `Lavalink-Backup`, `earl-listener`, `whisper-tiny`, `whisper-base`.

Coverage is measured with `--test-coverage-exclude='**/*.test.mjs'`, so the
percentage covers `src/` only. The earlier **76.06 / 80.70 / 70.92** figure
included test files and had its columns labelled in the wrong order — in
line / branch / funcs order it reads 76.06 lines, 80.70 branches, 70.92
functions — so it is not comparable to this number. Floors sit ~1pp below the
measured values; raising the line floor to 99 exits 1, so the gate does fail on
a drop.

Test count moved from the 454 baseline to 471 with phases 1–2: new
`tests/command-metadata.test.mjs` (5) and `tests/help.test.mjs` (6), plus five
help/autocomplete cases in `tests/autocomplete.test.mjs` and one help-option
case in `tests/commands.test.mjs`.

Live Discord acceptance ran on the disposable BotTest staging checkout at
`8011257f` (2026-11-12): `/language` and `/settings language` switched the guild
to `de`, `fr` and back to `en-US`; replies, the localized `/help` menu, `/help
play` and its autocomplete render correctly in German; the REST payload exposes
16 locale descriptions on `/filter`, `/setup`, `/language` and `/help` options
(74/74 commands have `description_localizations` when requested with
`?with_localizations=true`). A real join/play/queue/skip/leave smoke ran in
French and German, and the now-playing panel was removed on skip/leave in both
locales, which exercises the translated author lookup that replaced the old
`"Now Playing"` sentinel. The dashboard chrome, settings and statistics pages
followed `fr`, `en-US` and `de` on the same instance. The `/health` and
`/playlist export` paths were unit-tested only at that time; `/health` has
since been verified live on production (200, 2/2 nodes), while `/playlist
export` still has no live run.

### Performance evidence

- 10-player / 30-minute BotTest soak **PASS** on `1252b093`: 120 samples, 10
  players present in every sample, 30/30 workload commands, 0 crashes, 0
  workload failures, RSS growth -1.11%, heap growth 9.45%, event-loop p99
  22.41 ms, max 32.95 ms, max queue depth 6. Artifact:
  `/root/BotBunTest/artifacts/soak/2026-11-11T09-47-32-981Z`.
- 10 dashboard audio streams across three players (4 + 4 + 2), 10 active tap
  listeners, no `429`s.

## Open items

- Deployed on 2026-11-12. Remaining live smoke: `/playlist export` (download
  and parse the attachment; empty playlist case) needs a Discord user session,
  and the `/health` 503 path was not exercised on production because it
  requires stopping both Lavalink nodes.
- Live acceptance for the maintenance work is **done on BotTest** at `8011257f`
  (see *Verification evidence* above and kanban task `t_6a2ba550`): localized
  option descriptions on `/filter`/`/setup`, `/help` and `/help play` in `de`,
  help autocomplete from Discord, 74 commands registered with no Discord 400,
  guild language switching, dashboard locale switching and a real playback
  smoke in non-English locales. Re-run it only after new locale-visible code.
- `.github/dependabot.yml` has no on-demand validation trigger; the first
  scheduled weekly run is the remaining proof that GitHub accepts it.
- Native translation review is crowd-sourced on GitHub; not tracked as a local
  task.
- Internal-only diagnostics and brand/technical tokens still do not need
  translation (for example `BootstrapDJ`, stored option values, internal logger
  prefixes). User-facing BotLog/embed surfaces are catalog-backed.

## Next-chat runbook

1. Read `README.md`, `docs/I18N.md`, `docs/PLAYBACK_ARCHITECTURE.md`, and
   `docs/MAINTENANCE_PLAN.md`.
2. Check `git branch --show-current`, `git status`, and the latest CI before
   editing. `dev` and `main` are in sync at `30d38609` (deployed); use `dev`
   for changes and merge to `main` only when asked.
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
   active bot unless testing or the user asks to deploy. The pending
   health/export and maintenance work is on `dev`; merge `dev` into `main` first
   when deploying it. Deploy
   procedure is in the `discord-music-bot-maintenance` skill at
   `references/deploy-host.md`: stop `DJBoot`/`dashboard`, back up
   `prisma/*.db*`, `git pull --ff-only origin main`, run
   `PLAN_ONLY=1 bash scripts/boot.sh`, start/restart, then verify readiness,
   Lavalink nodes, dashboard HTTP auth, and Discord command count. Never print
   tokens or control secrets.
6. Rollback target for this deploy is `dd93b937` (runtime `c41be815`); the
   pre-i18n runtime was `4a70708d`. Restore the DB backup only if a
   migration/data change caused the failure.

## Key files

- `README.md` — user-facing feature, command and language documentation
- `docs/I18N.md` — catalogs, validator, community translation policy
- `docs/PLAYBACK_ARCHITECTURE.md` — playback core module map and teardown order
- `docs/STORAGE.md` — SQLite WAL, retention and backup policy
- `docs/DASHBOARD_OAUTH.md` — dashboard login and authorization model
- `docs/MAINTENANCE_PLAN.md` — completed maintenance plan with the phase 0–5
  gate record
- `src/lib/i18n.ts` — i18next initialization and supported locales
- `src/lib/i18nContext.ts` — `tr(ctx, key, vars)` command helper
- `src/dashboard/browser.ts` / `src/dashboard/page.ts` — localized dashboard
- `src/dashboard/health.ts` / `src/dashboard/server.ts` — public `/health`
  readiness probe (embedded and sidecar)
- `src/lib/PlaylistExport.ts` / `src/commands/manage/Collection.ts` — playlist
  JSON export
- `tests/dashboard-health.test.mjs`, `tests/playlist-export.test.mjs` — new
  feature gates
- `tests/command-metadata.test.mjs` — slash-command localization payload
  (snake_case keys, subcommand recursion, choices)
- `tests/help.test.mjs` — localized help details, alias resolution,
  developer-command refusal
- `.github/workflows/ci.yml`, `.github/dependabot.yml` — dependency audit,
  coverage floors, weekly dependency updates
- `src/lib/GuildNotice.ts`, `src/events/player/Node*.ts` — localized notices
- `src/core/player/SessionRestorer.ts` — translated now-playing cleanup
- `locales/` — 16 locale directories; `longtail.json` is the migration lane
- `tooling/i18n-validate.mjs` / `tooling/i18n-merge-fragments.mjs` — gates and
  fragment merge
- `.github/ISSUE_TEMPLATE/translation.yml` — community correction form
