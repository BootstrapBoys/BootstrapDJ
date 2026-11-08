# Playback architecture

The playback core is split so `Dispatcher` keeps the public surface and event
wiring, while decisions and teardown ordering live in focused modules.

## Modules

| Module | Responsibility |
|---|---|
| `core/Dispatcher.ts` | Public fields/methods, Shoukaku event forwarding, autoplay and queue presentation seams. Transport and lifecycle methods are delegates. |
| `core/player/PlaybackEngine.ts` | Transport decisions: queue-head selection, stale-session guard, retry/resolve backoff, pause/resume policy, skip, seek, stop, previous, shuffle, 24/7 resume and persistence snapshots. |
| `core/player/DestroyCoordinator.ts` | Timer ownership, collector/presentation/prompt cleanup, session delete vs preserve, voice leave ordering, stale replacement guard and `playerDestroy`. |
| `core/player/NodeMigrator.ts` | Snapshot before teardown, rebuild on another node, one-time queue/current/history transfer and position/paused resume. |
| `core/player/SessionRestorer.ts` | Restore eligibility, lease claim, channel validation, empty-channel wait, queue/current reconstruction and failure cleanup. |
| `core/player/SessionLease.ts` | Fleet lease refresh and standby takeover ticks. |
| `core/player/*Port.ts` | Shoukaku player, session store and logger adapters. |

## State ownership

`Dispatcher` still exposes `current`, `queue`, `history`, `loop`, `autoplay`,
`paused`, `stopped`, `previous`, `seed`, `seeds`, `pauseWhenEmpty` and
`paused247` because events, commands, the dashboard and tests read or mutate
them. The engine receives a `PlaybackState` adapter over those same fields
(`DispatcherPlaybackState`); there is no second copy of playback state.

## Invariants

- A stale dispatcher cleans its own timers/messages but never leaves voice or
  emits `playerDestroy`; a replacement player is never torn down by an old
  timer or collector.
- `destroyAndWait` settles only after `leaveVoiceChannel` resolves, so a rebuild
  cannot have its new player deleted by the previous leave request.
- A failed play retries by URI at 3s/6s/9s; the third counted failure drops the
  track instead of requeueing it forever, and a failed track is never left as
  `current`.
- Position is sampled before teardown and moved once. `resumePosition` wins
  over the live player position when a node switch sampled it.
- Restore deletes the session row on any failure so a bad payload is not
  reclaimed on every handoff tick.
- Public method signatures and event names are unchanged.

## Verification

```bash
npm run build
npm run lint
npm test
git diff --check
```

Playback-phase tests:

- `tests/playback-engine.test.mjs` — state machine and delegation
- `tests/dispatcher.playback.test.mjs` — play/pause/skip/seek/stop contract
- `tests/dispatcher.destroy.test.mjs` — teardown ordering and idempotency
- `tests/node.migration.test.mjs` — snapshot/transfer/resume and failure
- `tests/session.restore.test.mjs` — restore, empty channel, 24/7 and cleanup
- `tests/queue.defaults.test.mjs` — default volume/loop/autoplay on create
