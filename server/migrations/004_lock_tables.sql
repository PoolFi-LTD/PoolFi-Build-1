-- Supabase publishes tables in the `public` schema through its Data API to anyone
-- with the project's anon key, which is public in the web app. PoolFi's tables are
-- only for the server, so they're closed to those roles: row-level security with no
-- policies lets nobody but the owner (the server's connection) see or change a row.
-- Other tables in the project (the waitlist) are left as they are.
-- New tables need the same two lines.

alter table users enable row level security;
alter table wallets enable row level security;
alter table pools enable row level security;
alter table pool_members enable row level security;
alter table contributions enable row level security;
alter table deposits enable row level security;
alter table withdrawals enable row level security;
alter table refunds enable row level security;
alter table pool_approvers enable row level security;
alter table pool_divers enable row level security;
alter table payout_requests enable row level security;
alter table payout_votes enable row level security;
alter table activity enable row level security;
alter table schema_migrations enable row level security;

-- Supabase's API roles; plain Postgres (local development) doesn't have them.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table
      users, wallets, pools, pool_members, contributions, deposits, withdrawals, refunds,
      pool_approvers, pool_divers, payout_requests, payout_votes, activity, schema_migrations
    from anon, authenticated;
  end if;
end
$$;
