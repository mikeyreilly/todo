-- migrate:up

ALTER TABLE todo ADD COLUMN completed BOOLEAN NOT NULL DEFAULT FALSE;

-- migrate:down

ALTER TABLE todo DROP COLUMN completed;
