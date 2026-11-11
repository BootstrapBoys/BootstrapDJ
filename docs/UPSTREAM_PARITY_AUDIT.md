# Upstream parity audit — playlist, queue, setup, now-playing, lyrics

**Scope:** LavaMusic 4.2–4.7 behavior called out in
`docs/UPSTREAM_4.2-4.7_REVIEW.md`.<br>
**Method:** compare upstream behavior with our lifecycle and existing regression
coverage. Port behavior only when a real gap exists; do not bulk-merge the
upstream runtime.

| Area | Upstream reference | Our result | Evidence |
|---|---|---|---|
| Playlist deletion with songs | `3114105a`, `7c14d1e5` | **Already covered.** Delete removes the playlist and its song rows; a missing playlist returns false. | `tests/playlist.test.mjs` |
| Non-existent playlist load/steal | `3114105a` | **Already covered.** `Collection` resolves the playlist before load/copy actions and refuses unknown names. | `src/commands/manage/Collection.ts`, `tests/playlist.test.mjs` |
| Skip/stop with only the current track | `925a9612` | **Fixed.** `/skip` now advances the current track when the queue is empty instead of refusing. | `src/commands/music/Skip.ts`, `tests/skip-current.test.mjs` |
| Empty-queue errors | `827207c4` | **Covered.** Control commands return a localized “nothing playing/no queue” response before mutating state. | command tests and `tests/command-gate.test.mjs` |
| Setup null voice/stage handling | `639b0209`, `a3276bbc`, `a5740715`, `cfba720e` | **Already covered.** Stage channels are accepted and unsuppressed; empty-channel teardown is guild-scoped and re-checks the live player. | `src/events/client/VoiceStateUpdate.ts`, `tests/voicestate.test.mjs`, `tests/command-gate.test.mjs` |
| Search picker behavior | `74476f29` | **Already covered.** `/playselect` keeps the paged select-menu contract; no speculative rewrite. | `tests/commands.test.mjs`, command implementation |
| Now-playing requester display | `58adae36` | **Already covered.** The compact now-playing embed includes requester, duration and progress. | `src/commands/music/Nowplaying.ts`, `tests/nowplaying.test.mjs` |
| Lyrics failure handling and cache | upstream fixes | **Already covered.** Provider failures fall through, misses return a clear reply, and successful results are cached with a bounded size/TTL. | `src/commands/music/Lyrics.ts`, `tests/lyrics.test.mjs` |
| Runtime/database/docs/container | upstream 4.2–4.7 | **Deliberately not ported.** Node/Prisma/SQLite and the existing deployment remain the supported path. | `docs/I18N.md` |

## Verification

The parity phase gate is the normal repository gate (`npm run format`,
`npm run i18n:validate`, `npm run lint`, `npm run build`, `npm test`), with the
new skip regression included. Live Discord behavior still needs the user’s test
pass; this audit only closes code and regression-test gaps.
