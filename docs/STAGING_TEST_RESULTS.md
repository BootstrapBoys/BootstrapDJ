# Staging Test Results

Commit: f5103b9 (plus docs)
Date:
Tester:

| Stage | Result | Evidence |
|---|---|---|
| 1 — Static gates | PASS | build/lint/tsc, 209/209 tests at `1d5bcff` |
| 2 — Boot and registration | PASS | `f5103b9`; ready, node, dashboard, production healthy |
| 3 — Playback core | PASS | play/queue/skip/previous/pause/resume/loop/seek/volume/stop; dashboard state confirmed |
| 4 — Management/playlist/autoplay | PASS (spot) | commands executed without errors; `/ping` and `/help` replies captured; playlist diagnostic logged; earlier create/add/load/autoplay passed |
| 5 — Session and restart | PASS | FEAR restored at 100s with 1 queued, volume 25, autoplay on, loop repeat |
| 6 — Dashboard and API | PASS | `/`, `/api/guilds`, `/api/state`, `/api/player-state` all HTTP 200; anonymous loopback opt-in verified |
| 7 — Plugins and bridge | PASS | bridge 401 without auth, 200 with auth; plugin shutdown/watchdog regression tests pass |
| 8 — Isolated failover | PASS | BotTest isolated to test Lavalink 2335/2336; A stopped → B resumed at 4s; A restarted → switched back at 58s; test nodes/env removed; production untouched |
| 9 — Negative/edge cases | PASS (smoke) | seek overflow, missing playlist, large skip; bot stayed online, no fatal errors |
| 10 — Cleanup | PASS | BotTest stopped; test nodes removed; production processes online |

Overall: PASS on f5103b9. Tests 351/351. Merge/deploy still requires approval.

Production verification: `DJBoot`, `Lavalink`, `Lavalink-Backup` online; untouched.
