# BootstrapDJ

BootstrapDJ is a self-hosted Discord music bot built with TypeScript, Discord.js,
Shoukaku, Lavalink v4, and Prisma. It supports slash commands and text prefix
commands, and every feature is available without a premium tier.

<p align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1029680163790794772&permissions=4298238976&scope=bot%20applications.commands">Invite BootstrapDJ</a>
  ·
  <a href="https://github.com/zebz213/BootstrapDJ/issues">Report a bug</a>
</p>

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Node.js >= 24.17](https://img.shields.io/badge/node-%3E%3D24.17-43853D.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg)](https://www.typescriptlang.org/)

## Features

- **Slash and prefix commands** — one command set through two entry points.
- **Lavalink playback** — queueing, seeking, skipping, looping, shuffling, radio,
  fair play, and saved recent history.
- **Search** — YouTube, SoundCloud, Deezer, and other Lavalink sources. Prefix
  commands and slash commands can use separate default engines.
- **Queue tools** — reverse, sort, swap, mass move/remove, remove duplicates,
  remove by keyword/user/absence, random selection, and previous-track replay.
- **Music filters** — 8D, bass boost, distortion, karaoke, nightcore, pitch,
  rate, rotation, speed, tremolo, vibrato, and low-pass effects through
  `/filter`, plus `/filters` to inspect active effects.
- **Autoplay** — Deezer chart seeds, curated fallback seeds, and weighted
  related-track discovery.
- **Collections** — create, load, share, import, merge, rename, copy, and clear
  playlists through `/collection`.
- **Song-request channel** — ordinary messages become song requests; known
  prefix commands still work there.
- **Saved sessions** — queues survive a restart when session restore is enabled.
- **Multi-bot handoff** — optional local multi-process setup with atomic session
  leases and automatic takeover.
- **Dashboard** — Discord OAuth login, player controls, live queue, filters,
  every guild setting, and listening statistics.
- **Per-guild settings** — permissions, DJ mode, channels, timeouts, limits,
  prefix behavior, ephemeral replies, aliases, and command mappings.
- **Opt-out voice listener integration** — optional local listener bridge; audio
  from opted-out members is discarded before transcription.

## Requirements

- **Node.js 24.17 or newer**
- **Lavalink v4** (the bot connects over the Lavalink protocol; it does not run
  Lavalink for you)
- A Discord application and bot token
- SQLite (bundled through Prisma; no separate database server required)

Optional:

- A second Lavalink instance for voice failover
- LavaSrc or another Lavalink plugin for Deezer, Spotify, Apple Music, and
  similar sources
- A reverse proxy in front of the dashboard for HTTPS

## Quick start

1. Clone the repository:

    ```bash
    git clone https://github.com/zebz213/BootstrapDJ.git
    cd BootstrapDJ
    ```

2. Install dependencies. `postinstall` generates the Prisma client:

    ```bash
    npm ci
    ```

3. Create the environment file:

    ```bash
    cp .env.example .env
    ```

    Open `.env` and set at least:

    ```dotenv
    BOT_TOKEN="your-bot-token"
    OWNER_IDS=["your-discord-user-id"]
    LAVALINK_URL="127.0.0.1:2333"
    LAVALINK_AUTH="your-lavalink-password"
    LAVALINK_SECURE="false"
    ```

    `.env.example` contains the full, commented configuration. Do not commit
    `.env`.

4. Make sure Lavalink is running and reachable at the configured URL.

5. Build and start:

    ```bash
    npm run build
    npm start
    ```

    For a process manager, run the built entry point instead of rebuilding on
    every restart:

    ```bash
    npm run build
    pm2 start dist/index.js --name BootstrapDJ
    ```

6. Invite the bot with the link above. The permissions integer includes the
   voice, message, and application-command permissions BootstrapDJ needs.

## Configuration

The complete reference is [`.env.example`](.env.example). The most important
groups are:

| Group     | Variables                                                                                                   | Notes                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Discord   | `BOT_TOKEN`, `TOKEN`, `CLIENT_ID`, `GUILD_ID`, `PRODUCTION`                                                 | `BOT_TOKEN` wins over the legacy `TOKEN` alias. `GUILD_ID` enables single-guild mode.                     |
| Commands  | `PREFIX`, `OWNER_IDS`                                                                                       | `PREFIX` accepts comma-separated prefixes. `OWNER_IDS` is a JSON array.                                   |
| Presence  | `BOT_STATUS`, `BOT_ACTIVITY`, `BOT_ACTIVITY_TYPE`, `BOT_STATUS_MODE`                                        | `BOT_STATUS_MODE` is `static`, `track`, or `count`.                                                       |
| Search    | `SEARCH_ENGINE`, `PREFIX_SEARCH_ENGINE`                                                                     | Slash commands use the guild `searchtype` or `SEARCH_ENGINE`; prefix commands use `PREFIX_SEARCH_ENGINE`. |
| Limits    | `MAX_QUEUE_SIZE`, `MAX_PLAYLIST_SIZE`                                                                       | Per-guild limits can also be set with `/settings`.                                                        |
| Autoplay  | `AUTOPLAY_CHART`, `AUTOPLAY_SEEDS`, `AUTOPLAY_SEED`                                                         | Chart, curated seeds, then a final fallback seed.                                                         |
| Lavalink  | `LAVALINK_URL`, `LAVALINK_AUTH`, `LAVALINK_SECURE`, `LAVALINK_FALLBACKS`                                    | `LAVALINK_FALLBACKS` is a JSON array of standby nodes.                                                    |
| Sessions  | `SESSION_RESTORE_AGE`, `SESSION_EMPTY_WAIT`                                                                 | Restore a saved queue for up to six hours by default.                                                     |
| Messages  | `COMMAND_DELETE_AFTER`, `SETUP_CLEANUP_INTERVAL`                                                            | Set either to `0` to disable that timer.                                                                  |
| Storage   | `DATABASE_URL`, `STATS_RETENTION_DAYS`, `STATS_INACTIVE_DAYS`, `STATS_PRUNE_INTERVAL_HOURS`                 | SQLite defaults to `prisma/bootstrapdj.db`; WAL mode is enabled at startup.                               |
| Dashboard | `DASHBOARD_PORT`, `DASHBOARD_HOST`, `DASHBOARD_PUBLIC_URL`, `DASHBOARD_OAUTH_*`, `DASHBOARD_SESSION_SECRET` | `DASHBOARD_PORT=0` disables the dashboard.                                                                |
| Multi-bot | `BOTS_FILE`, `BOT_NAME`, `BOT_ID`, `BOT_PRIORITY`                                                           | Optional local child-process setup; see below.                                                            |

### Slash replies and ephemeral mode

Slash replies are private by default. An admin or owner can change the guild
setting with:

```text
/settings ephemeral false
```

With `false`, slash successes, gate refusals, defers, and errors are normal
public messages. Commands that explicitly publish output, such as `/queue` and
`/nowplaying`, remain public either way. Prefix replies are always normal
messages. `deleteafter` still controls auto-deletion when a reply is public.

## Commands

BootstrapDJ exposes **71 top-level slash commands**. Many commands also work with
the prefix, and some advanced commands are prefix-only. Run `/utility commands`
or `!utility commands` to see the live command status, prefix, and disabled
commands for the current guild.

| Category      | Examples                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playback      | `/play`, `/playnext`, `/playrecent`, `/playselect`, `/nowplaying`, `/queue`, `/pause`, `/resume`, `/skip`, `/skipto`, `/previous`, `/replay`, `/seek`, `/backward`, `/forward`, `/stop`, `/join`, `/leave`, `/volume`, `/loop`, `/shuffle`, `/shufflerepeat`, `/voteskip`, `/sessionstats`, `/playleave`, `/radio`, `/fairplay` |
| Queue editing | `/clearqueue`, `/remove`, `/removelast`, `/removeduplicates`, `/removekeyword`, `/removeuser`, `/massremove`, `/massmove`, `/move`, `/swap`, `/sort`, `/reverse`, `/selectrandom`, `/recentlyplayed`, `/requested`, `/removeabsent`                                                                                             |
| Discovery     | `/artist`, `/album`, `/song`, `/top`, `/playlistsearch`, `/lyrics`, `/grab`, `/guess`                                                                                                                                                                                                                                           |
| Filters       | `/filter` and `/filters`, including `8d`, `bassboost`, `nightcore`, `pitch`, `rate`, `speed`, `rotation`, `tremolo`, `vibrato`, and `reset`                                                                                                                                                                                     |
| Collections   | `/collection` with list, create, delete, view, add, remove, load, save, rename, copy, merge, clear, share, import, unshare, and shares actions                                                                                                                                                                                  |
| Settings      | `/settings`, `/setup`, `/247`, `/prefix`, `/alias`, `/mappings`, `/permissions`, `/dj`, `/listen`; `selfprefix` is prefix-only                                                                                                                                                                                                  |
| Information   | `/help`, `/info`, `/invite`, `/ping`, `/stats`, `/leaderboard`, `/profile`, `/lavalink`, `/utility`                                                                                                                                                                                                                             |
| Utility pages | `/utility overview`, `stats`, `shards`, `categories`, `faq`, `tip`, `premium`, `support`, `leaderboard`, `commands`, `dashboard`                                                                                                                                                                                                |

`/utility premium` is an informational page: no feature in this project is gated
behind a paid tier.

## Dashboard

Start the dashboard by setting a port:

```dotenv
DASHBOARD_PORT="8795"
DASHBOARD_HOST="127.0.0.1"
DASHBOARD_PUBLIC_URL="https://dj.example.com/"
```

Open `http://127.0.0.1:8795/` locally, or put it behind an HTTPS reverse proxy.
The recommended login method is Discord OAuth:

```dotenv
DASHBOARD_OAUTH_CLIENT_ID="your-application-id"
DASHBOARD_OAUTH_CLIENT_SECRET="your-oauth-secret"
DASHBOARD_OAUTH_REDIRECT_URI="https://dj.example.com/auth/callback"
DASHBOARD_SESSION_SECRET="a-long-random-secret"
DASHBOARD_OAUTH_GUILD_ID="your-server-id"
```

Only the owner or members with **Manage Server** in that guild can sign in. The
session is an HMAC-signed, HTTP-only cookie scoped to that guild and expires
after 24 hours. Clear-statistics is restricted to the server owner. Add the
exact redirect URI to the Discord Developer Portal before starting the bot.

See [docs/DASHBOARD_OAUTH.md](docs/DASHBOARD_OAUTH.md) for the full OAuth setup,
reverse-proxy notes, and local token-mode fallback.

## Session restore and multi-bot operation

BootstrapDJ saves queues so they can be restored after a restart when
`SESSION_RESTORE_AGE` is greater than zero. Only the priority-0 bot restores
sessions and runs retention jobs.

For local multi-bot operation, provide a mode-600 JSON file through `BOTS_FILE`
with one entry per bot. The first active bot in the configured order handles
voice commands; a durable `SessionLease` transfers ownership if the current
owner stops heartbeating. This is optional — a single bot needs only the normal
environment variables.

## Storage and retention

The default SQLite database is `prisma/bootstrapdj.db`. BootstrapDJ enables WAL
mode at startup and applies the retention windows in `.env.example`:

- daily statistics are kept for `STATS_RETENTION_DAYS`
- inactive track and listener rows are removed after `STATS_INACTIVE_DAYS`,
  except each guild's top 100 rows
- expired session leases are pruned

If you back up a live WAL database, include the `-wal` and `-shm` files or run
`PRAGMA wal_checkpoint(TRUNCATE);` first. See [docs/STORAGE.md](docs/STORAGE.md)
for details.

## Development

```bash
npm run build       # compile TypeScript
npm test            # build, then run the Node test suite
npm run lint        # ESLint
npm run format      # Prettier check
```

The test suite covers the command gate, playback request handling, prefix
routing, session restore, voice teardown, retention/WAL boundaries, and dashboard
command surfaces. Current test count is **136**.

## Project layout

```text
src/
  commands/       slash and prefix commands grouped by area
  dashboard/      local web dashboard and OAuth server
  database/       Prisma data access and retention
  events/         Discord and player event handlers
  structures/     client, dispatcher, queue, and command framework
  utils/          gate, search, session, setup, and response helpers
prisma/           schema and default SQLite database
docs/             dashboard, storage, and parity documentation
tests/            Node test suite
```

## Security notes

- Keep `.env` out of Git and rotate any token that has been exposed.
- Keep the dashboard on loopback unless it is behind an HTTPS reverse proxy with
  OAuth enabled. A partial OAuth configuration fails closed.
- The dashboard does not accept a token in the URL query string. Local token mode
  uses an `X-Dashboard-Token` header only.
- The optional voice listener discards audio from opted-out members before
  decoding or transcription.

## License and credits

BootstrapDJ is distributed under the [GPL-3.0 License](LICENSE).

BootstrapDJ is a [BootstrapBoys](https://github.com/zebz213) project. It is based
on the LavaMusic project and uses [Discord.js](https://discord.js.org/),
[Shoukaku](https://github.com/shipgirlproject/Shoukaku), and
[Lavalink](https://github.com/lavalink-devs/Lavalink).

Thanks to the upstream contributors and to everyone who has tested BootstrapDJ.
