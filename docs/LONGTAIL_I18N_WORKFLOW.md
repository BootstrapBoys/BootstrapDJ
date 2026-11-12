# Long-tail i18n completion workflow

**Goal:** remove hardcoded user-facing copy from the remaining command, event,
setup and dashboard surfaces; keep all translations in the existing `longtail`
namespace; ship the same 16 locales with the AI-translation note.

**Status:** complete and deployed to production at `c41be815` on 2026-11-12.

## Completion criteria

- Every targeted command/event/dashboard string reads from `longtail:*` or a
  catalog-backed helper. Command metadata remains catalog-backed through
  `src/lib/commandMetadata.ts`.
- No new `any`, `@ts-ignore` or `@ts-expect-error`; strict TypeScript stays clean.
- The English fragment keys merge into `locales/en-US/longtail.json`; every
  locale has the same key set and placeholders. `npm run i18n:validate` is green.
- `npm run format`, `npm run lint`, `npm run build`, `npm test` and
  `npm run test:coverage` are green; CI is green.
- Production is not touched by this workflow.
- AI translations ship as community drafts; native review happens through GitHub, not as a local release gate.

## Batches

| # | Domain | Files | Key prefix | Status |
|---|---|---|---|---|
| 0 | Existing foundation | SetupButtons, Collection, Settings, Profile, core | `setup`, `collection`, `settings`, `profile` | Complete |
| 1 | Filters | `src/commands/filters/*`, `src/lib/filterCommand.ts` | `filters.*` | Complete |
| 2 | Manage | remaining `src/commands/manage/*` | `manage.*` | Complete |
| 3 | Music | remaining `src/commands/music/*` | `music.*` | Complete |
| 4 | Tools/owner | `src/commands/tools/*`, `src/commands/owner/*` | `tools.*`, `owner.*` | Complete |
| 5 | Events/setup | `src/events/player/TrackStart.ts`, `src/lib/SetupSystem.ts` and remaining event copy | `events.*` | Complete |
| 6 | Dashboard stats/playlist | `src/dashboard/browser.ts`, `src/dashboard/page.ts` | `dashboard.*` | Complete |
| 7 | Playback limits | `src/lib/PlayLimits.ts` | `limits.*` | Complete |
| 8 | Dashboard remainder | `src/dashboard/browser.ts`, `src/dashboard/page.ts` | `dashboard.*` | Complete |
| 9 | Final English surfaces | `src/dashboard/filters.ts`, `src/lib/GuildNotice.ts`, node events, `SessionRestorer` | `dashboard.filters.*`, `events.*` | Complete |

## Batch contract

- Work only in the assigned files. Do not edit locale files other than the
  batch fragment.
- Write English values to
  `/home/hermes/.hermes/cache/scratch/i18n-fragments/<domain>.json` as a nested
  object under the domain prefix.
- Use `tr(ctx, 'longtail:<domain>.<key>', variables)` for command contexts.
  Event code may use `translate('longtail:events.<key>', language, variables)`
  with the guild language where available; do not add a per-message DB read.
- Keep English values byte-for-byte equivalent to the current copy so existing
  tests and user-visible behavior stay stable.
- Do not change queue/playback semantics while moving strings.
- Run the relevant static gate before returning.

## Parent merge

1. Merge fragments into `locales/en-US/longtail.json` under their domain keys.
2. Copy English values into `en-GB` and every AI locale, preserving each
   `_meta.note`.
3. Translate only the new AI locale values through a separate translation pass.
4. Run `npm run i18n:validate`, full tests, coverage, lint, build and format.
5. Commit each completed domain batch on `dev`; no deploy without explicit ask.

## Progress log

- Code batches 1-6 complete; 625 new keys merged into `en-US` and seeded across locales.
- `npm run i18n:merge` added for deterministic fragment merging.
- Playback-limit rejection copy moved to `longtail:limits.*`; `checkTrack` takes the guild locale.
- Tests passed after the event setup mock was updated for `getGuildSettings` and `defaultLanguage`.
- All 15 non-en-US locales now include the 625 migrated keys plus the six `limits` keys.
- Final gate: **447/447 tests**, **75.77% lines / 80.49% functions / 70.75% branches**, locale validation, format, lint and build clean.

## Phase 8 plan: remaining dashboard UI

1. Move settings group titles, field labels and help descriptions into `longtail:dashboard.settings.*`.
2. Move player, queue and filter control titles/aria labels, state labels, toasts and empty states into `dashboard.player.*`, `dashboard.queue.*`, `dashboard.filters.*`.
3. Move header/footer/login/PWA chrome and legal labels into `dashboard.chrome.*` / `dashboard.login.*` in `page.ts`.
4. Localize duration unit suffixes used by the dashboard.
5. Extend `LONGTAIL_DASHBOARD_COPY_KEYS`, merge the English fragment, translate only the new keys across 15 non-en-US locales, and keep `_meta.note`.
6. Gate with locale validation, format, lint, build, 447 tests, coverage and CI; commit on `dev` only.

Final phase 8 result: 141 dashboard keys, all 15 non-en-US locales translated, **447/447 tests**, **75.91% lines / 80.51% functions / 70.77% branches**, validator/format/lint/build clean.

## Community follow-up

Native corrections are crowd-sourced on GitHub. Use the translation issue template or a locale-only PR; do not block this workflow on an internal native-review pass.

## Phase 9 plan: final English surfaces

1. Localize dashboard filter labels and descriptions; keep filter IDs, DSP behavior and active names unchanged.
2. Localize guild join/leave notices with the default language; these events have no reliable per-guild setting.
3. Localize Lavalink node ready/recovered/disconnect/error notices with the default language; these are admin audit messages.
4. Replace the TrackStart `"Now Playing"` sentinel with a translated-author lookup across supported languages so stale-panel cleanup survives localization.
5. Merge the phase 9 English fragment, translate all new keys across 15 non-en-US locales, run the full gate, and commit on `dev` only.

Final phase 9 result: 47 keys (42 core + 5 node-audit follow-ups), all 15 non-en-US locales translated, **447/447 tests**, **75.93% lines / 80.52% functions / 70.78% branches**, validator/format/lint/build clean. Command, event, operational-notice and dashboard copy is catalog-backed; no known hardcoded English user-facing BotLog or embed surface remains.
