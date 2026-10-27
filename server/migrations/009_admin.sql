-- The admin dashboard (/admin): suspending accounts, and a log of everything the
-- PoolFi team does from it.

-- A suspended account can't sign in or use the app until the team lifts it. Its pools,
-- wallet and refunds carry on as they are.
alter table users
  add column suspended_at timestamptz,
  add column suspended_reason text;

-- What the team did, to what, and why. Newest first on the dashboard.
create table admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id text not null references users (id),
  -- The address on the allow-list (ADMIN_EMAILS) when it was done.
  admin_email text not null,
  action text not null check (action in (
    'suspend_user', 'unsuspend_user', 'unlock_user', 'sign_out_user', 'activate_wallet',
    'extend_pool', 'close_pool', 'retry_refunds', 'run_refund_job'
  )),
  target_kind text not null check (target_kind in ('user', 'pool', 'job')),
  target_id text,
  reason text,
  details jsonb not null default '{}',
  at timestamptz not null default now()
);

create index admin_actions_at_idx on admin_actions (at desc);
create index admin_actions_target_idx on admin_actions (target_kind, target_id, at desc);

-- Closed to Supabase's API roles, like every other table (see 004_lock_tables.sql).
alter table admin_actions enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table admin_actions from anon, authenticated;
  end if;
end
$$;
