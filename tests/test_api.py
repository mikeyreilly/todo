import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import make_conninfo

from todo.database import Settings, get_connection
from todo.main import create_app


@pytest.fixture
def validation_client():
    app = create_app()
    # Validation tests do not need a database or start the application lifespan.
    app.dependency_overrides[get_connection] = lambda: None
    return TestClient(app)


@pytest.mark.parametrize("description", ["", "   ", "x" * 256, None])
def test_invalid_description(validation_client, description):
    response = validation_client.post("/todos", json={"description": description})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "changes", [{}, {"description": None}, {"completed": None}, {"unknown": True}]
)
def test_invalid_update(validation_client, changes):
    response = validation_client.patch(f"/todos/{uuid4()}", json=changes)
    assert response.status_code == 422


def test_invalid_id(validation_client):
    response = validation_client.patch("/todos/not-a-uuid", json={"completed": True})
    assert response.status_code == 422


@pytest.fixture
def client():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to run PostgreSQL integration tests")

    # Each test uses its own schema; never delete or alter existing tables.
    schema = f"test_{uuid4().hex}"
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(f'CREATE SCHEMA "{schema}"')
        try:
            conninfo = make_conninfo(url, options=f"-c search_path={schema},public")
            with psycopg.connect(conninfo) as connection:
                migrations = Path(__file__).resolve().parents[1] / "db" / "migrations"
                for migration in sorted(migrations.glob("*.sql")):
                    up = migration.read_text().split("-- migrate:up", 1)[1]
                    connection.execute(up.split("-- migrate:down", 1)[0])
            with TestClient(create_app(Settings(database_url=conninfo))) as test_client:
                yield test_client
        finally:
            admin.execute(f'DROP SCHEMA "{schema}" CASCADE')


def test_create_and_list(client):
    assert client.get("/todos").json() == []
    response = client.post("/todos", json={"description": "  Buy milk  "})
    assert response.status_code == 201
    todo = response.json()
    assert todo["description"] == "Buy milk"
    assert todo["completed"] is False
    assert client.get("/todos").json() == [todo]


def test_create_assigns_sparse_priorities(client):
    first = client.post("/todos", json={"description": "First"}).json()
    second = client.post("/todos", json={"description": "Second"}).json()
    with client.app.state.pool.connection() as connection:
        priorities = connection.execute(
            "SELECT id, priority FROM todo"
        ).fetchall()
    assert {str(row["id"]): row["priority"] for row in priorities} == {
        first["id"]: 1024,
        second["id"]: 2048,
    }


def test_create_uses_current_max_priority(client):
    first = client.post("/todos", json={"description": "First"}).json()
    client.post("/todos", json={"description": "Second"})
    with client.app.state.pool.connection() as connection:
        connection.execute(
            "UPDATE todo SET priority = 7500 WHERE id = %s", (first["id"],)
        )
    response = client.post("/todos", json={"description": "Third"})
    assert response.status_code == 201
    with client.app.state.pool.connection() as connection:
        row = connection.execute(
            "SELECT priority FROM todo WHERE id = %s", (response.json()["id"],)
        ).fetchone()
    assert row["priority"] == 8524


def test_edit_todo(client):
    todo = client.post("/todos", json={"description": "First"}).json()
    url = f"/todos/{todo['id']}"
    response = client.patch(url, json={"completed": True})
    assert response.status_code == 200
    assert response.json() == {**todo, "completed": True}
    description = "Buy Bob's milk; DROP TABLE todo; --"
    response = client.patch(url, json={"description": description})
    assert response.json() == {**todo, "description": description, "completed": True}
    response = client.patch(url, json={"completed": False})
    assert response.json()["completed"] is False
    assert client.get("/todos").json() == [response.json()]


def test_create_completed_and_edit_both_fields(client):
    response = client.post("/todos", json={"description": "First", "completed": True})
    assert response.status_code == 201
    todo = response.json()
    assert todo["completed"] is True
    response = client.patch(
        f"/todos/{todo['id']}", json={"description": "Second", "completed": False}
    )
    assert response.json() == {**todo, "description": "Second", "completed": False}


def test_missing_todo(client):
    response = client.patch(f"/todos/{uuid4()}", json={"completed": True})
    assert response.status_code == 404
    assert response.json() == {"detail": "Todo not found"}


@pytest.mark.parametrize(
    "body",
    [{}, {"before_id": "not-a-uuid"}, {"before_id": None, "priority": 1}],
)
def test_invalid_order(validation_client, body):
    response = validation_client.patch(f"/todos/{uuid4()}/order", json=body)
    assert response.status_code == 422


def test_invalid_order_id(validation_client):
    assert validation_client.patch(
        "/todos/not-a-uuid/order", json={"before_id": None}
    ).status_code == 422


