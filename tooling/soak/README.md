# Soak runner

Runs a bounded soak against a running BotTest instance and writes a summary.
It only talks to loopback services and refuses `PRODUCTION=true`.

## Quick smoke

```bash
cd /root/BotTest
SOAK_GUILD_ID=<test-guild-id> \
SOAK_HOURS=0.083 \
SOAK_SAMPLE_SECONDS=15 \
SOAK_WORKLOAD=0 \
node tooling/soak/run.mjs
```

Use `SOAK_WORKLOAD=0` when no test member is in the voice channel. This still
captures process, memory, event-loop and player metrics, but does not exercise
queue transitions.

## Full workload

```bash
SOAK_GUILD_ID=<test-guild-id> \
SOAK_VOICE_CHANNEL_ID=<test-voice-id> \
SOAK_TEXT_CHANNEL_ID=<test-text-id> \
SOAK_USER_ID=<test-user-id> \
SOAK_BRIDGE_SECRET='<from BotTest .env>' \
SOAK_HOURS=24 \
node tooling/soak/run.mjs
```

The test user must be in the voice channel and have DJ access. `run.mjs` loads
`.env` from the current directory, so run it from `/root/BotTest`.

## Artifacts

Each run creates `artifacts/soak/<timestamp>/`:

- `meta.json` — commit, branch, Node version, host, duration
- `metrics.jsonl` — one sample per interval; flushed continuously
- `workload.jsonl` — bridge command results when enabled
- `summary.json` / `summary.md` — threshold result
- `samples.json` — full sample array for analysis

Rewrite a report from an interrupted run:

```bash
node tooling/soak/report.mjs artifacts/soak/<timestamp>
```

## 24-hour schedule

Use three phases in one run or separate profiles:

- 24/7 on + autoplay for continuous playback
- 24/7 off + queue end/leave for lifecycle cleanup
- restart and failover probes under load

The queue cap, fixed seed, and dedicated test guild are safety requirements. A
failed threshold exits non-zero; retain the artifact directory for triage.

## Safety

- Never point `SOAK_METRICS_URL` at production.
- `PRODUCTION=true` is rejected.
- Do not put tokens, ARLs or `.env` contents in artifacts.
- Stop BotTest and remove the soak lock after a run.
