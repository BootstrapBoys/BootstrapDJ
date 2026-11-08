# Isolated failover drill

This script intentionally refuses normal operation. It is only for dedicated
test Lavalink processes, never the shared `Lavalink`/`Lavalink-Backup` pair used
by production and BotTest.

```bash
CHAOS_ALLOW=1 \
ISOLATED_TEST_NODES=1 \
PM2_PRIMARY=Lavalink-Test \
PM2_BACKUP=Lavalink-Test-Backup \
bash tooling/chaos/failover.sh
```

It aborts when:

- `CHAOS_ALLOW` is not `1`
- `ISOLATED_TEST_NODES` is not `1`
- `PRODUCTION=true`
- a `tooling/soak/run.mjs` process is active
- the named PM2 processes or BotTest are missing

It stops the isolated primary, waits for a queue rebuild, starts the primary,
waits for switch-back/move, and checks the metrics endpoint.

Do not run this while the 24-hour soak is active. Stopping the shared primary
would affect both BotTest and `DJBoot`.
