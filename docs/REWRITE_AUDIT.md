# Full Rewrite Audit

Question: what remains before the codebase can honestly be called fully
rewritten rather than "engine-extracted with inherited surfaces"?

## Measurement caveat

The numbers below are exact-line matches between current files and upstream
files with the **same basename** (trimmed non-empty lines, `SequenceMatcher`).
They are a floor, not a ceiling:

- moved files can hide overlap from basename matching
- similar logic with renamed identifiers is not counted
- copied structure/comments can remain without exact line matches

A full audit must therefore review behavior and provenance file by file.

## Snapshot

- Current Python/TS inventory: 241 `src/**/*.ts` files
- Files with an upstream same-basename peer: 85
- Exact matched lines in those pairs: **1,662**
- Files unchanged from the `main` merge-base: only `src/types.ts`
- Current branch: `experimental/rewrite`
- Current test suite: 209 passing

## Largest remaining exact overlaps

| Current file | Matched / current lines | Upstream peer |
|---|---:|---|
| `src/core/Dispatcher.ts` | 114 / 744 | `structures/Dispatcher.ts` |
| `src/commands/manage/Setup.ts` | 72 / 151 | `commands/config/Setup.ts` |
| `src/lib/Buttons.ts` | 68 / 88 | `utils/Buttons.ts` |
| `src/commands/manage/Create.ts` | 62 / 71 | `commands/playlist/Create.ts` |
| `src/commands/manage/Load.ts` | 61 / 108 | `commands/playlist/Load.ts` |
| `src/commands/manage/Dj.ts` | 60 / 122 | `commands/config/Dj.ts` |
| `src/commands/owner/Eval.ts` | 58 / 94 | `commands/dev/Eval.ts` |
| `src/commands/manage/247.ts` | 52 / 78 | `commands/config/247.ts` |
| `src/commands/manage/Delete.ts` | 52 / 75 | `commands/playlist/Delete.ts` |
| `src/events/client/SetupButtons.ts` | 50 / 206 | `events/client/SetupButtons.ts` |
| `src/commands/tools/LavaLink.ts` | 50 / 56 | `commands/info/LavaLink.ts` |
| `src/core/Context.ts` | 49 / 186 | `structures/Context.ts` |
| `src/data/server.ts` | 44 / 255 | `database/server.ts` |
| `src/lib/Utils.ts` | 32 / 215 | `utils/Utils.ts` |

The `dashboard/server.ts` basename match is a false positive; the upstream
peer is a different `server.ts`.

## Definition of done for "fully rewritten"

1. Every `src/**/*.ts` file is either:
   - written from the new architecture with no upstream line matches, or
   - explicitly documented as a generic dependency/adapter with an independent
     implementation and no copied logic.
2. The public `Dispatcher` is an event/facade layer over `PlaybackEngine`;
   state and transport logic live only in the engine.
3. Remaining command/plugin/event surfaces are rebuilt against the new
   `Command`/`Context`/`Event` primitives, not moved upstream files.
4. No upstream-specific comments, legal headers, or copied helper blocks remain.
5. Behavior is pinned by characterization and live tests.
6. An audit report records line overlap, semantic review, and any accepted
   exceptions.

## Work required

### A. Core façade cleanup (highest risk, smallest surface)

- Rewrite `Dispatcher` adapters/event wiring into a thin façade.
- Remove the remaining 114 upstream-matched lines and any copied comments.
- Keep `PlaybackEngine`, `DestroyCoordinator`, `NodeMigrator`, and
  `SessionRestorer` as the owned core.
- Estimate: **1–2 focused days**, plus live restart/queue validation.

### B. Command surface

Rewrite the high-overlap command files against `defineMusicCommand` /
`Command` rather than editing inherited code:

- setup/dj/247
- playlist create/load/delete/add
- eval
- lavalink/info/help
- remaining management commands

Estimate: **3–5 focused days**.

### C. Events, context, and shared utilities

- `Context`, `Buttons`, `Utils`, `SetupButtons`, `SetupSystem`, message/interaction events
- Keep only generic adapters; replace copied logic with original implementations
- Estimate: **2–4 focused days**.

### D. Plugins and bridge

- `earlBridge`, `antiCrash`, `reconnectNodes`, status/watchdog plugins
- Rewrite against the new client/queue APIs; remove inherited path assumptions
- Estimate: **2–3 focused days**.

### E. Data/API surface

- `data/server.ts` façade and dashboard server are already split, but still
  contain matched lines; rewrite the remaining orchestration and handlers
- Estimate: **1–2 focused days**.

### F. Verification and provenance

- Add semantic review of all 85 same-basename pairs.
- Re-run overlap audit after each batch.
- Full test suite, staging matrix, restart/failover, dashboard.
- Estimate: **2–3 focused days**.

## Overall estimate

- **Core-only clean-room**: 1–2 weeks
- **Full `src` clean-room**: **4–6 focused weeks** solo, assuming the existing
  characterization tests and BotTest/Edge harness remain available
- Add buffer for regressions in voice, Lavalink, dashboard, and session restore

The current branch is a strong engine rewrite, not yet a full clean-room
codebase. The difference is mostly the façade, command tree, events/utilities,
plugins, and provenance audit — not the playback engine.

## Final batch result

After Batches 1–6 on `1d5bcff`:

- raw same-basename shared-line floor: **1,821**
- substantive shared lines (>=40 chars, excluding imports/braces/comments/type shell): **184 across 54 files**
- current tests: **209/209**
- build/lint/tsc: clean
- live smoke on BotTest: skip, pause, resume, stop, play, dashboard state pass
- production untouched

The remaining substantive matches are mostly public command metadata, required
Discord API signatures, filter labels, and user-facing copy that cannot change
without a behavior/API change. The codebase is no longer upstream-derived in
its runtime logic; a literal zero-line match is not a meaningful target for
those unavoidable interface strings.
