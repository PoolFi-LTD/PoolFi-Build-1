-- What the web app shows: profiles, pool details, the member list, approvers,
-- payout requests, receipts and an activity feed. Money and status stay in the
-- contract; these are the details around it.

-- Profiles
alter table users
  add column phone text,
  add column first_name text,
  add column last_name text,
  -- {"kind":"emoji","emoji":"🌻","bg":"#F4E8D2"} or {"kind":"photo","url":"data:image/jpeg;base64,..."}
  add column avatar jsonb;

-- Pool details. Pools made before the app get values that keep them working.
alter table pools
  -- The short code in invite links, e.g. PF-7K2Q.
  add column code text unique,
  add column emoji text not null default '✨',
  add column type text not null default 'Something else',
  -- What each diver pays, in USDC base units, including any share of the fee.
  add column share_amount numeric(39, 0),
  -- How many divers the lifeguard expects; the goal is share_amount × this.
  add column expected_count integer,
  -- The contract's fee when the pool was made, in basis points (500 = 5%).
  add column fee_bps integer not null default 0,
  add column fee_covered boolean not null default false,
  add column pick_your_name boolean not null default true,
  add column allow_not_on_list boolean not null default true,
  add column divers_can_share boolean not null default true;

update pools
set code = 'PF-' || upper(substr(md5(id::text), 1, 4)),
    share_amount = goal_amount,
    expected_count = 1
where code is null;

alter table pools
  alter column code set not null,
  alter column share_amount set not null,
  alter column expected_count set not null;

-- People who approve the payout with the lifeguard.
create table pool_approvers (
  pool_id uuid not null references pools (id),
  user_id text not null references users (id),
  position integer not null,
  primary key (pool_id, user_id)
);

create index pool_approvers_user_id_idx on pool_approvers (user_id);

-- Everyone in a pool: people on the lifeguard's list, and people who paid by link.
-- `user_id` is set once the person pays as themselves.
create table pool_divers (
  id uuid primary key default gen_random_uuid(),
  -- The order people were added in, for the member list.
  seq bigint generated always as identity,
  pool_id uuid not null references pools (id),
  name text not null,
  -- Phone or email; only the lifeguard sees it.
  contact text,
  user_id text references users (id),
  on_list boolean not null default true,
  -- Set while a payment for this person is going through, so no one else pays as them meanwhile.
  paying_at timestamptz,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now()
);

create index pool_divers_pool_id_idx on pool_divers (pool_id, seq);
create unique index pool_divers_pool_user_idx on pool_divers (pool_id, user_id) where user_id is not null;
create index pool_divers_user_id_idx on pool_divers (user_id) where user_id is not null;

-- Which diver a payment was for, and its receipt reference (e.g. PF-R-7K2Q-0041).
alter table contributions
  add column diver_id uuid references pool_divers (id),
  add column receipt_ref text unique;

-- Each diver pays once.
create unique index contributions_diver_id_idx on contributions (diver_id) where diver_id is not null;

-- A lifeguard's request for the payout. With approvers it waits for their votes;
-- without, it's paid straight away. A declined request ends; the next one is a new row.
create table payout_requests (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references pools (id),
  requested_by text not null references users (id),
  destination text not null check (destination in ('wallet', 'bank')),
  approvals_needed integer not null,
  request_tx_hash text,
  requested_at timestamptz not null default now(),
  declined_by text references users (id),
  decline_reason text,
  declined_at timestamptz,
  -- Set once the money moved: the pool's total, PoolFi's fee and what the lifeguard got.
  paid_at timestamptz,
  paid_tx_hash text unique,
  gross numeric(39, 0),
  fee numeric(39, 0),
  net numeric(39, 0),
  reference text unique
);

create index payout_requests_pool_id_idx on payout_requests (pool_id, requested_at desc);
-- At most one request waiting at a time.
create unique index payout_requests_open_idx on payout_requests (pool_id) where paid_at is null and declined_at is null;

create table payout_votes (
  request_id uuid not null references payout_requests (id),
  user_id text not null references users (id),
  vote text not null check (vote in ('approved', 'declined')),
  tx_hash text not null unique,
  at timestamptz not null default now(),
  primary key (request_id, user_id)
);

-- What happened in each pool, newest first in the app. The sentence is written when
-- it's shown, so each person sees "You paid…" or "Ada paid…" as fits.
create table activity (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references pools (id),
  kind text not null check (kind in ('payment', 'reminder', 'goal_met', 'approval', 'payout', 'refund', 'joined', 'created')),
  actor_user_id text references users (id),
  actor_name text,
  amount numeric(39, 0),
  -- Extra facts, e.g. {"count": 19} for a reminder or {"vote": "declined"} for an approval.
  data jsonb not null default '{}',
  -- The real time, not the transaction's, so two things in one transaction keep their order.
  at timestamptz not null default clock_timestamp()
);

create index activity_pool_id_at_idx on activity (pool_id, at desc);
