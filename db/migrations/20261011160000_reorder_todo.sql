-- migrate:up

CREATE FUNCTION reorder_todo(p_todo_id uuid, p_before_id uuid)
-- return just the todo we're reordering, with its new priority set
RETURNS todo
LANGUAGE plpgsql
AS $$
DECLARE
    moving todo%ROWTYPE;
    target todo%ROWTYPE;
    previous_priority bigint;
    next_id uuid;
    new_priority numeric;
BEGIN
    -- Use the same transaction-level lock as creation. Acquire it before reads
    -- so waiting writers see the committed order under READ COMMITTED.
    LOCK TABLE todo IN SHARE ROW EXCLUSIVE MODE;

    SELECT * INTO moving FROM todo WHERE id = p_todo_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Todo not found';
    END IF;

    IF p_before_id IS NOT NULL THEN
        SELECT * INTO target FROM todo WHERE id = p_before_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Target todo not found';
        END IF;
    END IF;

    -- If we are moving the todo to where it already is, just return it
    SELECT id INTO next_id FROM todo
    WHERE (priority, id) > (moving.priority, moving.id)
    ORDER BY priority, id LIMIT 1;
    IF p_before_id = p_todo_id OR next_id IS NOT DISTINCT FROM p_before_id THEN
        RETURN moving;
    END IF;

    SELECT priority INTO previous_priority FROM todo
    WHERE id <> p_todo_id
      AND (p_before_id IS NULL OR (priority, id) < (target.priority, target.id))
    ORDER BY priority DESC, id DESC LIMIT 1;

    -- Numeric arithmetic avoids overflowing bigint before deciding to rebalance.
    IF p_before_id IS NULL THEN
        new_priority := previous_priority::numeric + 1024;
    ELSIF previous_priority IS NULL THEN
        new_priority := target.priority::numeric - 1024;
    ELSE
        new_priority := floor((previous_priority::numeric + target.priority::numeric) / 2);
    END IF;

    IF (previous_priority IS NOT NULL AND p_before_id IS NOT NULL
        AND target.priority::numeric - previous_priority::numeric <= 1)
       OR new_priority < -9223372036854775808::numeric
       OR new_priority > 9223372036854775807::numeric THEN
        -- Place the moving item between ranked neighbors, then restore spacing
        -- in one set-based update (including deterministic ordering for ties).
        WITH remaining AS (
            SELECT id, row_number() OVER (ORDER BY priority, id) AS position
            FROM todo WHERE id <> p_todo_id
        ), insertion AS (
            SELECT COALESCE(
                (SELECT position FROM remaining WHERE id = p_before_id),
                (SELECT count(*) + 1 FROM remaining)
            ) AS position
        ), positioned AS (
            SELECT id, position * 2 AS slot FROM remaining
            UNION ALL
            SELECT p_todo_id, position * 2 - 1 FROM insertion
        ), spaced AS (
            SELECT id, row_number() OVER (ORDER BY slot) * 1024 AS priority
            FROM positioned
        )
        UPDATE todo SET priority = spaced.priority
        FROM spaced WHERE todo.id = spaced.id;
    ELSE
        UPDATE todo SET priority = new_priority::bigint WHERE id = p_todo_id;
    END IF;

    SELECT * INTO moving FROM todo WHERE id = p_todo_id;
    RETURN moving;
END;
$$;

-- migrate:down

DROP FUNCTION reorder_todo(uuid, uuid);
