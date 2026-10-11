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
| GET | `/todos` | List all todos, ordered by priority (then UUID) |
| POST | `/todos` | Create a todo; returns 201 |
| PATCH | `/todos/{id}` | Edit description and/or completion; returns 404 if missing |
| PATCH | `/todos/{id}/order` | Move before another todo, or to the end |

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

Reordering requires `{"before_id":"TARGET_UUID"}`, or `{"before_id":null}` to move
to the end. Missing items or targets return 404; missing/invalid fields return 422.
Moving before itself or to its current position is a successful no-op. Priorities
are server-managed: new todos receive the maximum priority + 1024 (starting at
1024), and moves use the available gaps. When a gap is exhausted, the server
restores 1024-point spacing. Creates and reorders are serialized in transactions.
Reordering runs in the PostgreSQL `reorder_todo(uuid, uuid)` function, including
locking and rebalancing, so the endpoint uses one database call. Apply the new
migration with `uv run poe migrations` before using it. The response is the moved
todo, with the same fields as other todo responses.

This API has no authentication; all callers share the same todo list.

## Frontend

With the backend running, open a second terminal from the repository root:

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open the local URL printed by Vite (usually http://localhost:5173). The Preact UI
lists your saved todos, adds new ones, edits descriptions, and toggles completion.
You can filter by All, Active, or Completed. Drag the grip on the left of a todo
to reorder it; the green insertion line shows where it will land. Mouse and touch
are supported, with scrolling near the viewport edges. You can also focus the
handle and use Arrow Up/Down; Escape cancels a drag. Drops are saved to the backend.
In filtered lists, drops insert before the indicated visible todo; dropping at the
bottom moves the item to the end of the full list without removing hidden todos.
Failed requests show errors without discarding your draft or changing saved order.

Vite proxies `/todos` requests to `http://127.0.0.1:8000`, so local development
needs no backend CORS changes. If you change the backend port, update
`frontend/vite.config.ts`.

```sh
npm --prefix frontend test
npm --prefix frontend run build
```

The production build is written to `frontend/dist`. For deployment, serve that
folder and route `/todos` (including `/todos/{id}`) to the FastAPI backend on the
same origin. The proxy above is a development convenience, not a production server.

## Tests

```sh
uv run pytest
TEST_DATABASE_URL='postgres://todo:secret@localhost:5432/todo_test?sslmode=disable' uv run pytest
```

Without `TEST_DATABASE_URL`, only validation tests run; database tests are skipped.
Integration tests apply the real migrations in a unique temporary schema and remove
that schema afterward. Use a separate test database and a role with schema creation
permission. `TEST_DATABASE_URL` for tests must be exported; pytest does not load `.env`.
