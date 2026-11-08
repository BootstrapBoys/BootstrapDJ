# Playlist Ordering Plan

Problem: `Song.id` is a random UUID, but `PlaylistStore.songs()` orders by
`id: 'asc'`. Playlist display, load, copy, remove-at, and share/import therefore
operate in arbitrary UUID order, not insertion order.

Current code:
- `prisma/schema.prisma`: `Song` has no position column.
- `src/data/playlists.ts`: `songs()` uses `orderBy: { id: 'asc' }`.
- Existing rows cannot recover their original insertion order because no
  timestamp or ordinal was stored. The migration can only preserve the current
  visible order.

## Goal

Make playlist order deterministic and preserve the order users see today.

Definition of done:
- New tracks append to the end.
- Existing rows get stable ordinal positions.
- Display, load, copy/import, share, and remove-at all use the same order.
- Concurrent adds do not create duplicate positions.
- All tests and staging pass; production deploy is separately approved.

## Prerequisite: Repo-Wide Formatting

`npm run format` is currently red on **163 pre-existing files**. The playlist
schema migration must not be mixed with a repository-wide formatting diff.

Do this first, on its own branch/commit:

1. Capture the baseline:
   ```bash
   npm run format > /tmp/format-before.log 2>&1 || true
   ```
2. Run the formatter:
   ```bash
   npm run format:fix
   ```
3. Review the diff for semantic changes; formatting must not alter logic.
4. Run:
   ```bash
   npm run build
   npm run lint
   npx tsc --noEmit -p tsconfig.json
   npm test
   npm run format
   git diff --check
   ```
5. Commit only the formatting changes, with a message such as
   `style: format repository with prettier`.
6. Keep that commit separate from the playlist schema/migration commit.
7. Add `npm run format` as a CI gate after the formatting commit is green.

If the formatter would touch generated files or vendored assets, add them to
`.prettierignore` rather than editing them. Do not reformat `dist/`,
`node_modules/`, or generated Prisma client output.

Acceptance:
- `npm run format` exits 0.
- Build/lint/tsc/tests unchanged.
- Diff contains formatting only.
- CI enforces the format check.

This adds roughly **0.5 day** and must land before the schema migration.

## Schema Change

Add a position column to `Song`:

```prisma
model Song {
  id         String   @id @default(uuid())
  track      String
  playlistId String
  trackKey   String?
  position   Int      @default(0)
  playlist   Playlist @relation(fields: [playlistId], references: [id])

  @@unique([track, playlistId])
  @@index([playlistId])
  @@index([playlistId, trackKey])
  @@index([playlistId, position])
}
```

Do not add a unique constraint on `(playlistId, position)` initially. It makes
legacy backfill and concurrent repair harder; use a transaction and retry
handling instead. A composite index is sufficient for ordering and max lookup.

## Backfill Strategy

Because existing data has no insertion metadata, backfill each playlist by the
current `id: 'asc'` order. That preserves exactly what users see now; it does not
reconstruct the original order.

1. Add `position Int @default(0)` via Prisma schema and `prisma db push`.
2. Run a one-time backfill in `src/data/prisma.ts` or a dedicated tool:
   - iterate playlists
   - fetch songs ordered by `id: 'asc'`
   - update each row to `position = index`
   - wrap each playlist in a transaction
3. Make the backfill idempotent:
   - skip playlists whose positions are already a strict `0..n-1` sequence
   - detect all-zero or duplicate positions and rewrite them
4. New empty databases skip the backfill.

Do not run a destructive reseed. Back up the DB before the first production
schema change.

## Store API Changes

`src/data/playlists.ts`:

- `songs()`: `orderBy: [{ position: 'asc' }, { id: 'asc' }]`
- `addSong()`:
  - in a transaction, compute `max(position) + 1` for the playlist
  - create the Song with that position
  - retry once on a duplicate/constraint conflict
- `removeAt()`: use the same ordered list, then delete by row id
- `removeSong()` / `clear()`: unchanged semantics
- `legacyDuplicate()` / dedupe: unchanged, but backfill before enabling order
- `copyTracks()`: call `addSong()` in order so imported/copied playlists retain
  source order

`src/core/player/*` and commands need no API change; they consume `Song[]`.

## Migration and Backfill Order

For a fresh DB:
1. `prisma db push`
2. no backfill needed

For an existing DB:
1. back up SQLite
2. stop the bot
3. `prisma db push`
4. run backfill
5. verify counts/order
6. start bot

Do not run the backfill while multiple bot processes are writing the same DB.

## Concurrency

Two simultaneous adds can read the same max position. Use one of:

- interactive Prisma transaction around `aggregate(max)` + `create`, with
  SQLite's write lock; or
- a unique `(playlistId, position)` constraint and retry on P2002.

The plan prefers the transaction first; if Prisma/SQLite still shows duplicates
under a concurrency test, add the unique constraint and bounded retry.

## Tests

Add to `tests/playlist.test.mjs` or a new `tests/playlist-order.test.mjs`:

- add A, B, C -> songs are A, B, C
- remove B -> A, C
- removeAt 2 -> removes C
- clear then add -> order restarts
- copy/import preserves source order
- legacy rows with all-zero positions are backfilled to current visible order
- backfill is idempotent
- two concurrent adds produce distinct positions
- session/queue load from playlist preserves order
- share/import preserves order

Run:
```bash
npm run build
npm run lint
npx tsc --noEmit -p tsconfig.json
npm test
git diff --check
```

## Rollout

1. Implement on `experimental/rewrite`; test against a copy of BotTest DB.
2. Verify `/playlist view`, load, copy, import, remove-at against BotTest.
3. Back up production DB and record the path.
4. Stop `DJBoot`; run `prisma db push` and backfill; build/start.
5. Verify a known playlist order and a load into voice.
6. Keep the DB backup and previous commit for rollback.

Rollback:
- restore the DB backup
- check out the previous production commit
- rebuild/start
- verify bot and playlist read path

## Risks

| Risk | Mitigation |
|---|---|
| Existing users’ intended order is unrecoverable | preserve current visible UUID order and document it |
| Schema push rebuilds SQLite table | backup first; test on copy |
| Concurrent adds duplicate positions | transaction/unique retry; concurrency test |
| Partial backfill | per-playlist transaction; idempotent rerun |
| Old client reads new column | SQLite tolerates extra columns; rollback via DB backup |
| Playlist imports reorder | copy through `addSong()` in source order |

## Status

Implemented on `experimental/rewrite`: formatting commit `7e7ed43`; schema/order commit `98a64dc`. BotTest DB migrated after backup `/root/BotTestDBBackups/20261108-201101.db`; existing `SmokeList` backfilled to strict positions `0..19`; live append produced 39 tracks at `0..38`. Production not migrated; deploy remains pending approval.

## Estimate

- Schema + data changes: 2–4 hours
- Tests and concurrency: 2–3 hours
- BotTest/production rollout and verification: 1–2 hours
- Formatting cleanup: ~0.5 day (separate commit)
- Schema/order implementation: 0.5–1 focused day
- Total: **1–1.5 focused days**, plus deploy approval
