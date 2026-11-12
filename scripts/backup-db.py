#!/usr/bin/env python3
"""Create a consistent online backup of the BootstrapDJ SQLite database.

SQLite's backup API includes committed WAL contents, so the bot can keep
running. Only directories created by this script (prefix ``auto-``) are pruned;
deploy-time backups are never touched.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

PREFIX = "auto-"
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "prisma" / "bootstrapdj.db"
DEFAULT_DEST = Path(os.environ.get("BOT_DB_BACKUP_DIR", "/root/BotDBBackups"))


def database_path(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    url = os.environ.get("DATABASE_URL", "").removeprefix("file:").split("?", 1)[0]
    if url:
        path = Path(url).expanduser()
        if not path.is_absolute():
            path = REPO_ROOT / path
        return path.resolve()
    return DEFAULT_DB


def read_integrity(connection: sqlite3.Connection) -> tuple[str, int]:
    row = connection.execute("PRAGMA integrity_check").fetchone()
    status = str(row[0]) if row else "missing"
    tables = connection.execute(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table'"
    ).fetchone()[0]
    return status, int(tables)


def create_backup(db: Path, dest: Path, keep: int, verify: bool) -> Path:
    if not db.is_file():
        raise RuntimeError(f"database not found: {db}")

    dest.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(dest, 0o700)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    final = dest / f"{PREFIX}{stamp}"
    temporary = dest / f".{PREFIX}{stamp}.tmp"
    temporary.mkdir(mode=0o700)
    target = temporary / db.name

    try:
        source = sqlite3.connect(f"{db.as_uri()}?mode=ro", uri=True)
        source.execute("PRAGMA busy_timeout = 10000")
        try:
            copy = sqlite3.connect(target)
            try:
                source.backup(copy)
                status, tables = read_integrity(copy)
            finally:
                copy.close()
        finally:
            source.close()

        if status != "ok":
            raise RuntimeError(f"integrity check failed: {status}")

        os.chmod(target, 0o600)
        os.replace(temporary, final)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

    if verify:
        check = sqlite3.connect(f"{(final / db.name).as_uri()}?mode=ro", uri=True)
        try:
            status, tables = read_integrity(check)
        finally:
            check.close()
        if status != "ok":
            raise RuntimeError(f"published backup failed verification: {status}")

    if keep > 0:
        automatic = sorted(
            (
                path
                for path in dest.iterdir()
                if path.is_dir() and path.name.startswith(PREFIX)
            ),
            reverse=True,
        )
        for old in automatic[keep:]:
            shutil.rmtree(old, ignore_errors=True)

    published = final / db.name
    print(
        f"backup={published} bytes={published.stat().st_size} "
        f"tables={tables} integrity={status}"
    )
    return final


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db",
        help="SQLite database path (default: DATABASE_URL, then prisma/bootstrapdj.db)",
    )
    parser.add_argument(
        "--dest",
        default=str(DEFAULT_DEST),
        help="backup root (default: BOT_DB_BACKUP_DIR or /root/BotDBBackups)",
    )
    parser.add_argument(
        "--keep",
        type=int,
        default=14,
        help="automatic backups to retain; 0 keeps all (default: 14)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="re-open the published backup and check it again",
    )
    args = parser.parse_args()

    try:
        create_backup(
            database_path(args.db),
            Path(args.dest).expanduser().resolve(),
            args.keep,
            args.verify,
        )
        return 0
    except Exception as error:
        print(f"backup failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
