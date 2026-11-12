# BootstrapDJ maintenance plan: i18n metadata, help UX, CI guardrails, doc truth

Status: **complete — phases 0–5 executed on `dev`**
Created: 2026-11-12
Baseline: `dev` after `eb4953f9`; 454/454 tests at `7e9dbfdb`
Final gate: `dev` at `ddf195b4`; 471/471 tests, 67.02% lines / 73.14% branches /
57.29% functions (source-only coverage)
Scope: selected items 3–6 from the 2026-11-12 fresh-eyes review.
Already completed outside this plan: the `.env`/SQLite `.gitignore` hardening
and the daily DB backup timer are on `main`/production; `GET /health` and
`/playlist export` are implemented on `dev` but not deployed.

## Assumptions

- Work on `dev`, one commit per phase, with the full gate after each phase.
- `dev` is currently ahead of `main` and carries the undeployed `eb4953f9`
  health/export feature; do not merge or deploy it as part of this plan.
- Merge to `main` and production deploys are explicit-request only.
- New tests change the final test count; update docs in Phase 5 with the real
  number, not the current 454.

## Phase summary

| Phase | Work | Status |
| --- | --- | --- |
| 0 | Baseline and gate | Done — clean `dev`, 454/454 tests at `7e9dbfdb` |
| 1 | Localize slash-command option descriptions | Done — `b02e889b` |
| 2 | Help UX: localization, field trimming, autocomplete | Done — `bd43d0b7` |
| 3 | CI: Dependabot, dependency audit, coverage floors | Done — `ddf195b4` |
| 4 | Doc truth: remove completed plans; fix current counts | Done — 20 historical docs deleted; counts refreshed (`6b59f4e4`, `65590d39`, `dd8742a6`) |
| 5 | Final gate and verification | Done — 471/471 tests, 67.02 / 73.14 / 57.29 coverage, CI `43178687504` green |

## Phase 0 — Baseline

- [x] Confirm `git branch --show-current` is `dev` and the tree is clean.
- [x] Confirm `git log -1` includes the handoff/plan docs above the undeployed
      `eb4953f9` feature commit.
- [x] Run `npm run format`, `npm run lint`, `npm run build`, and `npm test`;
      record the current baseline (454/454 at `7e9dbfdb`).
- [x] Run `npm run i18n:validate`.
- [x] Confirm every `locales/*/commands.json` still has its `metadata` block.

## Phase 1 — Slash-command option localization

**Goal:** every command and option description that exists in the catalogs
reaches Discord in all supported locales.

**Files:** `src/lib/commandMetadata.ts`, `src/lib/CommandManager.ts`,
`tests/commands.test.mjs` or a new `tests/command-metadata.test.mjs`.

The one-line intent hides a type-shape trap: `Command.options` uses discord.js's
camelCase `descriptionLocalizations`, while the REST body needs snake_case
`description_localizations`. Assigning only the camelCase field leaves Discord
ignoring it; assigning only the snake_case field does not type-check.

- [x] Make `applyCommandMetadata` recurse through `option.options` for
      subcommands.
- [x] Set `option.descriptionLocalizations = localizedDescriptions(key)` for
      every option with a catalog entry.
- [x] Replace the raw `command.options as SlashBody['options']` cast in
      `CommandManager.register` with a pure `toApiOptions()` mapper that:
      - renames `descriptionLocalizations` → `description_localizations`
      - renames `nameLocalizations` → `name_localizations`
      - maps choice `nameLocalizations` the same way
      - recurses into subcommand options
      - strips camelCase keys from the payload
- [x] Export `toApiOptions` for a direct unit test; keep zero `any` and
      `@ts-ignore`.
- [x] Tests:
      - `/filter` options get `description_localizations.de/fr/ja`, and the
        values differ from English.
      - `/setup` subcommands (`create`, `delete`, `info`) get localized
        descriptions.
      - The serialized body contains `description_localizations`, never
        `descriptionLocalizations`.
      - Existing command/alias collision and defer tests still pass.

**Acceptance:** build, tests, and locale validation green; a BotTest
registration still reports 74 commands with no Discord 400.

Met in `b02e889b` (gate green, `tests/command-metadata.test.mjs` pins the
payload) and on the disposable BotTest application at `8011257f` on 2026-11-12:
74 commands registered, no Discord 400, and 16-locale `description_localizations`
on every command and option (see *Optional BotTest verification*).

**Commit:** `fix(i18n): localize slash-command option descriptions`

## Phase 2 — Help UX

**Goal:** `/help` is localized, shows user-facing information, and lets users
pick a command instead of typing its exact name.

**Files:** `src/commands/tools/Help.ts`,
`src/events/client/InteractionCreate.ts`, `tests/commands.test.mjs`,
`tests/autocomplete.test.mjs`, new `tests/help.test.mjs`.

