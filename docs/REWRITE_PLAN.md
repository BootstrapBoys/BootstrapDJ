# Dispatcher Rewrite Plan

Status snapshot: `experimental/rewrite` at `c02d99f`
Baseline: 153 tests passing, TypeScript 7 build clean, Oxlint 0/0, CI green
Production: `DJBoot` untouched on its existing build

## Goal

Replace the remaining inherited LavaMusic playback core with an original
`PlaybackEngine`, while preserving the bot's observable behavior:

- queue, playback, pause/resume, skip, seek, stop
- session save/restore and position accuracy
- autoplay and look-ahead behavior
- destroy/leave ordering and node migration
- volume, loop, filters, and 24/7 behavior
- public `Dispatcher` methods used by commands, events, dashboard, and Earl

This is a behavior-parity rewrite, not a line-count exercise. Moving code into
new files does not count as rewriting it. A method is rewritten only when its
logic is replaced and the characterization tests prove equivalent behavior.

## Current State

Already extracted / rebuilt:

| Area | Files | Status |
|---|---|---|
| Data stores | `src/data/*.ts` | Split; `server.ts` is a 305-line façade |
| Track identity | `src/core/player/TrackIdentity.ts` | Done |
| Presentation cleanup | `src/core/player/PresentationRegistry.ts` | Done |
| Session writes | `src/core/player/SessionWriter.ts` | Done |
| Playback timers | `src/core/player/PlaybackTimers.ts` | Done |
| Deezer discovery | `src/core/player/DeezerClient.ts` | Done |
| Autoplay seeds | `src/core/player/AutoplaySeeds.ts` | Done |
| Autoplay picker | `src/core/player/AutoplayPicker.ts` | Done |
| Autoplay cold start | `src/core/player/AutoplayColdStart.ts` | Done |
| YouTube mix | `src/core/player/YouTubeMix.ts` | Done |
| Track resolution | `src/core/player/TrackResolution.ts` | Done |
| Transport helpers | `src/core/player/TransportActions.ts` | Done |
| Queue operations | `src/core/player/QueueOps.ts` | Done |
| Play failure bookkeeping | `src/core/player/PlaybackFailure.ts` | Done |
| Dispatcher | `src/core/Dispatcher.ts` | **761 lines, still inherited core** |
| Session restore | `src/lib/Session.ts` | **358 lines, still inherited** |

Remaining inherited logic includes `play()`, `pause()`, `destroy()`, session
restore orchestration, node migration, and several event/plugin paths.

## Non-Negotiable Constraints

- No schema change without explicit approval.
- No `@ts-ignore`, `@ts-expect-error`, or `as any`; narrow at the source.
- Keep the existing public `Dispatcher` API stable until all callers are migrated.
- One behavior per commit; run build, lint, and tests after each.
- Do not deploy to production during this plan.
- Do not stop the shared production Lavalink nodes for failover testing.
- Do not rewrite `play()` or `destroy()` without tests covering the current
  behavior first.
- Keep the setup/mock-player message and the latest now-playing panel intact.

## Architecture Target

Introduce a new `src/core/player/PlaybackEngine.ts` that owns playback state and
transport decisions. `Dispatcher` becomes an event-wiring façade.

Proposed shape:

```ts
// PlaybackEngine.ts
export interface PlaybackState {
    current: Song | null;
    queue: Song[];
    history: Song[];
    loop: 'off' | 'repeat' | 'queue';
    autoplay: boolean;
    volume: number;
    paused: boolean;
    stopped: boolean;
}

export interface PlaybackPorts {
    player: {
        play(track: Song): Promise<void>;
        pause(): Promise<void>;
        resume(): Promise<void>;
        seek(positionMs: number): Promise<void>;
        stop(): Promise<void>;
        setVolume(volume: number): Promise<void>;
        position(): number;
    };
    sessions: { save(snapshot: SessionSnapshot): Promise<void>; remove(): Promise<void> };
    logger: { warn(message: string): void; error(message: string): void };
}

export class PlaybackEngine {
    play(): Promise<void>;
    pause(): void;
    skip(count?: number): void;
    seek(positionMs: number): void;
    stop(): void;
    destroy(preserveSession?: boolean): Promise<void>;
}
```

`Dispatcher` keeps its current public methods and delegates to the engine. Event
handlers continue to receive `Dispatcher`; no command or event needs a rewrite
just because the engine exists.

