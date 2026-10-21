-- The pool admin taking a funded pool's USDC (the contract's `settle`). One per pool.
create table withdrawals (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null unique references pools (id),
  user_id text not null references users (id),
  amount numeric(39, 0) not null check (amount > 0),
  tx_hash text not null unique,
  created_at timestamptz not null default now()
);

-- A contributor getting their USDC back from a pool that missed its goal.
create table refunds (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references pools (id),
  wallet_address text not null,
  -- Null when the contributor's wallet isn't a PoolFi wallet.
  user_id text references users (id),
  amount numeric(39, 0) not null check (amount > 0),
  tx_hash text not null unique,
  created_at timestamptz not null default now(),
  unique (pool_id, wallet_address)
);

-- Set once the refund job has nothing left to do for a pool: every contributor
-- was refunded, or the pool met its goal.
alter table pools add column refunds_finished_at timestamptz;

create index pools_refund_candidates_idx on pools (deadline) where refunds_finished_at is null;
