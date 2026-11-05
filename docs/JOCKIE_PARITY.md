# Jockie parity — experimental branch

**Scope correction (2026-11-05):** full feature parity with Jockie’s public feature set.
Every feature is to remain free; no premium gate is to be introduced. Admin/owner
restrictions may exist for safety, but they are not paid restrictions.

Reference command list: <https://www.jockiemusic.com/commands> (retrieved 2026-11-05).

This branch is additive and experimental. It does **not** change `main`.

## Implemented so far

### Queue state
- `reverse`, `sort`, `swap`, `massremove`, `massmove`
- `removecurrent`, `removeduplicates`, `removekeyword`, `removeuser`, `removeabsent`, `removelast`
- `selectrandom`, `nextup` (`upcoming` alias), `recentlyplayed` (`history` alias)

### Track state
- `backward`, `forward`, `previous`, `starttime`, `endtime`, `voteskip`, `shufflerepeat`
- Existing `move`, `replay`, `seek`, `skip`, `skipto`, `loop`, `shuffle`, `remove`, `clearqueue`, `volume`, and filter commands remain unchanged.
- Jockie-compatible prefix aliases: `rewind`, `restart`, `windto`, `clear`.

### Playback / search
- `playrecent`, `playsingle`, `playselect`
- `album`, `artist`, `playlistsearch`, `top`
- Existing `play`, `playnext`, `search`, and playlist commands remain.

### Information / utility
- `stats`, `shards`, `categories`, `faq`, `tip`, `premium`, `support`, `leaderboard`
- Aliases added: `about`, `searchlyrics`.

### Games
- `guess` (button-based guess-the-song).

### Collections
- `collection` with list/create/delete/view/add/remove/load/rename/copy/merge/clear actions.

### Settings / permissions / aliases / mappings
- `settings` (per-guild key/value store, applied to new players for volume, repeat, autoplay, shuffle).
- `permissions` (per-command allow/deny rules for users and roles, enforced in slash and prefix paths).
- `alias` (server and user custom aliases, resolved in the prefix path).
- `mappings` (server and user shortcut expansions, resolved in the prefix path).

### Filters
- `filters` (active filter status), `rate`; existing 8D, bass boost, distortion, karaoke, nightcore, pitch, rotation, speed, tremolo, vibrato, and low-pass commands remain.

### Sessions / playlists
- `sessionstats`, `save`.

## Remaining parity families

These are **not** complete yet; they are the next implementation waves, not
deliberate exclusions.

- **Profile:** profile card, color, background, avatar shape/border, privacy/visibility, server visibility.
- **Games:** game leaderboards and any variants beyond guess-the-song.
- **Announcements:** text/stage/voice announcements, templates, auto-delete, extended announcements, status defaults.
- **Prefix modes:** self prefixes, combine, server/self add-remove-set-reset/list.
- **Permission modes:** claim/rebind/transfer ownership, session/property/permission modes.
- **Command routing:** disable/enable/toggle, disabled-command listing, text/voice channel gates and message/thread policies.
- **Settings families:** max user tracks, max track length, playlist limits, search type, auto-delete, 24/7, lock, timeout, auto-correct, preferred bots, volume automation.
- **Premium equivalents:** perks, boosts, renew, and any other formerly paid command—built locally and free.
- **Owner tools:** shard/status/restart/reload equivalents that are safe and permission-gated.
- **Dashboard / hosted surfaces:** local equivalents where technically possible; bot-list vote/clone-only features cannot be reproduced without those external services.

## Known limitations

- `playrecent` uses in-memory history (same lifetime as the dispatcher), not a persistent recent-tracks table.
- `playsingle`/`playselect` use a single pick; they do not implement Jockie's page-selection UI.
- Custom aliases and mappings affect the prefix path; Discord slash-command names are registered statically and cannot be added at runtime.
- Any command that changes the queue persists through the existing session row.

## Verification

- `tsc --noEmit`
- `eslint .`
- `npm test` — 83 tests at the latest branch commit.
