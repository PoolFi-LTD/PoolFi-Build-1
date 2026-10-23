-- Two-step sign-in: a password (checked by Supabase), then a code PoolFi emails.
-- A sign-in session only counts once its code is confirmed.

-- Codes PoolFi emails: to finish signing in, or to unlock an account after too many
-- wrong passwords. Only a hash is kept.
create table auth_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null check (purpose in ('sign_in', 'unlock')),
  -- The Supabase sign-in session a sign-in code confirms.
  session_id text,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index auth_codes_session_idx on auth_codes (session_id, created_at desc) where session_id is not null;
create index auth_codes_email_idx on auth_codes (email, purpose, created_at desc);

-- Sign-in sessions whose emailed code was confirmed. Only these can use the app.
create table verified_sessions (
  session_id text primary key,
  user_id text not null references users (id),
  verified_at timestamptz not null default now()
);

-- Wrong passwords in a row, per email. Five lock the account until an emailed code unlocks it.
create table sign_in_failures (
  email text primary key,
  failures integer not null default 0,
  last_failed_at timestamptz,
  locked_at timestamptz
);

alter table users
  add column email_verified_at timestamptz,
  -- Notifications newer than this are unread.
  add column notifications_seen_at timestamptz,
  add column reminders_on boolean not null default true;

-- Whether divers can see each other's payments. Off by default: a diver sees only their
-- own payment and the pool's totals; the lifeguard and approvers see everything.
alter table pools add column divers_see_payments boolean not null default false;

-- Closed to Supabase's public Data API, like the other tables (004).
alter table auth_codes enable row level security;
alter table verified_sessions enable row level security;
alter table sign_in_failures enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table auth_codes, verified_sessions, sign_in_failures from anon, authenticated;
  end if;
end
$$;