## Phase 0 — Baseline and Safety Net

Tasks:
- Tag the current checkpoint locally: `git tag rewrite-baseline-c02d99f`.
- Confirm `experimental/rewrite` is pushed and CI is green.
- Confirm BotTest can be started from the branch without touching `DJBoot`.
- Record the current production commit and DB backup path before any later deploy.
- Create a scratch test database path; never run destructive tests against the
  production SQLite file.

Acceptance:
- `git status` clean except known untracked docs.
- CI green for `c02d99f`.
- BotTest starts on the branch and reaches ready.

## Phase 1 — Characterization Tests

Purpose: describe what the current code does before replacing it. These tests
must fail if a rewrite changes queue, session, timing, or leave behavior.

New test files:
- `tests/dispatcher.play.test.mjs`
- `tests/dispatcher.pause.test.mjs`
- `tests/dispatcher.destroy.test.mjs`
- `tests/session.restore.test.mjs`
- `tests/node.migration.test.mjs`
- `tests/helpers/fake-player.mjs`
- `tests/helpers/fake-timers.mjs`

Fakes:
- `FakePlayer`: records `playTrack`, `setPaused`, `seekTo`, `stopTrack`; emits
  `start`, `end`, `exception`, `stuck`, and `closed`; can reject a track with a
  configurable error.
- `FakeChannel`: records `send`/`edit`/`delete`; returns message IDs.
- `FakeDb`: in-memory `saveSession`, `deleteSession`, `get_247`, settings, and
  session leases; can throw for failure-path tests.
- `FakeTimers`: injected scheduler/clock; no real 3s/6s/9s or timeout waits.

Required cases:

`play()`:
- empty queue/current is a no-op
- stale dispatcher refuses to play
- successful `playTrack` sets current/history and persists
- rejected track re-resolves by URI and retries
- retry delay sequence is 3s, 6s, 9s
- third failure drops the track instead of requeueing forever
- failed track is never made current after failure
- a retry does not shift the queue twice
- `play()` after stop starts from queue head

`pause()`:
- pause sets `paused` and calls the player
- resume clears `paused`
- pause timeout is scheduled only when `get_247` is false and settings timeout > 0
- 24/7 pause does not schedule destroy
- timeout clears on resume/destroy
- persist is called after pause/resume

`skip` / `seek` / `stop`:
- skip trims exactly `skipto - 1` entries
- skip beyond queue length results in empty queue
- seek sends the exact position
- stop clears queue/history/loop/autoplay/seeds, marks stopped, deletes session
- stop calls `stopTrack` exactly once

`destroy()`:
- clears persist/stats/pause/idle timers
- stops the now-playing collector
- clears track-scoped messages and queue-empty prompt
- preserves/replaces session according to `preserveSession`
- destroys a dispatcher only when it is still the current queue entry
- a stale destroy does not tear down a replacement dispatcher
- leave promise resolves after teardown

Session restore:
- valid session joins, restores queue, volume, loop, autoplay, paused state
- saved current resumes at saved position
- empty voice channel waits/drops according to `SESSION_EMPTY_WAIT`
- 24/7 skips the empty-channel wait and pauses at end
- expired/invalid JSON/channel-missing sessions are deleted
- failed restore deletes the session and does not retry forever
- stale `now-playing` panels are removed; setup panel is preserved

Node migration:
- stale session ID triggers rebuild
- queue/current are moved once
- position is sampled before old player teardown
- failed rebuild leaves no duplicate dispatcher
- migration does not requeue the skipped track

