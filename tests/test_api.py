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
