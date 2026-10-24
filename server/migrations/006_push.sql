-- Device notifications (Web Push): each browser or installed app a user turned them on in.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id),
  -- The push service address for this device; unique per browser install.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);

create index push_subscriptions_user_id_idx on push_subscriptions (user_id);

-- Closed to Supabase's public Data API, like the other tables (004).
alter table push_subscriptions enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table push_subscriptions from anon, authenticated;
  end if;
end
$$;
