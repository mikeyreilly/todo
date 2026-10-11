\restrict dbmate

-- Dumped from database version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)
-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: todo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.todo (
    id uuid DEFAULT uuidv7() NOT NULL,
    description character varying(255) NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    priority bigint NOT NULL
);


--
-- Name: reorder_todo(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reorder_todo(p_todo_id uuid, p_before_id uuid) RETURNS public.todo
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


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: todo todo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todo
    ADD CONSTRAINT todo_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261011103550'),
    ('20261011103551'),
    ('20261011144741'),
    ('20261011160000');
