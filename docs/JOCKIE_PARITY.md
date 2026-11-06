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
- `playrecent`, `playsingle`, `playselect`, `playleave`, `radio`
- `album`, `artist`, `playlistsearch`, `top`
- Existing `play`, `playnext`, `search`, and playlist commands remain.

### Information / utility
- `/utility` grouped page selector for `overview`, `stats`, `shards`, `categories`, `faq`, `tip`, `premium`, `support`, `leaderboard`; the individual pages remain prefix commands.
- Aliases added: `about`, `searchlyrics`.

### Games
- `guess` (button-based guess-the-song) with persistent win/play scores.
- `leaderboard` includes game scores alongside session request counts.

### Collections
- `collection` with list/create/delete/view/add/remove/load/rename/copy/merge/clear actions.

### Settings / permissions / aliases / mappings
- Autoplay source, seeds, and reset are available through `settings autoplaysource|autoplayseeds|autoplayreset`; the old `/autoplayconfig` name remains a prefix command.
- `settings` (per-guild key/value store, applied to new players for volume, repeat, autoplay, shuffle).
- `permissions` (per-command allow/deny rules for users and roles, enforced in slash and prefix paths).
- `alias` (server and user custom aliases, resolved in the prefix path).
- `mappings` (server and user shortcut expansions, resolved in the prefix path).

### Filters
- `/filter` grouped selector for 8D, bass boost, distortion, karaoke, nightcore, pitch, rate, reset, rotation, speed, tremolo, vibrato, and low-pass; child filter names remain prefix commands. `filters` reports active filters.

### Profile / prefixes / gates
- `profile` (color, bio, privacy, visibility)
- `selfprefix` (personal prefix; prefix-only)
- `settings commandchannel` and `settings voicechannel` gates for slash and prefix commands.

### Sessions / playlists
- `sessionstats`, `save`.

## Remaining parity families

These are the remaining implementation items. Locally reproducible features are
being completed first; external-service features are listed explicitly.

- **Profile:** color, bio, background, avatar shape/border, privacy, visibility, and server visibility are implemented.
- **Games:** guess-the-song with persistent wins/plays and leaderboard is implemented.
- **Announcements:** opt-in text announcements are implemented. Voice/TTS announcements are intentionally out of scope.
- **Prefix modes:** personal prefix set/reset/list and comma-combined server prefixes are implemented.
- **Permission modes:** claim/transfer ownership and per-command allow/deny rules are implemented; rebind/session/property modes are intentionally simplified away.
- **Command routing:** text/voice gates, thread policy (`settings allowthreads`), disabled-command filtering, session lock, autocorrect execution, vote-skip percentages, and `/utility commands` status listing are implemented.
- **Settings families:** max/min track length, queue size, max user tracks, max user track length, playlist track count and duration, listener/pause/idle timeouts, auto-delete, prefix combine, per-guild search type, session lock, thread policy, and autocorrect execution are implemented; timeout confirmation, preferred bots, and adaptive loudness remain; fixed-target automatic volume is implemented.
- **Premium equivalents:** `/premium` reports the free policy; there are no paid commands. Jockie-specific boost/perk cosmetics remain.
- **Owner tools:** dev-only `restart` and process-stop command are implemented; safe command reload remains.
- **Dashboard / hosted surfaces:** local dashboard is implemented at `DASHBOARD_PORT` (loopback by default) with player controls, the live queue, filter toggles, and a categorized settings editor. Bot-list votes/clones still require external services.

## Known limitations

- `playrecent` uses in-memory history (same lifetime as the dispatcher), not a persistent recent-tracks table.
- `playsingle`/`playselect` use a single pick; they do not implement Jockie's page-selection UI.
- Custom aliases and mappings affect the prefix path; Discord slash-command names are registered statically and cannot be added at runtime.
- Any command that changes the queue persists through the existing session row.

## Verification

- `tsc --noEmit`
- `eslint .`
- `npm test` — 86 tests at the latest branch commit.

Dashboard: `DASHBOARD_PORT=8795` on the bot host, loopback-bound by default; set `DASHBOARD_TOKEN` before binding non-loopback.

Slash registration: **84 top-level commands** after grouping (`/utility`, `/filter`); child info/filter names remain prefix commands.
