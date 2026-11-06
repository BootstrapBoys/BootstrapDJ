# Jockie parity — experimental branch

**Scope correction (2026-11-05):** full feature parity with Jockie’s public feature set.
Every feature is to remain free; no premium gate is to be introduced. Admin/owner
restrictions may exist for safety, but they are not paid restrictions.

Reference command list: <https://www.jockiemusic.com/commands> (retrieved 2026-11-05).

This branch is additive and experimental. It does **not** change `main`.

## Implemented so far

### Queue state
- `reverse`, `sort`, `swap`, `massremove`, `massmove`
- `removeduplicates`, `removekeyword`, `removeuser`, `removeabsent`, `removelast`
- `selectrandom`, `recentlyplayed` (`history` alias); queue totals and upcoming tracks are folded into `/queue`

### Track state
- `backward`, `forward`, `previous`, `endtime`, `voteskip`, `shufflerepeat`; `seek` covers start-time seeking
- Existing `move`, `replay`, `seek`, `skip`, `skipto`, `loop`, `shuffle`, `remove`, `clearqueue`, `volume`, and filter commands remain unchanged.
- Jockie-compatible prefix aliases: `rewind`, `restart`, `windto`, `clear`.

### Playback / search
- `playrecent` (persistent recent history), `playselect` (paginated page picker), `playleave`, `radio`
- Search is built into `/play`; the standalone `/search` command was removed
- `album`, `artist`, `playlistsearch`, `top`
- Existing `play`, `playnext`, and playlist commands remain.

### Information / utility
- `/utility` grouped page selector for `overview`, `stats`, `shards`, `categories`, `faq`, `tip`, `premium`, `support`, `leaderboard`, `commands`, `dashboard`; the individual pages remain prefix commands.
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

The prefix and slash entry paths now share `src/utils/CommandGate.ts`; the gate owns permission, channel, voice, DJ, cooldown and argument checks while each adapter keeps its own reply lifetime. `/play` and `/playnext` share `src/utils/PlayRequest.ts`, which also adds the missing no-node guard and awaited replies to play-next.
- `profile` (color, bio, privacy, visibility)
- `selfprefix` (personal prefix; prefix-only)
- `settings commandchannel` and `settings voicechannel` gates for slash and prefix commands.

### Sessions / playlists
- `sessionstats`, `save`.

## Remaining parity families

These are the remaining implementation items. Locally reproducible features are
being completed first; public listing/clone services are explicitly out of scope for a self-hosted deployment.

- **Profile:** color, bio, background, avatar shape/border, privacy, visibility, and server visibility are implemented.
- **Games:** guess-the-song with persistent wins/plays and leaderboard is implemented.
- **Announcements:** opt-in text announcements are implemented. Voice/TTS announcements are intentionally out of scope.
- **Prefix modes:** personal prefix set/reset/list and comma-combined server prefixes are implemented.
- **Permission modes:** claim/transfer ownership and per-command allow/deny rules are implemented; rebind/session/property modes are intentionally simplified away.
- **Command routing:** text/voice gates, thread policy (`settings allowthreads`), disabled-command filtering, session lock, autocorrect execution, vote-skip percentages, and `/utility commands` status listing are implemented.
- **Settings families:** max/min track length, queue size, max user tracks, max user track length, playlist track count and duration, listener/pause/idle timeouts, timeout confirmation prompt, auto-delete, ephemeral/public slash replies (`settings ephemeral`), prefix combine, per-guild search type, session lock, thread policy, and autocorrect execution are implemented; adaptive loudness is implemented via cached ffmpeg LUFS sampling; preferred-bot ordering still requires multiple bot accounts/instances.
- **24/7 mode:** stays connected and bypasses listener, pause, idle, and confirmation timeouts. If the channel empties, it pauses at the current track end and resumes/restarts when a listener joins; an explicit `/playleave` still leaves.
- **Premium equivalents:** `/premium` reports the free policy; there are no paid commands. Jockie-specific boost/perk cosmetics remain.
- **Owner tools:** dev-only restart, shutdown, and command reload are implemented.
- **Dashboard / hosted surfaces:** local dashboard is implemented at `DASHBOARD_PORT` (loopback by default) with player controls, the live queue, filter toggles, a categorized settings editor covering every setting, and a statistics page (sessions, listen time, track types, hourly/weekday activity, most played, most listened, top commands). `/utility dashboard` links to `DASHBOARD_PUBLIC_URL` (or derives the origin from the OAuth redirect URI).
- **Multi-bot:** `BOTS_FILE` launches one client per token, heartbeats bots, routes voice commands to the first active bot in `preferredOrder`, and uses a durable `SessionLease` for automatic session handoff after the owner stops heartbeating. The lease is atomically claimed, refreshed every 10 s, and expires after 60 s.

## Known limitations

- `playrecent` stores the newest 100 tracks per guild in `RecentTrack`; it no longer depends on dispatcher lifetime.
- `playselect` paginates playlist/search results 25 at a time with a select menu.
- Custom aliases and mappings affect the prefix path; registering aliases as slash commands was rejected because it consumes the limited top-level command slots.
- Any command that changes the queue persists through the existing session row.

## Verification

- `tsc --noEmit`
- `eslint .`
- `npm test` — 136 tests at the latest branch commit.

Storage: WAL mode and bounded stats retention are documented in [`docs/STORAGE.md`](STORAGE.md).

Dashboard: `DASHBOARD_PORT=8795` on the bot host, loopback-bound by default; set `DASHBOARD_TOKEN` before binding non-loopback.

Slash registration: **71 top-level commands** after grouping (`/utility`, `/filter`); child info/filter names remain prefix commands. `/collection` is the sole slash playlist interface; the legacy playlist commands remain prefix-only for compatibility.

## Playlist consolidation

`/collection` and the legacy playlist commands operate on the same `Playlist`/`Song` tables. `/collection` now covers list/create/delete/view/add/remove/removesong/load/save/rename/copy/clone/merge/clear/share/import/unshare/shares. The old `/create`, `/delete`, `/add`, `/load`, `/list`, `/save`, and `/removesong` commands are prefix-only.

## Out of scope

This branch is for a self-hosted bot, not a public bot network.

- Bot-list voting, vote webhooks, and vote leaderboards
- Public clone services and dynamic clone assignment
- Any external control plane for preferred-bot routing; the local `BOTS_FILE`, session leases, and preferred order are sufficient

## Search engines

Prefix commands default to `PREFIX_SEARCH_ENGINE` (`ytsearch`) while slash commands keep the per-guild `searchtype`/`SEARCH_ENGINE` value. URLs are resolved directly and ignore the search engine. In the setup/song-request channel, any known prefix command falls through to the normal command path; only ordinary messages remain append-only song requests.
