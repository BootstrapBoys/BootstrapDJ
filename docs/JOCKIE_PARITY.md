# Jockie parity — experimental branch

**Scope correction (2026-11-05):** full feature parity with Jockie’s public feature set.
Every feature is to remain free; no premium gate is to be introduced. Admin/owner
restrictions may exist for safety, but they are not paid restrictions.


Reference command list: <https://www.jockiemusic.com/commands> (retrieved 2026-11-05).

This branch is additive and experimental. It does **not** change `main`.

## Implemented in this batch

### Queue state
- `reverse`, `sort`, `swap`, `massremove`, `massmove`
- `removecurrent`, `removeduplicates`, `removekeyword`, `removeuser`, `removeabsent`, `removelast`
- `selectrandom`, `nextup` (`upcoming` alias), `recentlyplayed` (`history` alias)

### Track state
- `backward`, `forward`, `previous`
- Existing `move`, `replay`, `seek`, `skip`, `skipto`, `loop`, `shuffle`, `remove`, `clearqueue`, `volume`, and filter commands remain unchanged.

### Playback / search
- `playrecent`
- `playsingle` (random single track from a playlist or search result)

### Information / utility
- `stats`, `shards`, `categories`, `faq`, `tip`, `premium`, `support`, `leaderboard`
- Aliases added: `about`, `searchlyrics`, `rewind`, `restart`, `windto`, `clear`

### Sessions / playlists
- `sessionstats`, `save`

### Playback / lookup
- `starttime`, `endtime`, `voteskip`, `shufflerepeat`, `playselect`
- `album`, `artist`, `playlistsearch`, `top`

### Games
- `guess`

### Collections
- `collection` with list/create/delete/view/add/remove/load/rename/copy/merge/clear actions

### Settings / permissions / aliases / mappings
- `settings` (per-guild key/value store, applied to new players for volume, repeat, autoplay, shuffle)
- `permissions` (per-command allow/deny rules for users and roles, enforced in slash and prefix paths)
- `alias` (server and user custom aliases, resolved in the prefix path)
- `mappings` (server and user shortcut expansions, resolved in the prefix path)

### Filters
- `filters` (active filter status)
- `rate`

## Deliberately skipped

- **Overlap:** `play`, `pause`, `resume`, `skip`, `queue`, `nowplaying`, `loop`, `shuffle`, `volume`, `remove`, `seek`, `lyrics`, basic playlist create/add/delete/load, `setup`, `prefix`, `dj`, `247`, autoplay.
- **Premium/community:** premium, leaderboards, votes, profile cosmetics, boosts, multi-bot ownership, dashboard access.
- **Unsupported/infrastructure-specific:** dashboard, custom web pages, Jockie clones, bot-list votes, permission modes that require the Jockie host, shard management beyond the current single shard.
- **Large settings/collection families:** text/voice announcements, command enable/disable, custom aliases/mappings, permission matrices, collection sharing/import/export. These need a separate data model and command-routing pass.

## Known limitations

- `massmove`, `reorder`, `sort` variants beyond the implemented field set, and `playselect` are not included yet.
- `playrecent` uses in-memory history (same lifetime as the dispatcher), not a persistent recent-tracks table.
- `playsingle` treats playlist/search results as one pick; it does not implement Jockie's page-selection UI.
- Any command that changes the queue persists through the existing session row.

## Verification

- `tsc --noEmit`
- `eslint .`
- `npm test` (79 tests at the time of this branch)
