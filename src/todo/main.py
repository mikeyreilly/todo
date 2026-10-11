from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, status
from psycopg import Connection
from psycopg.errors import NoDataFound
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from todo.database import Settings, create_pool, get_connection

Description = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
]
Database = Annotated[Connection, Depends(get_connection, scope="function")]


class TodoCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: Description
    completed: bool = False


class TodoUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: Description | None = None
    completed: bool | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> "TodoUpdate":
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Updated fields cannot be null")
        return self


class TodoOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    before_id: UUID | None


class Todo(BaseModel):
    id: UUID
    description: str
    completed: bool


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        pool = create_pool(settings or Settings())
        try:
            pool.open(wait=True, timeout=10)
            app.state.pool = pool
            yield
        finally:
            pool.close()

    app = FastAPI(title="Todo API", lifespan=lifespan)

    @app.get("/todos", response_model=list[Todo])
    def list_todos(connection: Database):
        return connection.execute(
            "SELECT id, description, completed FROM todo ORDER BY priority, id"
        ).fetchall()

    @app.post("/todos", response_model=Todo, status_code=status.HTTP_201_CREATED)
    def create_todo(todo: TodoCreate, connection: Database):
        # Serialize writers until commit so concurrent creates see the latest max.
        connection.execute("LOCK TABLE todo IN SHARE ROW EXCLUSIVE MODE")
        return connection.execute(
            "INSERT INTO todo (description, completed, priority) "
            "SELECT %s, %s, COALESCE(MAX(priority), 0) + 1024 FROM todo "
            "RETURNING id, description, completed",
            (todo.description, todo.completed),
        ).fetchone()

    @app.patch("/todos/{todo_id}/order", response_model=Todo)
    def reorder_todo(todo_id: UUID, order: TodoOrder, connection: Database):
        try:
            return connection.execute(
                "SELECT id, description, completed FROM reorder_todo(%s, %s)",
                (todo_id, order.before_id),
            ).fetchone()
        except NoDataFound as error:
            raise HTTPException(
                status_code=404, detail=error.diag.message_primary
            ) from error

    @app.patch("/todos/{todo_id}", response_model=Todo)
    def update_todo(todo_id: UUID, todo: TodoUpdate, connection: Database):
        result = connection.execute(
            "UPDATE todo SET description = COALESCE(%s, description), "
            "completed = COALESCE(%s, completed) WHERE id = %s "
            "RETURNING id, description, completed",
            (todo.description, todo.completed, todo_id),
        ).fetchone()
        if result is None:
            raise HTTPException(status_code=404, detail="Todo not found")
        return result

    return app


app = create_app()
