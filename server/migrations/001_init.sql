-- Users come from the auth provider; `id` is its user id (the JWT `sub`).
create table users (
  id text primary key,
  email text,
  created_at timestamptz not null default now()
);

-- One Stellar wallet per user, created by the backend. The secret key is
-- encrypted with AES-256-GCM; `key_version` names the encryption key used.
create table wallets (
  user_id text primary key references users (id),
  public_key text not null unique,
  secret_ciphertext bytea not null,
  secret_iv bytea not null,
  secret_tag bytea not null,
  key_version integer not null,
  -- Set once the account exists on-chain with a USDC trustline.
  activated_at timestamptz,
  activation_tx_hash text,
  created_at timestamptz not null default now()
);

-- Off-chain pool details. The money, totals and status live in the contract;
-- `chain_pool_id` is the pool's id there.
create table pools (
  id uuid primary key default gen_random_uuid(),
  contract_id text not null,
  chain_pool_id bigint not null,
  admin_user_id text not null references users (id),
  name text not null,
  description text,
  -- USDC base units (7 decimals).
  goal_amount numeric(39, 0) not null check (goal_amount > 0),
  deadline timestamptz not null,
  -- Fields contributors fill in when they join.
  fields jsonb not null default '[]',
  create_tx_hash text not null,
  created_at timestamptz not null default now(),
  unique (contract_id, chain_pool_id)
);

create index pools_admin_user_id_idx on pools (admin_user_id);

create table pool_members (
  pool_id uuid not null references pools (id),
  user_id text not null references users (id),
  field_values jsonb not null default '{}',
  join_tx_hash text not null,
  joined_at timestamptz not null default now(),
  primary key (pool_id, user_id)
);

create index pool_members_user_id_idx on pool_members (user_id);

create table contributions (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references pools (id),
  user_id text not null references users (id),
  amount numeric(39, 0) not null check (amount > 0),
  tx_hash text not null unique,
  created_at timestamptz not null default now()
);

create index contributions_pool_id_idx on contributions (pool_id);
create index contributions_user_id_idx on contributions (user_id);

-- USDC added to a user's wallet. `provider` names where it came from.
create table deposits (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id),
  provider text not null,
  amount numeric(39, 0) not null check (amount > 0),
  tx_hash text not null unique,
  created_at timestamptz not null default now()
);

create index deposits_user_id_created_at_idx on deposits (user_id, created_at);
