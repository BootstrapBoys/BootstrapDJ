# BootstrapDJ

BootstrapDJ is a self-hosted Discord music bot built with TypeScript, Discord.js,
Shoukaku, Lavalink v4, and Prisma. It supports slash commands and text prefix
commands, and every feature is available without a premium tier.

> BootstrapDJ is a fork of [appujet/lavamusic](https://github.com/appujet/lavamusic),
> substantially rewritten and maintained by BootstrapBoys.

<p align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1029680163790794772&permissions=4298238976&scope=bot%20applications.commands">Invite BootstrapDJ</a>
  ·
  <a href="https://github.com/BootstrapBoys/BootstrapDJ/issues">Report a bug</a>
</p>

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Node.js >= 24.17](https://img.shields.io/badge/node-%3E%3D24.17-43853D.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6.svg)](https://www.typescriptlang.org/)

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
- **Playlists** — create, load, share, import, merge, rename, copy, and clear
  playlists through `/playlist`; the legacy `/collection` command remains a
  prefix alias. The dashboard can also create, rename, delete, edit, and queue
  your playlists.
- **Song-request channel** — ordinary messages become song requests; known
  prefix commands still work there.
- **Saved sessions** — queues survive a restart when session restore is enabled.
- **Multi-bot handoff** — optional local multi-process setup with atomic session
  leases and automatic takeover.
- **Dashboard** — Discord OAuth login, player controls, live queue, filters,
  every guild setting, listening statistics, and a per-member personal stats view.
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
    git clone https://github.com/BootstrapBoys/BootstrapDJ.git
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

| Group     | Variables                                                                                                                                                              | Notes                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord   | `BOT_TOKEN`, `TOKEN`, `CLIENT_ID`, `GUILD_ID`, `PRODUCTION`                                                                                                            | `BOT_TOKEN` wins over the legacy `TOKEN` alias. `GUILD_ID` enables single-guild mode.                                                                       |
| Commands  | `PREFIX`, `OWNER_IDS`                                                                                                                                                  | `PREFIX` accepts comma-separated prefixes. `OWNER_IDS` is a JSON array.                                                                                     |
| Presence  | `BOT_STATUS`, `BOT_ACTIVITY`, `BOT_ACTIVITY_TYPE`, `BOT_STATUS_MODE`                                                                                                   | `BOT_STATUS_MODE` is `static`, `track`, or `count`.                                                                                                         |
| Search    | `SEARCH_ENGINE`, `PREFIX_SEARCH_ENGINE`                                                                                                                                | Slash commands use the guild `searchtype` or `SEARCH_ENGINE`; prefix commands use `PREFIX_SEARCH_ENGINE`.                                                   |
| Limits    | `MAX_QUEUE_SIZE`, `MAX_PLAYLIST_SIZE`                                                                                                                                  | Per-guild limits can also be set with `/settings`.                                                                                                          |
| Autoplay  | `AUTOPLAY_CHART`, `AUTOPLAY_SEEDS`, `AUTOPLAY_SEED`                                                                                                                    | Chart, curated seeds, then a final fallback seed.                                                                                                           |
| Lavalink  | `LAVALINK_URL`, `LAVALINK_AUTH`, `LAVALINK_SECURE`, `LAVALINK_NAME`, `LAVALINK_FALLBACKS`, `AUTO_NODE`, `NODE_FALLBACK`                                                | `LAVALINK_FALLBACKS` is a JSON array of standby nodes; a second local Lavalink is the reliable failover.                                                    |
| Sessions  | `SESSION_RESTORE_AGE`, `SESSION_EMPTY_WAIT`                                                                                                                            | Restore a saved queue for up to six hours by default.                                                                                                       |
| Messages  | `COMMAND_DELETE_AFTER`, `SETUP_CLEANUP_INTERVAL`                                                                                                                       | Set either to `0` to disable that timer.                                                                                                                    |
| Storage   | `DATABASE_URL`, `STATS_RETENTION_DAYS`, `STATS_INACTIVE_DAYS`, `STATS_PRUNE_INTERVAL_HOURS`                                                                            | SQLite defaults to `prisma/bootstrapdj.db`; WAL mode is enabled at startup.                                                                                 |
| Dashboard | `DASHBOARD_PORT`, `DASHBOARD_HOST`, `DASHBOARD_PUBLIC_URL`, `DASHBOARD_OAUTH_*`, `DASHBOARD_SESSION_SECRET`, `DASHBOARD_ALLOW_ANONYMOUS`, `DASHBOARD_VOICE_CHANNEL_ID` | `DASHBOARD_PORT=0` disables the dashboard; anonymous mode is loopback-only. Dashboard audio uses the active Lavalink node’s `LAVALINK_URL`/`LAVALINK_AUTH`. |
| Voice     | `EARL_CONTROL_URL`, `EARL_BRIDGE_SECRET`, `VOICE_BRIDGE_PORT`, `EARL_LIVE_BADGE_URL`                                                                                   | Optional Earl the Ear listener bridge; keep the control API on localhost.                                                                                   |
| Logging   | `LOG_CHANNEL_ID`                                                                                                                                                       | Channel for bot logs; blank disables logging.                                                                                                               |
| Multi-bot | `BOTS_FILE`, `BOT_NAME`, `BOT_ID`, `BOT_PRIORITY`                                                                                                                      | Optional local child-process setup; see below.                                                                                                              |
| Sharding  | `SHARD_COUNT`                                                                                                                                                          | Optional Discord shard count; `0` uses Discord's automatic count. Only shard 0 owns shared services.                                                        |

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

BootstrapDJ exposes **72 top-level slash commands**. Many commands also work with
the prefix, and some helper commands are prefix-only. Run `/utility commands`
or `!utility commands` to see the live command status, prefix, and disabled
commands for the current guild.

| Category      | Slash commands                                                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playback      | `/play`, `/playnext`, `/queue`, `/nowplaying`, `/pause`, `/resume`, `/skip`, `/previous`, `/seek`, `/stop`, `/volume`, `/loop`, `/shuffle`, `/join`, `/leave`, `/autoplay`                                                          |
| Queue editing | `/clearqueue`, `/remove`, `/move`, `/massmove`, `/massremove`, `/removeduplicates`, `/removekeyword`, `/removeuser`, `/removeabsent`, `/removelast`, `/reverse`, `/sort`, `/swap`, `/selectrandom`, `/recentlyplayed`, `/requested` |
| Discovery     | `/artist`, `/album`, `/song`, `/top`, `/playlistsearch`, `/lyrics`, `/grab`, `/guess`                                                                                                                                               |
| Filters       | `/filter` and `/filters`; individual filter names are prefix-only                                                                                                                                                                   |
| Playlists     | `/playlist` with list, create, delete, view, add, remove, removesong, load, save, rename, copy, clone, merge, clear, share, import, unshare, and shares actions                                                                     |
| Settings      | `/settings`, `/setup`, `/247`, `/prefix`, `/alias`, `/mappings`, `/permissions`, `/dj`, `/listen`; `selfprefix` is prefix-only                                                                                                      |
| Information   | `/help`, `/invite`, `/ping`, `/profile`, `/lavalink`, `/utility`; `/utility` includes overview, stats, shards, categories, faq, tip, premium, support, leaderboard, commands, and dashboard                                         |
| Owner         | `/guild` (owner/dev only); other owner commands are prefix-only                                                                                                                                                                     |

Prefix-only helpers include `!info`, `!stats`, `!leaderboard`, `!categories`,
`!faq`, `!tip`, `!support`, `!shards`, the legacy playlist-management
commands, and the individual filter toggles. `/utility premium` is an
informational page: no feature in this project is gated behind a paid tier.

## Dashboard

Start the dashboard by setting a port:

```dotenv
DASHBOARD_PORT="8795"
DASHBOARD_HOST="127.0.0.1"
DASHBOARD_PUBLIC_URL="https://dj.example.com/"
```

Open `http://127.0.0.1:8795/` locally, or put it behind an HTTPS reverse proxy.

### Dashboard sidecar

For dashboard development without restarting the bot, run the dashboard as a
separate process:

```dotenv
DASHBOARD_MODE="sidecar"
DASHBOARD_PORT="8795"
DASHBOARD_CONTROL_PORT="8796"
DASHBOARD_CONTROL_SECRET="<openssl rand -hex 32>"
```

The bot then exposes only an authenticated loopback control API on
`DASHBOARD_CONTROL_PORT`; it does not start the dashboard HTTP server. Start the
dashboard sidecar with `npm run dashboard` (or under pm2 as `dashboard`), and
restart only that process after a dashboard change:

```bash
npm run build
pm2 restart dashboard
```

`npx prisma generate && npm run build` also works. The control secret is shared
by the two processes and must stay out of Git; `DASHBOARD_CONTROL_PORT` must
remain loopback-only. The embedded default remains `DASHBOARD_MODE="embedded"`,
where the bot serves the dashboard itself.

A loopback bind alone is not authentication. With no `DASHBOARD_TOKEN` and no
OAuth, the dashboard refuses to start; for a local-only, unauthenticated
dashboard set `DASHBOARD_ALLOW_ANONYMOUS="true"`. That opt-in is refused when
`DASHBOARD_PUBLIC_URL` is set or the bind is not loopback, because a proxied
port makes every caller look local.

The recommended login method is Discord OAuth:

```dotenv
DASHBOARD_OAUTH_CLIENT_ID="your-application-id"
DASHBOARD_OAUTH_CLIENT_SECRET="your-oauth-secret"
DASHBOARD_OAUTH_REDIRECT_URI="https://dj.example.com/auth/callback"
DASHBOARD_SESSION_SECRET="a-long-random-secret"
```

Every guild the bot is in is discovered automatically. Any member of that guild
can sign in; access disappears when the bot leaves the guild. The session is an
HMAC-signed, HTTP-only cookie and expires after 24 hours. Dashboard controls are
read-only for ordinary members; configured DJ roles unlock playback controls,
while **Manage Server** / **Administrator** unlock settings and filters.
Clear-statistics is restricted to each guild’s owner. The playlist button lets
the signed-in member create, rename, delete, edit, add tracks to, and load their
own playlists into the active queue. The main player panel also has an **Add
song** field that searches Lavalink or accepts a URL. Song titles in both
statistics views link to the stored source, or to a YouTube search when no URI
was recorded. Add the exact redirect URI to the Discord Developer Portal before
starting the bot.

### Browser-only playback

Set `DASHBOARD_VOICE_CHANNEL_ID` to a voice channel id in the server where the
dashboard will start playback:

```dotenv
DASHBOARD_VOICE_CHANNEL_ID="123456789012345678"
```

When a dashboard request starts playback and the bot has no player, it joins this
channel even if no Discord member is connected. While tracks are playing, the
channel is treated as a browser listening channel, so the normal empty-channel
timeout does not disconnect it. Once the queue is empty, the bot leaves
immediately without the normal confirmation or idle delay. Leave the value blank
to keep requiring an existing voice connection.

By default, a Discord user takes priority over an active browser session. If a
caller runs `/play` or `/playnext` from another voice channel, the bot clears the
browser queue and moves to that caller’s channel before adding their request.
Disable that per guild with `/settings dashboardvoicepriority false` (or the
**Discord takes priority** toggle in the dashboard settings). Invalid searches do
not clear the browser queue.

Dashboard **Listen** access is controlled per guild by two ordinary settings:

- `audiotapallowall` — default `true`; every guild member may listen.
- `audiotaproles` — comma/space-separated role IDs used when allow-all is false.

Guild owners and administrators always bypass the allowlist. With allow-all off
and an empty role list, only owners and administrators can listen. Token-mode
dashboards retain full access.

The audio relay uses the active Lavalink node’s `/v4/audiotap/<guildId>` route
with the configured `LAVALINK_AUTH` password. There is no separate tap token or
client header, and the password never reaches the browser.

### Filter response latency

Lavalink buffers audio before Discord output. A high `frameBufferDurationMs`
keeps playback resilient to GC pauses, but filter changes cannot be heard until
the already-buffered audio drains. The example configuration uses **1000 ms**;
the former 5000 ms setting produced roughly six seconds of filter delay. Adjust
this in the Lavalink `application.yml` and restart Lavalink, not the bot.

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

### Sharding

Set `SHARD_COUNT` to a positive number to force Discord sharding, or `0` to use
Discord's calculated count. Shard 0 owns the dashboard, Earl bridge, global
command registration and retention jobs; other shards only own their gateway
connections and local guilds. Dashboard and voice requests are routed to the
shard that owns the guild. `BOTS_FILE` is a separate one-process-per-token mode
and is not combined with `SHARD_COUNT`.

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
npm run test:coverage  # build, run tests with coverage
npm run lint        # Oxlint type-aware/type-check
npm run format      # Prettier check
npm run soak        # optional soak harness; requires tooling/Lavalink setup
```

The test suite covers the command gate, playback engine, queue/session restore,
voice teardown, retention/WAL boundaries, dashboard surfaces, and the rewritten
core. Current test count is **366**. A clean `npm ci` runs `prisma generate`
through `postinstall`; the generated client is not committed.

## Project layout

```text
src/
  commands/       slash and prefix commands grouped by area
  core/           client, dispatcher, queue, playback engine and session lifecycle
  data/           Prisma data access and retention
  dashboard/      local web dashboard and OAuth server
  events/         Discord and player event handlers
  lib/            command gate, search, request handling, reply helpers and settings
  plugin/         optional local plugins
prisma/           schema and default SQLite database
scripts/          host boot/start scripts
tooling/          soak, chaos and rewrite-audit tools
docs/             dashboard, storage, architecture and parity documentation
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

BootstrapDJ is a [BootstrapBoys](https://github.com/zebz213) project. It is forked
from the [LavaMusic project](https://github.com/appujet/lavamusic) and uses
[Discord.js](https://discord.js.org/),
[Shoukaku](https://github.com/shipgirlproject/Shoukaku), and
[Lavalink](https://github.com/lavalink-devs/Lavalink).

Thanks to the upstream contributors and to everyone who has tested BootstrapDJ.
