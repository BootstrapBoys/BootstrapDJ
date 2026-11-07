# Storage and statistics retention

BootstrapDJ stores its state in one SQLite database (`DATABASE_URL`, default
`file:./prisma/bootstrapdj.db`). All bot processes and the dashboard share it.

## WAL mode

On startup every bot process runs:

```sql
PRAGMA busy_timeout = 10000;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

WAL lets the dashboard read while a bot writes without blocking it. The journal
mode is stored in the database file; `busy_timeout` and `synchronous` apply to
each connection. WAL creates `-wal` and `-shm` files next to the database. When
copying or backing up the database, either stop the bots first or include those
files; otherwise run `PRAGMA wal_checkpoint(TRUNCATE);` before copying the main
file.

## Statistics retention

The priority-0 process runs a retention job once at boot and then every
`STATS_PRUNE_INTERVAL_HOURS` (default 24 hours). Jobs are idempotent, so a crash
during a run is safe.

| Data | Default | Rule |
| --- | --- | --- |
| `StatsDaily` | 90 days | Rows older than the cutoff date are deleted. This matches the dashboard's maximum 7/30/90-day range. |
| `StatsTrack` | 180 days inactive | Rows whose `lastPlayed` is older are deleted, except each guild's top 100 tracks by total listening seconds. |
| `StatsListener` | 180 days inactive | Rows whose `lastSeen` is older are deleted, except each guild's top 100 listeners by total listening seconds. |
| `StatsUserTrack` | 180 days inactive | Per-user requested-track rows older than the cutoff are deleted, except the top 100 rows per guild by play count. |
| `SessionLease` | 60 seconds | Expired leases are deleted. |
| `RecentTrack` | 100 tracks/guild | Trimmed on every write. |
| `StatsHour`, `StatsWeekday` | lifetime | Bounded to 24 and 7 rows per guild. |
| `StatsCommand` | lifetime | Bounded by the registered command set. |

Set `STATS_RETENTION_DAYS=0` or `STATS_INACTIVE_DAYS=0` to disable one half of
the job. Set `STATS_PRUNE_INTERVAL_HOURS=0` to disable scheduling entirely (the
boot run also stops).

Retention is intentionally a **recent-window** view once a row falls outside
the inactive window and the top-100 protection. Clear a guild's statistics from
the dashboard if you need to reclaim all of its historical rows immediately.