def create_ordered_todos(client):
    return [
        client.post("/todos", json={"description": name}).json()
        for name in ["First", "Second", "Third", "Fourth"]
    ]


def read_priorities(client):
    with client.app.state.pool.connection() as connection:
        rows = connection.execute("SELECT id, priority FROM todo").fetchall()
    return {str(row["id"]): row["priority"] for row in rows}


@pytest.mark.parametrize(
    "moving_index,target_index,expected,priority",
    [
        (3, 0, [3, 0, 1, 2], 0),
        (0, 2, [1, 0, 2, 3], 2560),
        (0, None, [1, 2, 3, 0], 5120),
    ],
)
def test_reorder_todo(client, moving_index, target_index, expected, priority):
    todos = create_ordered_todos(client)
    original = read_priorities(client)
    moving = todos[moving_index]
    target = todos[target_index]["id"] if target_index is not None else None
    response = client.patch(
        f"/todos/{moving['id']}/order", json={"before_id": target}
    )
    assert response.status_code == 200
    assert response.json() == moving
    assert client.get("/todos").json() == [todos[i] for i in expected]
    assert read_priorities(client) == {**original, moving["id"]: priority}
    created = client.post("/todos", json={"description": "New"}).json()
    assert read_priorities(client)[created["id"]] == max(
        read_priorities(client)[todo["id"]] for todo in todos
    ) + 1024


@pytest.mark.parametrize("moving_index,target_index", [(1, 1), (1, 2), (3, None)])
def test_reorder_noop(client, moving_index, target_index):
    todos = create_ordered_todos(client)
    original = read_priorities(client)
    target = todos[target_index]["id"] if target_index is not None else None
    response = client.patch(
        f"/todos/{todos[moving_index]['id']}/order", json={"before_id": target}
    )
    assert response.status_code == 200
    assert client.get("/todos").json() == todos
    assert read_priorities(client) == original


def test_reorder_only_todo(client):
    todo = client.post("/todos", json={"description": "Only"}).json()
    response = client.patch(f"/todos/{todo['id']}/order", json={"before_id": None})
    assert response.status_code == 200
    assert response.json() == todo
    assert read_priorities(client) == {todo["id"]: 1024}


def test_reorder_missing_todo_or_target(client):
    todo = client.post("/todos", json={"description": "First"}).json()
    original = read_priorities(client)
    assert client.patch(
        f"/todos/{uuid4()}/order", json={"before_id": None}
    ).status_code == 404
    assert client.patch(
        f"/todos/{todo['id']}/order", json={"before_id": str(uuid4())}
    ).status_code == 404
    assert read_priorities(client) == original


@pytest.mark.parametrize("priorities", [[1, 2, 3, 4], [1, 1, 1, 1]])
def test_reorder_restores_spacing(client, priorities):
    todos = create_ordered_todos(client)
    with client.app.state.pool.connection() as connection:
        for todo, priority in zip(todos, priorities):
            connection.execute(
                "UPDATE todo SET priority = %s WHERE id = %s", (priority, todo["id"])
            )
    # Use the actual deterministic order in case priorities are tied.
    todos = client.get("/todos").json()
    response = client.patch(
        f"/todos/{todos[3]['id']}/order", json={"before_id": todos[1]["id"]}
    )
    assert response.status_code == 200
    expected = [todos[0], todos[3], todos[1], todos[2]]
    assert client.get("/todos").json() == expected
    assert read_priorities(client) == {
        todo["id"]: i * 1024 for i, todo in enumerate(expected, 1)
    }


def test_concurrent_creates_and_reorders(client):
    from concurrent.futures import ThreadPoolExecutor

    todos = create_ordered_todos(client)

    def change_order(i):
        if i % 2:
            return client.post("/todos", json={"description": f"New {i}"})
        return client.patch(
            f"/todos/{todos[i % 4]['id']}/order",
            json={"before_id": todos[(i + 1) % 4]["id"]},
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(change_order, range(12)))
    assert all(response.status_code in (200, 201) for response in responses)
    priorities = read_priorities(client)
    assert len(priorities) == 10
    assert len(set(priorities.values())) == 10
    ordered = client.get("/todos").json()
    assert [priorities[todo["id"]] for todo in ordered] == sorted(priorities.values())


def test_reorder_uses_one_database_call(validation_client):
    from unittest.mock import MagicMock

    todo_id, target_id = uuid4(), uuid4()
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = {
        "id": todo_id, "description": "Moved", "completed": False
    }
    validation_client.app.dependency_overrides[get_connection] = lambda: connection
    response = validation_client.patch(
        f"/todos/{todo_id}/order", json={"before_id": str(target_id)}
    )
    assert response.status_code == 200
    connection.execute.assert_called_once_with(
        "SELECT id, description, completed FROM reorder_todo(%s, %s)",
        (todo_id, target_id),
    )


