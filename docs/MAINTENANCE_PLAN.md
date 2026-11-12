# BootstrapDJ maintenance plan: i18n metadata, help UX, CI guardrails, doc truth

Status: **planned — phases 1–4 pending**
Created: 2026-11-12
Baseline: `dev` after `eb4953f9`; 454/454 tests at `7e9dbfdb`
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
| 0 | Baseline and gate | Not started |
| 1 | Localize slash-command option descriptions | Not started |
| 2 | Help UX: localization, field trimming, autocomplete | Not started |
| 3 | CI: Dependabot, dependency audit, coverage floors | Not started |
| 4 | Doc truth: remove completed plans; fix current counts | Mostly done — 20 historical docs deleted; HANDOFF counts pending |
| 5 | Final gate and verification | Not started |

## Phase 0 — Baseline

- [ ] Confirm `git branch --show-current` is `dev` and the tree is clean.
- [ ] Confirm `git log -1` includes the handoff/plan docs above the undeployed
      `eb4953f9` feature commit.
- [ ] Run `npm run format`, `npm run lint`, `npm run build`, and `npm test`;
      record the current baseline (454/454 at `7e9dbfdb`).
- [ ] Run `npm run i18n:validate`.
- [ ] Confirm every `locales/*/commands.json` still has its `metadata` block.

## Phase 1 — Slash-command option localization

**Goal:** every command and option description that exists in the catalogs
reaches Discord in all supported locales.

**Files:** `src/lib/commandMetadata.ts`, `src/lib/CommandManager.ts`,
`tests/commands.test.mjs` or a new `tests/command-metadata.test.mjs`.

The one-line intent hides a type-shape trap: `Command.options` uses discord.js's
camelCase `descriptionLocalizations`, while the REST body needs snake_case
`description_localizations`. Assigning only the camelCase field leaves Discord
ignoring it; assigning only the snake_case field does not type-check.

- [ ] Make `applyCommandMetadata` recurse through `option.options` for
      subcommands.
- [ ] Set `option.descriptionLocalizations = localizedDescriptions(key)` for
      every option with a catalog entry.
- [ ] Replace the raw `command.options as SlashBody['options']` cast in
      `CommandManager.register` with a pure `toApiOptions()` mapper that:
      - renames `descriptionLocalizations` → `description_localizations`
      - renames `nameLocalizations` → `name_localizations`
      - maps choice `nameLocalizations` the same way
      - recurses into subcommand options
      - strips camelCase keys from the payload
- [ ] Export `toApiOptions` for a direct unit test; keep zero `any` and
      `@ts-ignore`.
- [ ] Tests:
      - `/filter` options get `description_localizations.de/fr/ja`, and the
        values differ from English.
      - `/setup` subcommands (`create`, `delete`, `info`) get localized
        descriptions.
      - The serialized body contains `description_localizations`, never
        `descriptionLocalizations`.
      - Existing command/alias collision and defer tests still pass.

**Acceptance:** build, tests, and locale validation green; a BotTest
registration still reports 74 commands with no Discord 400.

**Commit:** `fix(i18n): localize slash-command option descriptions`

## Phase 2 — Help UX

**Goal:** `/help` is localized, shows user-facing information, and lets users
pick a command instead of typing its exact name.

**Files:** `src/commands/tools/Help.ts`,
`src/events/client/InteractionCreate.ts`, `tests/commands.test.mjs`,
`tests/autocomplete.test.mjs`, new `tests/help.test.mjs`.

- [ ] Translate the detail description with
      `tr(ctx, \`commands:metadata.${command.name}.description\`)`, falling
      back to `command.description.content` when the key is missing.
- [ ] Trim the detail rows to user-facing facts:
      - keep description, usage, examples, aliases, cooldown, and required
        user permissions
      - show voice, DJ, and active-player requirements only when true
      - hide bot permissions, category, `args`, `slashCommand`, and
        DJ-permission internals
      - show developer-only fields only to owners via `isOwner`
- [ ] Resolve aliases in `run`:
      `client.commands.get(query) ?? client.commands.get(client.aliases.get(query))`.
- [ ] Refuse developer-only commands to non-owners instead of describing them.
- [ ] Add `autocomplete: true` to the `command` option.
- [ ] Add a `help`/`command` branch in
      `InteractionCreate.autocompleteChoices`:
      - canonical command names only, filtered by the typed query
      - exclude `dev` commands for non-owners
      - prefix matches first, then alphabetical; cap at 25
      - answer `[]` on every failure or empty path
- [ ] Tests:
      - the `Help` command option has autocomplete enabled
      - `help`/`command` autocomplete returns `play` for `pl`, is capped, and
        hides owner commands
      - an unknown query returns `[]`
      - German `details()` shows the German description and omits the
        bot-permission and developer-only labels

**Acceptance:** `/help` and `/help play` look correct in `en-US` and `de`;
autocomplete works from Discord; all tests green.

**Commit:** `feat(help): localize details and add command autocomplete`

## Phase 3 — CI guardrails

**Files:** `.github/dependabot.yml` (new), `.github/workflows/ci.yml`,
`package.json`.

- [ ] Add weekly Dependabot updates:
      - `npm`, grouped minor/patch, open-PR limit 5
      - `github-actions`, weekly
- [ ] Add a CI step after `npm ci`:
      `npm audit --omit=dev --audit-level=high`.
- [ ] Change `test:coverage` to enforce floors just below current coverage:

      node --test --experimental-test-coverage \
        --test-coverage-lines=75 \
        --test-coverage-functions=80 \
        --test-coverage-branches=70 \
        tests/*.test.mjs

- [ ] Run `npm run format` so the new YAML passes Prettier.
- [ ] Verify `npm run test:coverage` still passes with the thresholds.

**Acceptance:** CI green; thresholds fail if coverage drops; Dependabot config
parses.

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
- [ ] Re-check `docs/HANDOFF.md` for stale current-state claims; it was
      refreshed at `4977a635`, but verify again after the code commits.
- [x] No historical plan docs remain in `docs/`; deleted content is in git
      history. Keep the surviving current references in place.
- [ ] Verify with
      `grep -rnE 'experimental/rewrite|209/209|71 top-level|136 tests' docs --exclude=MAINTENANCE_PLAN.md`;
      it should return no hits after the cleanup.

**Commit:** `docs: remove completed plans and refresh counts`

## Phase 5 — Final gate and verification

- [ ] `npm run i18n:validate`
- [ ] `npm run format`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run test:coverage`
- [ ] `git diff --check`
- [ ] CI green on `dev`
- [ ] Record the final test count and coverage numbers in this plan and in
      `docs/HANDOFF.md`.

### Optional BotTest verification

The `dev` baseline already contains the undeployed `eb4953f9` health/export
feature; treat it as separate work, not part of this plan.

- [ ] Deploy the branch to the disposable staging checkout and restart.
- [ ] Confirm 74 commands register.
- [ ] Inspect the REST payload for `/filter` and `/setup` option
      `description_localizations`.
- [ ] Exercise `/help`, `/help play`, and the autocomplete from a real Discord
      user session.
- [ ] Production deployment only after an explicit request, using
      `references/deploy-host.md` in the maintenance skill.

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
- [ ] `/help` is localized, user-focused, and autocompletes command names.
- [ ] CI checks dependency audit and coverage floors.
- [ ] Completed plans are removed; `docs/` holds only current references and its counts are accurate.
- [ ] Full gate and CI green; no production change without approval.
