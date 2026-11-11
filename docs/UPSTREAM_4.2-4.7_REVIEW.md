# Upstream LavaMusic 4.2–4.7 review

**Review date:** 2026-11-11<br>
**Our baseline:** `main` / `dev` at `13c3a335` (BootstrapDJ `4.1.0`)<br>
**Upstream:** `appujet/lavamusic` / `bongodevs/lavamusic` `4.7.0`; tag `v4.7.0` at `ff760bb0`, current upstream `main` at `32e5f737`<br>
**Evidence:** upstream release notes, tags, and `git log v4.1.0..v4.7.0` (977 commits)

## Executive summary

This is not a small patch range. Upstream 4.2–4.7 is a modernization release:
i18next and 32 locale folders, a runtime/database move to Bun + Drizzle +
PostgreSQL/PGlite, documentation and Docker work, and a set of command/player
fixes. The upstream tree has **65 command files** and **one database test file**.

BootstrapDJ has no shared merge base with current upstream. We should treat
upstream as a behavioral reference and port selected fixes, not merge its
runtime or database architecture. Our tree already has much stronger test and
production evidence (**430 tests**, 10-player soak, dashboard/voice systems).

## Material upstream changes

| Area | Upstream evidence | Our state | Recommendation |
|---|---|---|---|
| i18n / locales | `src/structures/I18n.ts`, i18next, `locales/*` with **32 languages**, `/language` command | **Foundation and core migration on `dev`:** i18next, `en-US`/`en-GB`, per-guild language, `/language`, dashboard settings copy, command metadata; long-tail embeds pending | Implement a deliberate i18n foundation; do not copy locale files blindly |
| `/playlocal` | `src/commands/music/PlayLocal.ts` accepts an attachment, validates audio/video MIME, searches with `source: "local"` | **Implemented on `dev`:** attachment-only, MIME/size validation, HTTP-source fallback proven on the current node | Use the supported node source; keep host filesystem paths out |
| Playlist robustness | `3114105a` non-existent load/steal crashes; `7c14d1e5` null checks; playlist deletion with songs | Own playlist implementation and tests | Compare edge cases, add only real gaps |
| Queue/player lifecycle | `925a9612` skip/stop when only current remains; `827207c4` empty-queue errors | Own queue, scheduler, and session tests | Verify semantics with our regression suite; do not port blindly |
| Setup/song-request updates | `639b0209`, `a3276bbc`, `a5740715`, `cfba720e`: stale setup messages, null voice channel, stage channels | Own `SetupSystem` and voice-state tests | Run targeted regressions; port behavior only if our equivalent differs |
| Search picker | `74476f29`: button/search component fix; select menu | Our `/playselect` paged select menu | Likely already covered; compare UX before changing |
| Now-playing / lyrics | `58adae36` requester display; lyrics error handling and subscription fixes | Own now-playing, lyrics, component tests | Verify; add missing regression cases |
| Interaction/command handling | `923b14f9` await/return fixes; autocomplete location; invalid command paths | Strong command-gate and interaction tests | Review targeted behavior, not the whole refactor |
| Runtime/database | Bun, Drizzle, PostgreSQL/PGlite, provider factory, `defaultVolume` column | Node 24, Prisma/SQLite; Bun+Prisma spike failed | Do not port; separate architecture decision |
| Docs/container | VitePress docs, Docker/Docker Compose, Replit/Nix files | Internal docs, host-specific deployment, no Docker | Only if public distribution becomes a goal |

## Fix review notes

### 1. i18n and language support

Upstream moved almost every command, button, event and error string into locale
JSON and added `/language` with autocomplete. The locale structure has six
namespaces (`buttons`, `commands`, `common`, `dev`, `events`, `player`) and uses
Discord localizations for command metadata.

This is the largest user-facing gap. It is also the largest mechanical change:
upstream has 65 commands; our tree has **109 command files / 72 slash commands**
and a dashboard with its own labels. Locale keys cannot simply be copied because
the command surfaces differ.

### 2. `/playlocal`

Upstream's command is not a host-filesystem command in practice. It accepts a
Discord attachment, checks `audio/*` or `video/*`, and asks Lavalink for
`source: "local"` using the attachment URL. The command creates or reuses a
player and adds the first returned track.

Our production node does **not** expose a `local` source manager; its `http`
source resolves the attachment URL and was verified with the test bot. The
implementation therefore uses the supported HTTP path, not a host filesystem
path.

Our `Queue.search()` already treats an absolute HTTP URL as a literal URL, so
`/playlocal` can reuse the normal play path without adding a separate Lavalink
source. The command validates the attachment before calling `runPlayRequest`.

### 3. Playlist and queue fixes

The upstream fixes around non-existent playlists, deleting playlists that still
have songs, null checks, empty-queue skip behavior, and stage/null voice-channel
handling are worth a focused audit. Our tree already has independent playlist,
queue, session, setup, and voice-state tests; this should be a comparison pass,
not a bulk upstream port.

### 4. What not to port

Do not port these as part of parity work:

- Bun, Drizzle, PostgreSQL/PGlite, or the upstream provider factory. Our
  Node/Prisma/SQLite stack is deployed and has a failed Bun+Prisma spike on
  record.
- Docker/Replit/Nix or the upstream docs site unless public distribution
  requirements change.
- The full upstream command set. Several differences are intentional:
  `/search` is folded into `/play`; our queue and management surface is larger;
  upstream has `/language` and `/playlocal` which we are adding on purpose.

## Recommended priority

1. **P0:** `/playlocal` after a Lavalink source spike.
2. **P0:** i18n foundation, English catalog, per-guild language setting, and
   `/language`.
3. **P1:** targeted playlist/queue/setup/now-playing/lyrics parity audit.
4. **P2:** dashboard localization and upstream translation import.
5. **P2:** documentation/container polish only if we decide to distribute the
   fork broadly.
