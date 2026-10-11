# Setup

Open psql as the PostgreSQL administrator:
```bash
sudo -u postgres psql
```

Create a login role for your application:
```sql
CREATE ROLE todo WITH LOGIN PASSWORD 'secret';
```

3. Create the database
Still in the administrative psql session:
```sql
CREATE DATABASE todo OWNER todo;
```