@pytest.mark.parametrize("at_end", [False, True])
def test_reorder_rebalances_at_bigint_limits(client, at_end):
    todos = create_ordered_todos(client)
    base = 2**63 - 4 if at_end else -(2**63)
    with client.app.state.pool.connection() as connection:
        for i, todo in enumerate(todos):
            connection.execute(
                "UPDATE todo SET priority = %s WHERE id = %s", (base + i, todo["id"])
            )
    moving = todos[0] if at_end else todos[-1]
    target = None if at_end else todos[0]["id"]
    response = client.patch(
        f"/todos/{moving['id']}/order", json={"before_id": target}
    )
    assert response.status_code == 200
    expected = todos[1:] + todos[:1] if at_end else todos[-1:] + todos[:-1]
    assert client.get("/todos").json() == expected
    assert read_priorities(client) == {
        todo["id"]: i * 1024 for i, todo in enumerate(expected, 1)
    }


def test_reorder_function_returns_rebalanced_priority(client):
    todos = create_ordered_todos(client)
    with client.app.state.pool.connection() as connection:
        connection.execute("UPDATE todo SET priority = 1")
        ordered = connection.execute("SELECT id FROM todo ORDER BY priority, id").fetchall()
        row = connection.execute(
            "SELECT * FROM reorder_todo(%s, %s)", (ordered[-1]["id"], ordered[1]["id"])
        ).fetchone()
    assert str(row["id"]) in {todo["id"] for todo in todos}
    assert row["priority"] == 2048


def test_reorder_function_returns_single_todo(client):
    with client.app.state.pool.connection() as connection:
        row = connection.execute(
            "SELECT proretset, prorettype = 'todo'::regtype AS returns_todo "
            "FROM pg_proc WHERE oid = 'reorder_todo(uuid,uuid)'::regprocedure"
        ).fetchone()
    assert row == {"proretset": False, "returns_todo": True}


@pytest.mark.parametrize(
    "priorities",
    [
        [1024, 2048, 3072, 4096],
        [1, 2, 3, 4],
        [1, 1, 1, 1],
        [1, 2, 2, 3],
        [-4096, -3072, -2048, -1024],
        [-(2**63) + i for i in range(4)],
        [2**63 - 4 + i for i in range(4)],
    ],
)
def test_every_reorder_destination(client, priorities):
    todos = create_ordered_todos(client)
    original = {todo["id"]: priority for todo, priority in zip(todos, priorities)}
    ordered = sorted(todos, key=lambda todo: (original[todo["id"]], todo["id"]))
    for moving in ordered:
        for target in [*ordered, None]:
            with client.app.state.pool.connection() as connection:
                for todo_id, priority in original.items():
                    connection.execute(
                        "UPDATE todo SET priority = %s WHERE id = %s",
                        (priority, todo_id),
                    )
            expected = ordered.copy()
            if target != moving:
                expected.remove(moving)
                expected.insert(expected.index(target) if target else len(expected), moving)
            response = client.patch(
                f"/todos/{moving['id']}/order",
                json={"before_id": target["id"] if target else None},
            )
            assert response.status_code == 200
            assert response.json() == moving
            assert client.get("/todos").json() == expected
            if expected == ordered:
                assert read_priorities(client) == original


def test_reorder_missing_errors(client):
    todo = client.post("/todos", json={"description": "First"}).json()
    missing = str(uuid4())
    for moving, target, message in [
        (missing, todo["id"], "Todo not found"),
        (missing, missing, "Todo not found"),
        (todo["id"], missing, "Target todo not found"),
    ]:
        response = client.patch(
            f"/todos/{moving}/order", json={"before_id": target}
        )
        assert response.status_code == 404
        assert response.json() == {"detail": message}
    assert client.get("/todos").json() == [todo]


@pytest.mark.parametrize("fail_startup", [False, True])
def test_pool_lifecycle(monkeypatch, fail_startup):
    from unittest.mock import MagicMock

    pool = MagicMock()
    if fail_startup:
        pool.open.side_effect = RuntimeError("Database unavailable")
    monkeypatch.setattr("todo.main.create_pool", lambda settings: pool)
    app = create_app(Settings(database_url="postgresql://unused"))
    if fail_startup:
        with pytest.raises(RuntimeError, match="Database unavailable"):
            with TestClient(app):
                pass
    else:
        with TestClient(app):
            assert app.state.pool is pool
            pool.close.assert_not_called()
    pool.open.assert_called_once_with(wait=True, timeout=10)
    pool.close.assert_called_once()


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"description": "Valid", "unknown": True},
        {"description": "Valid", "completed": None},
    ],
)
def test_invalid_create_fields(validation_client, body):
    assert validation_client.post("/todos", json=body).status_code == 422
