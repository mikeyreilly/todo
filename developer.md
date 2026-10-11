# Requirements

You will need postgresql 18 or later, npm and Astral uv.

# Setup

Open psql as the PostgreSQL administrator:
```bash
sudo -u postgres psql
```

Create a login role for your application:
```sql
CREATE ROLE todo WITH LOGIN PASSWORD 'secret';
```

3. Create the databases
Still in the administrative psql session:
```sql
CREATE DATABASE todo OWNER todo;
CREATE DATABASE todo_test OWNER todo;
```

Then from the todo repo root run

```sh
uv run poe dev-start
```

That will run the migrations and start the server.