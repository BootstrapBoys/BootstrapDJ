# BootstrapDJ handoff

Updated: **2026-11-12 UTC**  
Workspace: `/home/hermes/projects/Discord/Music Bot`  
Repository: `BootstrapBoys/BootstrapDJ` (GPL-3.0, fork of `appujet/lavamusic`)

## Current state

- Working tree: clean on `dev`.
- `dev` and `main`: both at **`7b87bfa5`** (`docs: update readme for i18n release`).
- Last code release: **`c41be815`** (`feat: localize node audit notices`).
- Latest CI: green for `7b87bfa5` on `main`; `dev` matched.
- Production `/root/Bot`: HEAD **`7b87bfa5`**, runtime code **`c41be815`** in
  `.boot-state`. The difference is docs and README only; no restart after the
  docs commits.
- Production services: `DJBoot`, `dashboard`, `Lavalink`, `Lavalink-Backup`,
  `earl-listener`, `whisper-tiny`, `whisper-base` online.
- Dashboard: `0.0.0.0:8795`, control `127.0.0.1:8797`; control
  `/internal/metrics` **200**, public `/` and `/api/state` **401** without a
  session.
- Discord global command registration: **74** commands, including `language`
  and `playlocal`.
- Production DB backup from this deploy:
  `/root/BotDBBackups/20261112T030746Z` (DB, WAL, SHM).

## What shipped

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

## Verification

Last full local gate (code commit `c41be815`, before docs-only commits):

- `npm run i18n:validate`: 16 locales valid
- `npm test`: **447/447**
- Coverage: **75.93% lines / 80.52% functions / 70.78% branches**
- `npm run format`, `npm run lint`, `npm run build`: clean
- CI: green on `main` for `7b87bfa5` (docs-only change after the code release)
- Production API/registration checks passed.

No live Discord slash/button pass and no live browser/dashboard visual pass were
run for this release.

## Open items

- Optional live acceptance: language switching, localized command replies,
  dashboard locale switch, and a real playback smoke test.
- Native translation review is crowd-sourced on GitHub; not tracked as a local
  task.
- Internal-only diagnostics and brand/technical tokens still do not need
  translation (for example `BootstrapDJ`, stored option values, internal logger
  prefixes). User-facing BotLog/embed surfaces are catalog-backed.

## Next-chat runbook

1. Read `README.md`, `docs/I18N.md`, `docs/LONGTAIL_I18N_WORKFLOW.md`, and
   `docs/PARITY_WORKFLOW.md`.
2. Check `git branch --show-current`, `git status`, and the latest CI before
   editing. Use `dev` for changes; merge to `main` only when asked.
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
   active bot unless testing or the user asks to deploy. Deploy procedure is in
   the `discord-music-bot-maintenance` skill at
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
- `docs/LONGTAIL_I18N_WORKFLOW.md` — domain batch history and final gate
- `docs/PARITY_WORKFLOW.md` — release and production deployment record
- `src/lib/i18n.ts` — i18next initialization and supported locales
- `src/lib/i18nContext.ts` — `tr(ctx, key, vars)` command helper
- `src/dashboard/browser.ts` / `src/dashboard/page.ts` — localized dashboard
- `src/lib/GuildNotice.ts`, `src/events/player/Node*.ts` — localized notices
- `src/core/player/SessionRestorer.ts` — translated now-playing cleanup
- `locales/` — 16 locale directories; `longtail.json` is the migration lane
- `tooling/i18n-validate.mjs` / `tooling/i18n-merge-fragments.mjs` — gates and
  fragment merge
- `.github/ISSUE_TEMPLATE/translation.yml` — community correction form
