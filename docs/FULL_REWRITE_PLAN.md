# Full Rewrite Plan and Workflow

Goal: make every `src/**/*.ts` file independently implemented against the
BootstrapDJ architecture, with no upstream-derived logic except explicitly
documented generic adapters.

Current branch: `experimental/rewrite`
Current state: `3fb47d4`; 209 tests; playback engine split complete.
Production: untouched.

## Definition of Done

- No upstream-derived lines in `src`, measured by the audit tool.
- Every remaining upstream same-name file is rewritten or documented as a
  generic adapter with no copied blocks.
- `Dispatcher` is a façade/event adapter over `PlaybackEngine`.
- Commands use the new `Command`/`defineMusicCommand` primitives.
- Events use the new `Event`/`Context` primitives.
- Plugins use the new client/queue APIs.
- No schema changes; no `@ts-ignore`/`@ts-expect-error`/`as any`.
- Build, lint, typecheck, tests, and `git diff --check` pass.
- Live BotTest/Edge matrix passes.
- Audit report and architecture docs are committed.

## Batch Workflow

Each batch follows the same loop:

1. Freeze the file list for the batch.
2. Read the current implementation and its tests.
3. Write a short behavior contract in the batch PR/commit message.
4. Rewrite the files against the new primitives, not upstream code.
5. Run targeted tests and the full gate:
   ```bash
   npm run build
   npm run lint
   npx tsc --noEmit -p tsconfig.json
   npm test
   git diff --check
   ```
6. Run `node tooling/rewrite-audit.mjs <upstream-src>` and compare the batch.
7. Commit one batch; do not mix batches.
8. Live-test the batch if it affects playback, setup, dashboard, or voice.
9. Update `docs/REWRITE_AUDIT.md` and `FORK-LOG-2026-11-08.md`.

If a batch fails a gate, revert that batch only; never continue on a broken
baseline.

## Batch 1 — Core façade and adapters

Files:
- `src/core/Dispatcher.ts`
- `src/core/index.ts` if exports need adjustment
- core adapter files under `src/core/player/` that still contain copied logic

Work:
- Reduce Dispatcher to construction, event wiring, and public façade methods.
- Keep state exposed through adapters only; remove duplicated transport and
  lifecycle logic.
- Remove upstream-matched comments/blocks.
- Keep `Object.create(Dispatcher.prototype)` test compatibility where tests
  depend on it.

Gates: playback, pause/resume, skip, seek, stop, restart restore, leave order.

## Batch 2 — Management and playlist commands

Files:
- `src/commands/manage/*`
- `src/commands/owner/Eval.ts`
- any playlist helper under `src/lib` that these commands use

Work:
- Rebuild actions against `Command`, `Context`, `QueueTools`, and DB stores.
- Preserve slash options, prefix aliases, permissions, ephemeral behavior.
- Preserve setup/mock-player and 24/7 behavior.

Gates: `/playlist` create/add/load/delete, `/setup`, `/dj`, `/247`, `/eval`.

## Batch 3 — Events, context, buttons, utilities

Files:
- `src/core/Context.ts`
- `src/lib/Buttons.ts`
- `src/lib/Utils.ts`
- `src/events/client/SetupButtons.ts`
- `src/events/client/SetupSystem.ts`
- remaining event files with upstream matches

Work:
- Rebuild dispatch/reply/delete/collector flows against the new Context.
- Preserve interaction defer/edit rules and now-playing cleanup.
- Preserve ephemeral/public reply behavior.

Gates: setup buttons, now-playing, voice state, track start/end, queue end,
restart restore.

## Batch 4 — Plugins and bridges

Files:
- `src/plugin/plugins/earlBridge.ts`
- `src/plugin/plugins/antiCrash.ts`
- `src/plugin/plugins/reconnectNodes.ts`
- other plugin files

Work:
- Rebuild against `BootstrapClient`, `Queue`, and `PlaybackEngine`.
- Preserve bridge authentication, opt-out handling, node watchdog cadence, and
  crash guards.

Gates: bridge health, node watchdog, crash logging, voice listener state.

## Batch 5 — Data and dashboard remainder

Files:
- `src/data/server.ts`
- `src/dashboard/server.ts`
- `src/dashboard/shardApi.ts`
- remaining data stores with copied orchestration

Work:
- Thin `ServerData` to composition only.
- Keep dashboard API/session/OAuth behavior; test token/loopback mode.
- Remove upstream-derived SQL/HTTP blocks.

Gates: dashboard `/`, `/api/state`, `/api/player-state`, `/api/player`,
settings, stats, auth modes.

## Batch 6 — Remaining commands and libraries

Files:
- `src/commands/music/*`, `filters/*`, `tools/*`, `info/*`, `config/*`, `playlist/*`, `dev/*`, `owner/*` not covered above
- `src/lib/*` not covered above

Work:
- Rewrite remaining inherited helpers/commands against the new primitives.
- Remove dead aliases/imports and copied comments.

Gates: command registration count, autocomplete, filters, queue tools,
leaderboard/stats.

## Batch 7 — Provenance audit and cleanup

- Run `tooling/rewrite-audit.mjs`.
- Review every same-name pair above threshold; record accepted generic adapters.
- Remove unused files, imports, and stale docs.
- Update `docs/REWRITE_AUDIT.md` with final counts.
- Run license/legal-string scan.

## Batch 8 — Live staging and merge

- Start BotTest from the branch.
- Run the Phase 7 matrix in `docs/REWRITE_PLAN.md`.
- Test restart restore, now-playing cleanup, volume persistence.
- Test dashboard loopback/token mode.
- Test failover only with an isolated test Lavalink.
- Merge to `main` only after staging sign-off.
- Deploy production only after explicit approval.

## Parallelization Rules

- Batches 2, 3, 5, and 6 touch disjoint files and may be developed in parallel.
- Batch 1 is serialized first because it changes core imports.
- Batch 4 waits for Batch 1.
- No two workers edit the same file.
- Each worker reports a file list and gate output; the parent verifies and commits.
- Do not run `git reset`, `git checkout -- .`, or force-push from a worker.

## Commands

```bash
node tooling/rewrite-audit.mjs /path/to/upstream/src
npm run build
npm run lint
npx tsc --noEmit -p tsconfig.json
npm test
git diff --check
```

## Estimate

- Batch 1: 1–2 days
- Batches 2–6: 8–14 days
- Batch 7: 1–2 days
- Batch 8: 1–2 days
- Total: **4–6 focused weeks solo**, less with parallel workers
