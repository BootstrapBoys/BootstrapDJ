# Upstream parity workflow

**Branch:** `dev` only. No merge to `main` or production deploy until all phases are
reviewed and green.<br>
**Source review:** `docs/UPSTREAM_4.2-4.7_REVIEW.md`<br>
**Technical plan:** `docs/I18N_AND_PLAYLOCAL_PLAN.md`<br>
**Baseline:** `13c3a335` plus the parity planning docs.

## Rules

- One phase at a time; do not start the next phase with a failing gate.
- Each phase gets its own commit(s), a short result note, and the full gate:
  `npm run format`, `npm run lint`, `npm run build`, `npm test`,
  `npm run test:coverage`.
- No production deploy and no `main` fast-forward during this workflow.
- Never add `any`, `@ts-ignore`, or `@ts-expect-error`; strict TypeScript stays clean.
- Preserve the existing command/queue/session/dashboard behavior unless the phase
  explicitly changes it.
- Keep feature work test-first where the behavior is locally testable; live
  Discord/Lavalink checks are recorded separately.

## Phase tracker

| # | Phase | Status | Gate |
|---|---|---|---|
| 1 | `/playlocal` Lavalink spike + command implementation | **Complete** | Real HTTP-source playback on test node **PASS**; unit/command tests; full gate |
| 2 | i18n foundation, `language` setting, `/language`, dashboard selector, `en-US`/`en-GB` | Planned | Language switch persists; fallback/metadata tests; full gate |
| 3 | Migrate bot command/event/error strings by domain | Planned | `en-US` key coverage; no hardcoded user-facing strings in migrated paths |
| 4 | Targeted upstream fix audit: playlist, queue, setup, stage/voice, now-playing, lyrics | Planned | Each accepted fix has a regression test or explicit “already covered” note |
| 5 | Translation import, key validator, dashboard localization, docs/container decision | Planned | Supported locales validated; CI green; release review |

## Phase 1 task list

- [x] Resolve Lavalink `local` source semantics with a real audio file.
- [x] Decide attachment URL vs short-lived downloaded file.
- [x] Add `/playlocal` command and attachment validation.
- [x] Add queue/limits/playback path and failure copy.
- [x] Add focused tests and run the full gate.
- [x] Record live test evidence.

### Phase 1 evidence

- Production node source managers: **no `local` source manager**; `http` source is
  present.
- A temporary loopback WAV resolved as `loadType: track` through the `http`
  source.
- Test bot `BootstrapDJ-DEV` joined a test voice channel, played the URL through
  Lavalink, logged `start` and `finished`, and left.
- `/playlocal` is therefore attachment-URL based through the supported `http`
  source; it never accepts a host filesystem path.
- Command surface: **110 commands / 73 slash**, unique names/aliases.
- Gate: format, lint, build, **433/433 tests**, coverage **76.16% lines**.

## Decision log

- `/playlocal` is attachment-only; no arbitrary host filesystem paths.
- Use the existing queue/player lifecycle; do not create a dashboard-only player.
- Keep canonical English command names during the first i18n release; localize
  descriptions and responses first.
- Do not port Bun/Drizzle/PostgreSQL or Docker/Replit infrastructure as part of
  this workflow.

## Reporting format

At the end of each phase, report only:

1. What changed.
2. Gate results.
3. What is left or blocked.
4. The next phase, if the gate passed.
