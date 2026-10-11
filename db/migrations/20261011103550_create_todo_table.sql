-- migrate:up

CREATE TABLE todo (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    description VARCHAR(255) NOT NULL
);

-- migrate:down

DROP TABLE todo;
