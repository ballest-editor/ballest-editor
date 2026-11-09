-- The database behind apps/collect (writes) and apps/admin (reads), on Neon Postgres. Run once as the database's
-- owner, with psql, passing the two roles' passwords (README.md § Setting up):
--
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -v collect_password=... -v admin_password=... -f apps/collect/schema.sql
--
-- Roles made here (not in the Neon console, whose roles are all members of neon_superuser) have only what's granted
-- below. Raw events are kept forever for now: there is no cleanup job.

begin;

-- One row per feedback submission. The message itself is only in the GitHub issue; the Discord and creator names are
-- only here, for the maintainer to reply.
create table feedback (
  id bigint generated always as identity primary key,
  issue_number integer not null,
  issue_url text not null,
  kind text not null check (kind in ('bug', 'idea', 'mismatch', 'other')),
  discord text,
  creator text,
  app_version text not null,
  platform text not null,
  os_version text not null,
  -- An HMAC of the client's address (IP_HASH_SALT), for the rate limit; never the address.
  ip_hash text not null,
  received_at timestamptz not null
);

-- One row per usage event; the columns another tag has are null.
create table usage_events (
  id bigint generated always as identity primary key,
  -- Shared by the events of one POST.
  batch_id uuid not null,
  install_id text not null,
  app_version text not null,
  platform text not null,
  os_version text not null,
  tag text not null check (tag in ('sessionStart', 'sessionEnd', 'error')),
  -- When the app says it happened; null when what it sent wasn't a time.
  at timestamptz,
  duration_s integer,
  first_launch boolean,
  error_source text,
  error_message text,
  error_stack text,
  ip_hash text not null,
  received_at timestamptz not null
);
create index usage_events_when on usage_events ((coalesce(at, received_at)));
create index usage_events_errors on usage_events (error_source, error_message) where tag = 'error';

-- One row per request a rate limit let through or refused, per route: the endpoint writes its slot, then counts the
-- last hour's, so requests sent together can't all read a count from before any of them.
create table rate_slots (
  route text not null check (route in ('feedback', 'events')),
  ip_hash text not null,
  taken_at timestamptz not null
);
create index rate_slots_count on rate_slots (route, ip_hash, taken_at);

-- Every event with the UTC day it happened (or arrived, when the app's time wasn't one). Not granted to anyone: the
-- views below read through it.
create view usage_days as
select *, (coalesce(at, received_at) at time zone 'UTC')::date as day
from usage_events;

-- What apps/admin shows. Views run with their owner's rights, so the admin role reads these and nothing else.

create view daily_active_installs as
select day, count(distinct install_id)::int as installs
from usage_days
group by day;

create view sessions_daily as
select day,
  count(*) filter (where tag = 'sessionStart')::int as sessions,
  count(*) filter (where tag = 'sessionStart' and first_launch)::int as first_launches,
  percentile_cont(0.5) within group (order by duration_s) as median_s,
  percentile_cont(0.9) within group (order by duration_s) as p90_s
from usage_days
where tag in ('sessionStart', 'sessionEnd')
group by day;

create view session_length_30d as
select count(duration_s)::int as sessions,
  percentile_cont(0.5) within group (order by duration_s) as median_s,
  percentile_cont(0.9) within group (order by duration_s) as p90_s
from usage_days
where tag = 'sessionEnd' and day > current_date - 30;

create view versions_daily as
select day, app_version, count(distinct install_id)::int as installs
from usage_days
group by day, app_version;

create view platform_split_30d as
select platform, count(distinct install_id)::int as installs
from usage_days
where day > current_date - 30
group by platform;

create view error_groups as
select error_source as source,
  error_message as message,
  count(*)::int as count,
  count(distinct install_id)::int as installs,
  min(received_at) as first_seen,
  max(received_at) as last_seen,
  (array_agg(app_version order by received_at desc))[1] as latest_version,
  (array_agg(error_stack order by received_at desc))[1] as latest_stack
from usage_events
where tag = 'error'
group by error_source, error_message;

create view feedback_weekly as
select date_trunc('week', received_at at time zone 'UTC')::date as week,
  count(*)::int as count,
  jsonb_agg(jsonb_build_object('number', issue_number, 'url', issue_url, 'kind', kind) order by received_at) as issues
from feedback
group by 1;

create view feedback_latest as
select issue_number, issue_url, kind, discord, creator, app_version, platform, os_version, received_at
from feedback;

-- The collect endpoint: inserts, and reads only the rate limits' slots.
create role ballest_collect with login password :'collect_password';
grant usage on schema public to ballest_collect;
grant insert on feedback, usage_events, rate_slots to ballest_collect;
grant select on rate_slots to ballest_collect;

-- The dashboard: the views, read only.
create role ballest_admin with login password :'admin_password';
grant usage on schema public to ballest_admin;
grant select on daily_active_installs, sessions_daily, session_length_30d, versions_daily, platform_split_30d,
  error_groups, feedback_weekly, feedback_latest to ballest_admin;
alter role ballest_admin set default_transaction_read_only = on;

commit;