- [x] Translate the detail description with
      `tr(ctx, \`commands:metadata.${command.name}.description\`)`, falling
      back to `command.description.content` when the key is missing.
- [x] Trim the detail rows to user-facing facts:
      - keep description, usage, examples, aliases, cooldown, and required
        user permissions
      - show voice, DJ, and active-player requirements only when true
      - hide bot permissions, category, `args`, `slashCommand`, and
        DJ-permission internals
      - show developer-only fields only to owners via `isOwner`
- [x] Resolve aliases in `run`:
      `client.commands.get(query) ?? client.commands.get(client.aliases.get(query))`.
- [x] Refuse developer-only commands to non-owners instead of describing them.
- [x] Add `autocomplete: true` to the `command` option.
- [x] Add a `help`/`command` branch in
      `InteractionCreate.autocompleteChoices`:
      - canonical command names only, filtered by the typed query
      - exclude `dev` commands for non-owners
      - prefix matches first, then alphabetical; cap at 25
      - answer `[]` on every failure or empty path
- [x] Tests:
      - the `Help` command option has autocomplete enabled
      - `help`/`command` autocomplete returns `play` for `pl`, is capped, and
        hides owner commands
      - an unknown query returns `[]`
      - German `details()` shows the German description and omits the
        bot-permission and developer-only labels

**Acceptance:** `/help` and `/help play` look correct in `en-US` and `de`;
autocomplete works from Discord; all tests green.

Code and tests landed in `bd43d0b7` (`tests/help.test.mjs`,
`tests/autocomplete.test.mjs`, `tests/commands.test.mjs`). The in-Discord pass
was run on BotTest at `8011257f` on 2026-11-12: `/help` and `/help play` render
in German and the `/help` command autocomplete answers from Discord (see
*Optional BotTest verification*).

**Commit:** `feat(help): localize details and add command autocomplete`

## Phase 3 — CI guardrails

**Files:** `.github/dependabot.yml` (new), `.github/workflows/ci.yml`,
`package.json`.

- [x] Add weekly Dependabot updates:
      - `npm`, grouped minor/patch, open-PR limit 5
      - `github-actions`, weekly
- [x] Add a CI step after `npm ci`:
      `npm audit --omit=dev --audit-level=high`.
- [x] Change `test:coverage` to enforce floors just below current coverage:

      node --test --experimental-test-coverage \
        --test-coverage-exclude='**/*.test.mjs' \
        --test-coverage-lines=66 \
        --test-coverage-functions=56 \
        --test-coverage-branches=72 \
        tests/*.test.mjs

- [x] Run `npm run format` so the new YAML passes Prettier.
- [x] Verify `npm run test:coverage` still passes with the thresholds.

**Acceptance:** CI green; thresholds fail if coverage drops; Dependabot config
parses.

Real numbers, after the plan's draft floors were corrected:

- The draft `--test-coverage-lines=75 / functions=80 / branches=70` mixed up
  the report's column order, which is **line / branch / funcs**. The quoted
  `80.70` was branch coverage and `70.92` was functions; `functions=80` failed
  against the measured value.
- CI's Node 24 excludes `tests/*.test.mjs` from the coverage report while this
  host's Node 22 includes them, so the same command measured differently.
  `--test-coverage-exclude='**/*.test.mjs'` pins source-only coverage on both.
- Source-only coverage at the gate: **lines 67.02 / branches 73.14 /
  functions 57.29**; floors are set ~1pp below at 66 / 56 / 72.
- Threshold enforcement was proven by raising the line floor to 99: exit 1,
  `67.02% line coverage does not meet threshold of 99%`.
- `npm audit --omit=dev --audit-level=high` reports `found 0 vulnerabilities`
  locally and in CI; the Dependabot YAML parses against the published schema.
  GitHub-side validation of the Dependabot config has no on-demand trigger, so
  the first scheduled run is the remaining proof.

**Commit:** `ci: add dependency audit and coverage floors`

## Phase 4 — Doc truth

**Files:** `docs/HANDOFF.md`; all 20 completed/historical plans were removed on
2026-11-12.

- [x] Remove the nine completed plan docs (`BUG_HUNT_FINDINGS`,
      `FULL_REWRITE_PLAN`, `OPTIMIZATION_AND_BUG_HUNT_PLAN`,
      `OPTIMIZATION_BASELINE`, `PLAYLIST_ORDER_PLAN`, `REWRITE_AUDIT`,
      `REWRITE_PLAN`, `STAGING_TEST_PLAN`, `STAGING_TEST_RESULTS`). Their
      content remains in git history; the staging gate matrix was preserved in
      the maintenance skill's `references/staging-and-failover.md`.
