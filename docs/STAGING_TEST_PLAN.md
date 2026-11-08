# Staging Test Plan and Workflow

Purpose: prove the rewritten bot matches production behavior before merge.

Code under test: `experimental/rewrite` (currently `dce9582`)
Reference production: `DJBoot` on its existing build
Environment: BotTest (`BootstrapDJ-DEV#7138`), Edge/CDP on the rig,
isolated Lavalink instances for failover

## Rules

- Production `DJBoot` and its Lavalink nodes are never stopped or reconfigured.
- BotTest uses its own SQLite DB and bridge port.
- Failover tests use throwaway Lavalink instances on dedicated ports.
- Never test with real user credentials in chat.
- Every result records: test ID, commit, timestamp, evidence, pass/fail.
- A failed gate blocks the next stage.
- BotTest is stopped and its env restored at the end.

## Evidence

Keep or link:

- CI run URL and commit
- `/tmp` build/lint/test logs
- BotTest `pm2` status and log excerpts
- Discord screenshots or message IDs
- Dashboard HTTP status/JSON
- SQLite queries for volume/session rows
- Lavalink logs and migration log lines

## Stage 0 — Preparation

- Confirm branch/commit under test.
- Confirm BotTest `.env` points at the normal nodes, not test nodes.
- Back up BotTest DB and `.env` before the run.
- Confirm the test account is in the test guild’s voice channel.
- Confirm dashboard is loopback-only or token mode.
- Confirm production `DJBoot` and both Lavalink nodes are online.

Gate: environment healthy; production untouched.

## Stage 1 — Static gates

Run in the repo:

```bash
npm run build
npm run lint
npx tsc --noEmit -p tsconfig.json
npm test
git diff --check
node tooling/rewrite-audit.mjs <upstream-src>
```

Expected: build/lint/tsc clean; tests 209/209; no diff errors; audit numbers
recorded. Gate: all pass.

## Stage 2 — Boot and registration

- Pull the commit into `/root/BotTest`; build; start `BotTest`.
- Verify ready as `BootstrapDJ-DEV#7138`.
- Verify both configured nodes connect.
- Verify voice bridge port and dashboard port.
- Verify slash command count/options through the Discord API.
- Verify no startup exceptions.

Gate: ready, nodes connected, commands registered, no errors.

## Stage 3 — Playback core

| ID | Action | Expected |
|---|---|---|
| P1 | `!play nf fear` | joins voice, queue entry, Now Playing, audio |
| P2 | `!queue` | current track and queue count |
| P3 | `!play nf the search`; `!skip` | advances to The Search |
| P4 | `!previous` | returns to FEAR |
| P5 | `!pause` / `!resume` | state and reply |
| P6 | `!loop` | cycle off/repeat/queue |
| P7 | `!seek 30` | position changes, playback continues |
| P8 | `!volume 25` | reports 25 |
| P9 | `!stop` | clears queue/session |
| P10 | `!play` after stop | starts at persisted volume 25 |

Gate: all pass; no unhandled rejection; queue/session state consistent.

## Stage 4 — Management, playlist, autoplay

- `/playlist create`, add, autocomplete, load, delete
- `/setup` create/info/delete (or test-guild equivalent)
- `/dj`, `/247`, `/listen`, `/prefix`, `/permissions`, `/mappings`, `/alias`
- `/help`, `/ping`, `/invite`, `/stats`, `/lavalink`
- `/autoplay seed:nf`; verify seed persists and no env fallback on failure

Gate: each command acknowledges correctly; permission/DJ/ephemeral behavior
matches production; no command registration or option errors.

## Stage 5 — Session and restart

- Play a track with at least 2 queued.
- Restart BotTest.
- Verify current track, position, queue, volume, loop, autoplay restore.
- Verify exactly one now-playing panel remains; setup panel preserved.
- Let queue end; verify leave prompt clears and bot leaves cleanly.
- Repeat with paused state and 24/7 mode.

Gate: restore/cleanup correct; no stale panels or zombie players.

## Stage 6 — Dashboard and API

- `/` loads (login page in OAuth mode, dashboard in token/loopback mode).
- `/api/guilds`, `/api/state`, `/api/player-state` return expected data.
- Settings save/read; filter toggle; stats read/clear (test guild only).
- Player actions: pause/resume/skip/seek/volume/jump.
- OAuth state/callback and logout paths if OAuth mode enabled.
- Token mode rejects missing/incorrect token; loopback mode is local-only.

Gate: all endpoints authorized correctly; no state corruption.

## Stage 7 — Plugins and bridge

- Earl bridge `/voice/optouts` and `/voice/command` auth; unauthorized returns 401.
- `/voice/listener-stopped` clears live state and refreshes setup.
- Node watchdog: 30s cadence, no duplicate migrations.
- Anti-crash: SIGTERM persists and exits cleanly; rejection logs and stays up.
- Advice/status plugins load without errors.

Gate: bridge auth/opt-out correct; watchdog idempotent; no crash loop.

## Stage 8 — Isolated failover

- Start two throwaway Lavalink nodes on `2335`/`2336`.
- Point only BotTest at them; never production.
- Play a track on Node A.
- Stop Node A: expect hold, rebuild on Node B, resume near saved position.
- Restart Node A: expect recovery, rebuild back, resume near saved position.
- Confirm queue, volume, loop, autoplay survive both moves.
- Remove test nodes and restore BotTest env.

Gate: both directions pass; no production impact.

## Stage 9 — Negative and edge cases

- Empty queue play, skip beyond queue, seek beyond duration.
- Invalid playlist name, duplicate add, remove out of range.
- Unauthorized dashboard request, bad CSRF, bad content type.
- Voice channel with no humans, 24/7 pause/resume.
- Track failure: unplayable track drops after bounded retries.
- Bot restart during paused playback.

Gate: errors are user-safe, no crash, no stuck queue.

## Stage 10 — Cleanup and report

- Stop BotTest.
- Restore normal BotTest env; remove test Lavalink nodes.
- Verify production `DJBoot` and both nodes online.
- Record results in `docs/STAGING_TEST_RESULTS.md`.
- Merge only if every gate is PASS; otherwise file blocking issues and stop.

## Failure handling

- Stop at the first failed gate.
- Capture logs before restarting.
- Fix on the branch, add a regression test, rerun from the failed stage.
- Do not “retry until green” without identifying the cause.

## Result template

```text
Commit:
Date:
Tester:

Stage 1: PASS/FAIL — evidence:
Stage 2: PASS/FAIL — evidence:
Stage 3: PASS/FAIL — evidence:
Stage 4: PASS/FAIL — evidence:
Stage 5: PASS/FAIL — evidence:
Stage 6: PASS/FAIL — evidence:
Stage 7: PASS/FAIL — evidence:
Stage 8: PASS/FAIL — evidence:
Stage 9: PASS/FAIL — evidence:

Overall: PASS/BLOCKED
Production verification:
```
