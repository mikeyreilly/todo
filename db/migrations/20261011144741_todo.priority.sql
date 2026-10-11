-- migrate:up

alter table todo add column priority bigint not null;

-- migrate:down

alter table todo drop column priority;
