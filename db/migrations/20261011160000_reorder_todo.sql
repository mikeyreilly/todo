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
    previous_id uuid;
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

    -- The destination's predecessor also tells us whether this is a no-op.
    SELECT id, priority INTO previous_id, previous_priority FROM todo
    WHERE p_before_id IS NULL OR (priority, id) < (target.priority, target.id)
    ORDER BY priority DESC, id DESC LIMIT 1;
    IF p_before_id = p_todo_id OR previous_id = p_todo_id THEN
        RETURN moving;
    END IF;

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
        -- Give the moving item its target's sort keys, sorting just before it.
        -- A null target sorts last for appends. All other items keep their order.
        WITH positioned AS (
            SELECT id, priority AS sort_priority, id AS sort_id, 1 AS side
            FROM todo WHERE id <> p_todo_id
            UNION ALL
            SELECT p_todo_id, target.priority, target.id, 0
        ), spaced AS (
            SELECT id, row_number() OVER (
                ORDER BY sort_priority NULLS LAST, sort_id, side
            ) * 1024 AS priority
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
