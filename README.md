# Todo API

FastAPI backend using PostgreSQL, psycopg connection pooling, and dbmate migrations.
Requires Python 3.14+, uv, Node/npm, and PostgreSQL 18+.

## Setup

Create the application role and databases in an administrator `psql` session:

```sql
CREATE ROLE todo WITH LOGIN PASSWORD 'secret';
CREATE DATABASE todo OWNER todo;
CREATE DATABASE todo_test OWNER todo;
```

From the repository root:

```sh
uv sync
npm ci
cp .env.example .env  # if you do not already have .env; set your own credentials
uv run poe dev-start
```

`dev-start` applies dbmate migrations then runs FastAPI at http://127.0.0.1:8000.
The backend reads `DATABASE_URL` from the environment or `.env`. Environment variables
take precedence. Migrations are explicit, not run automatically by the server.
Existing todos receive `completed = false` when the new migration runs.

`.env` is ignored by Git; `.env.example` contains matching local development defaults.
The `todo` / `secret` credentials are for a localhost-only development database.
Never reuse them for deployed databases. If you customize the database password,
update `DATABASE_URL` in your local `.env` too.

Interactive API documentation: http://127.0.0.1:8000/docs.

## REST API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/todos` | List all todos, ordered by UUID |
| POST | `/todos` | Create a todo; returns 201 |
| PATCH | `/todos/{id}` | Edit description and/or completion; returns 404 if missing |

Each todo contains `id` (UUID), `description`, and `completed` (boolean).
Descriptions are trimmed and must contain 1–255 characters. Creation requires a
description; `completed` defaults to false. Updates require at least one field;
null values and unknown fields are rejected with 422, as are invalid UUIDs.

```sh
curl http://127.0.0.1:8000/todos
curl -X POST http://127.0.0.1:8000/todos \
  -H 'Content-Type: application/json' \
  -d '{"description":"Buy milk"}'
curl -X PATCH http://127.0.0.1:8000/todos/REPLACE_WITH_UUID \
  -H 'Content-Type: application/json' \
  -d '{"completed":true}'
```

This API has no authentication; all callers share the same todo list. The frontend
is unchanged. For local Vite development, proxy `/todos` to the backend or configure
CORS before making cross-origin requests directly from the browser.

## Tests

```sh
uv run pytest
TEST_DATABASE_URL='postgres://todo:secret@localhost:5432/todo_test?sslmode=disable' uv run pytest
```

Without `TEST_DATABASE_URL`, only validation tests run; database tests are skipped.
Integration tests apply the real migrations in a unique temporary schema and remove
that schema afterward. Use a separate test database and a role with schema creation
permission. `TEST_DATABASE_URL` for tests must be exported; pytest does not load `.env`.