- [x] Remove the eleven remaining release/parity/feature plans
      (`JOCKIE_PARITY`, `PARITY_WORKFLOW`, `PRE_RELEASE_AUDIT`,
      `PRE_RELEASE_AUDIT_PLAN`, `I18N_AND_PLAYLOCAL_PLAN`,
      `LONGTAIL_I18N_WORKFLOW`, `UPSTREAM_4.2-4.7_REVIEW`,
      `UPSTREAM_PARITY_AUDIT`, `AUDIO_TAP_PLAN`, `AUTOMATED_TESTING_PLAN`,
      `PERFORMANCE_PLAN`). Current runbook content is in `README.md`,
      `I18N.md`, `PLAYBACK_ARCHITECTURE.md`, and the maintenance skill;
      performance evidence was carried into `HANDOFF.md`.
- [x] Re-check `docs/HANDOFF.md` for stale current-state claims; it was
      refreshed at `4977a635` and again after the docs cleanup.
- [x] No historical plan docs remain in `docs/`; deleted content is in git
      history. Keep the surviving current references in place.
- [x] Verify with
      `grep -rnE 'experimental/rewrite|209/209|71 top-level|136 tests' docs --exclude=MAINTENANCE_PLAN.md`;
      it should return no hits after the cleanup.

**Commits:** `6b59f4e4`, `65590d39`, `dd8742a6`

## Phase 5 — Final gate and verification

- [x] `npm run i18n:validate`
- [x] `npm run format`
- [x] `npm run lint`
- [x] `npm run build`
- [x] `npm test`
- [x] `npm run test:coverage`
- [x] `git diff --check`
- [x] CI green on `dev`
- [x] Record the final test count and coverage numbers in this plan and in
      `docs/HANDOFF.md`.

### Phase 5 gate results

Run on 2026-11-12 against `dev` at `ddf195b4` (clean tree, Node 22.23.4,
npm 12.2.1):

| Check | Result |
| --- | --- |
| `npm run i18n:validate` | 16 locales valid: de, en-GB, en-US, es-ES, fr, id, it, ja, ko, nl, pl, pt-BR, ru, tr, zh-CN, zh-TW |
| `npm run format` | clean (`All matched files use Prettier code style`) |
| `npm run lint` | clean (`oxlint --type-aware --type-check --deny-warnings`) |
| `npm run build` | clean (`tsc --project tsconfig.json`) |
| `npm test` | **471/471** pass, 0 fail, 0 skipped (15.8 s) |
| `npm run test:coverage` | **471/471** pass; source-only **67.02% lines / 73.14% branches / 57.29% functions**, floors 66 / 56 / 72 |
| `git diff --check` | clean |
| CI on `dev` | run `43178687504` on `ddf195b4`: success (audit, format, locale validation, lint, build, test/coverage) |

The test count rose from the 454 baseline to **471** across phases 1–2 — 17 new
cases: 5 in the new `tests/command-metadata.test.mjs`, 6 in the new
`tests/help.test.mjs`, 5 help/autocomplete cases in `tests/autocomplete.test.mjs`,
and 1 help-option case in `tests/commands.test.mjs`.

### Optional BotTest verification

The `dev` baseline already contains the undeployed `eb4953f9` health/export
feature; treat it as separate work, not part of this plan.

- [x] Deploy the branch to the disposable staging checkout and restart.
- [x] Confirm 74 commands register.
- [x] Inspect the REST payload for `/filter` and `/setup` option
      `description_localizations`.
- [x] Exercise `/help`, `/help play`, and the autocomplete from a real Discord
      user session.
- [ ] Production deployment only after an explicit request, using
      `references/deploy-host.md` in the maintenance skill.

Run on the disposable BotTest checkout at `8011257f` on 2026-11-12 (kanban task
`t_6a2ba550`). The same pass also covered guild language switching with
`/language` and `/settings language` (`de`, `fr`, back to `en-US`), a real
join/play/queue/skip/leave smoke in French and German with now-playing panel
cleanup, and the dashboard chrome/settings/statistics following the guild
locale. Production was not touched and nothing from `dev` is deployed; the
production-deployment box stays open until the user asks.

## Risks

- **Discord payload size:** localizing every option grows the command body.
  Test registration on BotTest first; if Discord rejects it, localize the
  most-used commands first.
- **Type shape:** the camelCase/snake_case mapper is the most likely strict
  compile break; keep it pure and covered by a direct test.
- **Help trimming:** removing fields can hide useful setup information; keep
  user-relevant requirements and hide only implementation details.
- **Dependabot noise:** grouping minor/patch updates and limiting open PRs keeps
  it manageable.

## Definition of done

- [ ] `/filter` and `/setup` options show localized descriptions in Discord.
      *(Implemented and unit-pinned; Discord-side confirmation is part of the
      live acceptance open item in `docs/HANDOFF.md`.)*
- [ ] `/help` is localized, user-focused, and autocompletes command names.
      *(Implemented and unit-pinned; same live-acceptance caveat.)*
- [x] CI checks dependency audit and coverage floors.
- [x] Completed plans are removed; `docs/` holds only current references and its counts are accurate.
- [x] Full gate and CI green; no production change without approval.
