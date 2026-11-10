# Dashboard audio tap — implementation plan

Goal: the dashboard plays the **exact** Opus frames Discord hears, and its mute
button affects only that browser. The tap lives in the custom Lavalink fork
(`BootstrapBoys/BootstrapDJ-Lavalink`, branch `feature/dashboard-audio-tap`) and
is already proven on staging. This plan covers the dashboard half and the
production rollout.

## Architecture

```
Lavalink fork (Discord frames)
  -> 127.0.0.1:2444/tap/{guildId}   loopback, token auth, chunked binary
  -> dashboard sidecar /api/audio    Discord session + guild membership gate
  -> browser fetch stream            no tap token reaches the page
  -> WebCodecs AudioDecoder          opus 48 kHz stereo
  -> GainNode -> AudioContext        local mute only
```

The tap token stays in the dashboard process environment. The browser only ever
sees the dashboard's own authenticated endpoint.

## Step 0 — baseline and workflow

- Branch from `main`; record `tsc`, lint, test and build as green before edits.
- Commit this plan plus `tooling/audio-tap-smoke.sh`.
- Gate: plan and script committed; baseline recorded.

## Step 1 — sidecar proxy

Files:

- `src/config.ts` / `.env.example`: `DASHBOARD_TAP_URL`, `DASHBOARD_TAP_TOKEN`.
- `src/dashboard/audioTap.ts`: resolve and validate the loopback target; relay
  one guild stream; propagate status; destroy upstream on client disconnect.
- `src/dashboard/server.ts`: `GET /api/audio?guildId=` gated by guild membership
  (read-only members may listen), `503` when unconfigured; `/api/state` reports
  `audio.available`.
- `tests/audio-tap.test.mjs`: real HTTP upstream; auth header; 200 relay; status
  passthrough; missing config; non-loopback target refusal.

Gate: `tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`; the test
proves bytes and status codes, and no token appears in the HTML.

## Step 2 — browser client

Files:

- `src/dashboard/page.ts`: Listen control outside `#player-controls` so read-only
  members can listen; styles; speaker/mute icon.
- `src/dashboard/browser.ts`: stream parser, `AudioDecoder`, jitter buffer,
  `GainNode` mute, `trackStart` decoder reset, reconnect, guild-change cleanup,
  `window.__bdjAudio` debug summary for tests. Mute must never call
  `/api/player` and never change Lavalink volume.

Gate: `tsc --noEmit`, `npm run build`, `node --check` on the extracted inline
script, and the served HTML contains `listen-btn`, `AudioDecoder` and
`__bdjAudio`.

## Step 3 — headless browser harness

Files:

- `tests/fixtures/tap-sample.bin`: real frames captured from the staging tap.
- `tooling/audio-tap-harness.mjs`: serves the real dashboard page with a fake
  host and replays the fixture at 20 ms cadence through `/api/audio`.
- Headless Chrome opens the page, clicks Listen, and reads
  `window.__bdjAudio.debug()`.

Acceptance: frames received > 0, decoded frames > 0, analyser RMS > 0, mute
sets gain to 0, unmute restores it, and the stream reconnects after a forced
end. This proves WebCodecs decoding and local mute without Discord.

## Step 4 — staging live gate

- Start `/root/lavalink-tap-staging` (REST 2443, tap 2444).
- Back up BotTest `.env`; point only BotTest at the staging node; restart it.
- Configure the BotTest dashboard sidecar with the staging tap URL/token; restart
  only that process.
- Play a real track in the test guild and verify:
  - `/api/audio` returns 200 and `tooling/tap_probe.py` counts frames.
  - A browser through an SSH tunnel hears audio and mute is local.
  - `/api/player` volume is unchanged by mute.
- Restore BotTest `.env`, restart/stop it, stop the staging node.

Gate: evidence numbers recorded; BotTest and production untouched afterwards.

## Step 5 — production cutover

Only after Step 4 passes.

- Back up `/root/Lavalink/Lavalink.jar` and `application.yml` with a dated name.
- Install the fork jar; add `lavalink.audio-tap` with a fresh token (mode 600).
- Restart production `Lavalink`; verify `DJBoot` reconnects and plays.
- Add `DASHBOARD_TAP_URL=http://127.0.0.1:2444` and `DASHBOARD_TAP_TOKEN` to the
  dashboard environment; restart **dashboard** only.
- Verify `/api/audio` and a browser session; confirm Discord playback volume is
  unchanged.

Rollback: restore the backed-up jar/config, `pm2 restart Lavalink`; remove the
two dashboard variables and `pm2 restart dashboard`. The bot repo can revert to
the previous commit and rebuild.

## Execution results (2026-11-10)

| Gate | Evidence |
| --- | --- |
| Sidecar proxy | 372/372 tests; 6 audio-tap cases cover target validation, 200 relay, 404 passthrough, 502 on unreachable, state flag, 503 unconfigured |
| Browser client | tsc, lint, build green; extracted inline script passes `node --check`; page contains `listen-btn`, `AudioDecoder`, `__bdjAudio` |
| Headless Chrome | Chrome 145: 77 → 117 packets, decoded equals received, RMS 0.06, mute gain 0 / RMS 0, unmute RMS 0.07, server volume 100 unchanged |
| Live staging | BotTest on staging node: 81 → 122 decoded, RMS 0.06 / 0.10, mute 0, server volume 25 unchanged; direct tap 201 frames at 50.1 fps, 0 drops |
| Production | Fork jar installed, tap on `127.0.0.1:2444`, DJBoot recovered in 20 s; dashboard sidecar on the feature build, OAuth 401 expected; backups `*.pre-audio-tap-2026-11-10` |

Production `/root/Bot` is on `feature/dashboard-audio-tap` (`87600f3`); `main` is unchanged and
should be merged only after the user exercises the feature.

## Security invariants

- The tap listener is loopback-only and refuses non-loopback binds.
- The tap token is never sent to the browser, logged, committed, or put in a URL.
- `/api/audio` requires a dashboard session and guild membership on every
  request; it is not a public proxy.
- Mute is a client `GainNode` only. No `/api/player` call on mute.
- A failed tap must never break Discord playback; the Lavalink side swallows and
  rate-limits tap errors.
