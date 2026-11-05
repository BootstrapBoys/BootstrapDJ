# Jockie parity — experimental branch

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