Acceptance:
- All new characterization tests pass against `c02d99f`.
- No production code changes in this phase.
- Coverage output includes the target branches (use Node's experimental coverage).

## Phase 2 — PlaybackEngine Contract

Tasks:
- Add `PlaybackState`, `PlaybackPorts`, and `PlaybackEngine` skeleton.
- Implement state transitions only; no Shoukaku calls yet.
- Add adapters:
  - `ShoukakuPlayerPort`
  - `SessionPort`
  - `DispatcherLoggerPort`
- Make `Dispatcher` construct/own an engine and delegate one harmless method
  (`setLoop` or `seek`) as a pilot.
- Keep all existing public signatures.

Tests:
- engine state-machine unit tests for transitions
- dispatcher delegation test
- no event/command changes

Acceptance:
- Build/lint/tests green.
- Pilot delegation does not alter live behavior.
- No duplicated state mutation between `Dispatcher` and engine.

## Phase 3 — Transport Rewrite

Replace, do not copy, the current transport logic.

Implement:
- `play()` with queue head selection, stale guard, retry/backoff, re-resolve,
  failure count, history, and persist
- `pause()/resume()` with timeout policy
- `skip()` / `seek()` / `stop()`
- `stop()` state reset and session deletion

Keep:
- public method signatures
- `failedTracks` semantics
- history cap (100)
- no requeue of a skipped track
- retry backoff (3s / 6s / 9s)
- no failed track left as current

Tests:
- rerun Phase 1 play/pause/skip/seek/stop suites
- add a regression test that a third failure drops and advances
- add a test that stop followed by play uses the persisted default volume
  through the existing queue defaults path

Acceptance:
- All characterization tests pass unchanged.
- Dispatcher transport methods are thin delegates.
- BotTest live pass: play, skip, previous, pause/resume, loop, seek, stop,
  volume persistence.

## Phase 4 — Persistence and Restore Rewrite

Split `src/lib/Session.ts` into:
- `SessionRestorer.ts`: eligibility, lease claim, channel validation, empty
  channel wait, queue/current reconstruction, position resume, failure cleanup
- `SessionLease.ts`: claim/release/expiry policy if still mixed into restore
- `SessionWriter.ts`: already exists; extend only if snapshot fields change

Rules:
- No schema change.
- Save current + queue + loop + autoplay + volume + paused together.
- Position is sampled before player teardown.
- A failed restore deletes the row and does not loop.
- A restore that loses its empty-channel wait drops the session.
- 24/7 bypasses the empty-channel wait.

Tests:
- all Phase 1 restore cases
- lease contention between two bot instances
- save/restore round-trip with current position
- invalid JSON, missing channel, expired session
- restore failure cleanup
- stale now-playing cleanup with setup panel exclusion

Acceptance:
- All restore tests pass.
- `src/lib/Session.ts` is reduced to orchestration or removed if fully replaced.
- BotTest restart resumes at the expected position with the expected queue.

## Phase 5 — Lifecycle, Destroy, and Node Migration

Implement `DestroyCoordinator` and/or `NodeMigrator` behind the engine:
- timer ownership and idempotent teardown
- collector/message cleanup
- session delete vs preserve
- `leavePromise` ordering
- stale dispatcher replacement guard
- player rebuild and queue/current transfer
- position sampling before teardown
- no duplicate migration or double queue shift

Tests:
- all Phase 1 destroy/migration cases
- two dispatchers for one guild during rebuild
- destroy called twice
- destroy while restore is in progress
- node session change with a paused player
- migration failure leaves the old session/queue recoverable

Acceptance:
- All lifecycle tests pass.
- `Dispatcher.destroy()` is a delegate; no timer/collector logic remains.
- BotTest live pass: leave, rejoin, node restart with an isolated Lavalink,
  queue restore.

## Phase 6 — Integrate and Remove the Old Core

Tasks:
- Switch every internal caller to the engine-facing Dispatcher methods.
- Remove dead fields/methods and duplicate state from `Dispatcher`.
- Keep the public API and event names unchanged.
- Update:
  - `src/events/player/*`
  - `src/events/client/VoiceStateUpdate.ts`
  - `src/core/Queue.ts`
  - `src/dashboard/shardApi.ts`
  - `src/lib/SetupSystem.ts`
  - `src/plugin/plugins/reconnectNodes.ts`
- Confirm no command imports internals that moved.

Tests:
- full 153+ suite
- command registration test
- dashboard state/action tests
- `tsc --noEmit`, build, lint
- `git diff --check`

Acceptance:
- No duplicated playback state.
- `Dispatcher` is a façade/event adapter, not a second engine.
- All public imports still resolve.


## Implementation status — phases 2–6

Completed on `experimental/rewrite` after the original snapshot:

| Phase | Commit | Result |
|---|---|---|
| 2 — engine contract | `9d23cd9` | `PlaybackEngine`, `PlaybackState`, `PlaybackPorts`, Shoukaku/session/logger adapters, pilot `setLoop` delegation; 14 engine tests |
| 3 — transport | `f1d8b09` | `play`/`pause`/`skip`/`seek`/`stop`/`previous`/`shuffle`/`isPlaying` are engine delegates; retry backoff and failure-drop pinned by tests |
| 4 — restore | `35bc4ae` | `SessionRestorer` + `SessionLease` extracted; `lib/Session.ts` is a re-export surface; restore/expiry/empty-channel/24-7/failure tests |
| 5 — lifecycle | `f67a566`, `4f76b33` | `DestroyCoordinator` owns teardown and timers; `NodeMigrator` owns snapshot/transfer/resume; 16 lifecycle tests |
| 6 — integration | `fea7fec` | dead `TransportActions` removed; queue default-volume tests; architecture doc; 209 tests, build/lint/tsc/git diff clean |

Behavior intentionally preserved:

- `TrackStart`'s loop button still assigns `dispatcher.loop` directly (as before);
  routing it through `setLoop()` would add a session write that did not exist.
- `destroy()` during `shuttingDown` still clears only the persist/stats intervals
  and the queue-empty prompt, leaving pause/idle timers untouched.
- Transport state lives once in the existing Dispatcher fields and is exposed to
  the engine through `DispatcherPlaybackState`; there is no second copy.

## Phase 7 — Live Staging Matrix

Use the existing Edge/CDP harness against BotTest. Do not use production.

Required checks:

| Area | Check |
|---|---|
| Playback | `!play` joins voice, queues, posts Now Playing |
| Queue | `!queue`, add two tracks, verify order |
| Skip/previous | skip advances; previous returns |
| Pause | pause/resume state and audio |
| Loop | song/queue/off transitions |
| Seek | position changes and does not stop playback |
| Volume | 25 -> stop -> play -> 25 persists |
| Stop | clears queue/session and leaves cleanly |
| Playlist | create/add/autocomplete/load |
| Autoplay | explicit seed, env fallback, related pick |
| Restart | queue/current/position/volume/loop restored |
| Cleanup | one now-playing panel; setup panel preserved |
| Dashboard | `/`, `/api/state`, `/api/player-state`, `/api/player` actions |
| Failover | isolated test Lavalink only; never stop production nodes |

Record each result in `FORK-LOG-2026-11-08.md` with commit, time, and observed
state. A failure blocks merge.

## Phase 8 — Overlap and Dead-Code Audit

Tasks:
- Measure exact and best-match overlap against the upstream LavaMusic tree.
- Report overlap by path and by behavior; do not optimize only line counts.
- Remove unused imports, old helper methods, dead config keys, and stale comments.
- Confirm no copied copyright/legal strings remain.
- Review remaining inherited files and either rewrite or explicitly accept them.
- Update `docs/` with the new architecture and test commands.

Acceptance:
- Overlap report committed.
- No dead Dispatcher fields or duplicate methods.
- `npm run build`, `npm run lint`, `npm test` all green.

## Phase 9 — Merge and Deploy

Tasks:
- Open/merge the rewrite branch only after staging sign-off.
- Confirm CI green on the merge commit.
- Back up the production SQLite database.
- Stop `DJBoot`, pull the merge commit, run `PLAN_ONLY=1 bash scripts/boot.sh`,
  then start and verify ready, slash commands, Lavalink, dashboard.
- Keep the previous production commit and DB backup for rollback.
- Do not deploy a release artifact unless requested.

Rollback:
- restore the DB backup
- check out the previous production commit
- rebuild/start
- verify nodes and a test playback

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Queue/session drift | lost or duplicated tracks | characterization snapshots + restore tests |
| Double timer/collector cleanup | leaks or destroyed replacement | destroy idempotency tests |
| Stale Lavalink session | silent dead player | stale-session tests + isolated failover |
| Failed track retry loop | queue stalls | third-failure drop test |
| Voice leave ordering | new player deleted by old leave | leavePromise ordering tests |
| Schema drift | production data loss | no schema changes without approval |
| Command breakage | user-facing regression | command registration + live matrix |

## Definition of Done

- `PlaybackEngine` owns transport, persistence, lifecycle, and migration.
- `Dispatcher` contains only façade/event wiring.
- `Session.ts` restore logic is replaced or reduced to orchestration.
- No `@ts-ignore`, `@ts-expect-error`, or `as any`.
- All existing tests plus characterization tests pass.
- CI green on the branch.
- Live staging matrix passes on BotTest.
- Overlap report is committed.
- Production deployment is a separate, approved step.

## Commands

```bash
npm run build
npm run lint
npm test
node --test --experimental-test-coverage
git diff --check
```

Per-phase commit rule: one behavior change, one commit, with the test evidence in
the commit message or the rewrite log.
