from collections.abc import Iterator

from fastapi import Request
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


def create_pool(settings: Settings) -> ConnectionPool:
    return ConnectionPool(
        conninfo=settings.database_url,
        min_size=1,
        max_size=10,
        timeout=10,
        open=False,
        kwargs={"row_factory": dict_row},
    )


def get_connection(request: Request) -> Iterator[Connection]:
    # Commits on success and rolls back on exceptions before returning to the pool.
    with request.app.state.pool.connection() as connection:
        yield connection
