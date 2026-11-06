"""PostgreSQL connectivity and ordered, idempotent schema migrations."""

from collections.abc import Callable
from pathlib import Path

import psycopg
from fastapi import Request

from motion_dna_api.config import Settings

DatabaseProbe = Callable[[], bool]


def apply_migrations(settings: Settings) -> None:
    migrations = Path(__file__).resolve().parents[2] / "migrations"
    with psycopg.connect(
        settings.database_url.get_secret_value(), connect_timeout=5, autocommit=False
    ) as connection:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        connection.commit()
        for migration in sorted(migrations.glob("*.sql")):
            version = migration.name
            if connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version=%s", (version,)
            ).fetchone():
                continue
            connection.execute(migration.read_text(encoding="utf-8"))
            connection.execute("INSERT INTO schema_migrations(version) VALUES (%s)", (version,))
            connection.commit()


def probe_database(settings: Settings) -> bool:
    with psycopg.connect(
        settings.database_url.get_secret_value(), connect_timeout=3, autocommit=True
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            return cursor.fetchone() == (1,)


def get_database_probe(request: Request) -> DatabaseProbe:
    return lambda: probe_database(request.app.state.settings)
