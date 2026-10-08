# PoolFi Pool Contract — Plan

One Soroban contract on Stellar holds group contributions in USDC. A single deployment manages any number of pools. Each pool has its own admin wallet, goal and deadline. Members join, contribute USDC into the contract, and the money is either released to the pool admin once the goal is met or returned to members if it isn't.

## Principles

- **One contract, unlimited pools.** Pools are keyed by an incrementing `pool_id` (u64). No per-pool deployment.
- **Nothing hardcoded.** The contract admin and the USDC token address are set at deploy time (constructor), so the same code runs on testnet and mainnet. Goal, deadline and pool admin are inputs to each pool.
- **The contract holds the money.** Contributions move from the member's wallet into the contract. No personal wallet holds group funds before settlement.
- **Everything verifiable.** Pool totals, each member's contribution and an event for every action are on-chain.
- **Off-chain data stays off-chain.** Pool name, description, custom form fields and Naira amounts live in the app database, linked by `pool_id`.

## Roles

| Role | Who | Can |
|---|---|---|
| Contract admin | Address passed to the constructor | Hand over the admin role, upgrade the contract code |
| Pool admin | Wallet passed to `create_pool` | Settle (withdraw) a funded pool, cancel a pool |
| Member | Any wallet that joins a pool | Join, contribute, receive a refund |
| Anyone | — | Read state; trigger a refund (funds always go to the member) |

## Pool states

```
            total ≥ goal              admin settles
   Open ───────────────────► Funded ─────────────────► Settled
     │                         │
     │ deadline passes below   │ admin cancels
     │ goal, or admin cancels  │
     └───────────► Refunded ◄──┘
```

| State | Meaning |
|---|---|
| Open | Accepting joins and contributions until the deadline |
| Funded | Goal reached. Still accepts joins and contributions until the deadline; the pool admin can settle |
| Settled | The full pool balance was paid to the pool admin. Final |
| Refunded | Members can claim back what they contributed. Final |

A blockchain can't act by itself when a deadline passes, so expiry is checked whenever the contract is called. A pool that is still Open after its deadline is reported as Refunded.

## Functions

| Function | Auth | Does |
|---|---|---|
| `__constructor(admin, token)` | Deployer | Stores the contract admin and the USDC token address. Runs once, atomically with the deploy |
| `create_pool(admin, goal_amount, deadline) → pool_id` | `admin` | Validates goal > 0 and deadline in the future; creates an Open pool |
| `join_pool(pool_id, member)` | `member` | Records the member once; pool must be accepting and before deadline |
| `contribute(pool_id, member, amount)` | `member` | Transfers USDC member → contract, updates the member's and the pool's totals, auto-joins if needed, flips Open → Funded at the goal |
| `settle(pool_id) → amount` | Pool admin | Funded only. Transfers the pool balance to the pool admin → Settled |
| `cancel_pool(pool_id)` | Pool admin | Open or Funded → Refunded |
| `claim_refund(pool_id, member) → amount` | Anyone | Refunded pools only. Returns the member's contribution to the member, once |
| `get_pool`, `get_member`, `get_members(start, limit)`, `pool_count`, `admin`, `token` | — | Read-only views |
| `set_admin(new_admin)`, `upgrade(wasm_hash)` | Contract admin | Admin handover; code upgrade |

## Storage

- **Instance:** contract admin, token address, next pool id.
- **Persistent, per pool:** `Pool { id, admin, goal_amount, deadline, total_contributed, total_refunded, member_count, status, created_at }`.
- **Persistent, per pool + wallet:** `Member { joined_at, contributed, refunded }`, plus an index `(pool_id, n) → wallet` so members can be listed page by page without one unbounded list.
- TTLs are extended on every write, so active pools are never archived.

## Events

`pool_created`, `member_joined`, `contributed`, `pool_funded`, `pool_settled`, `pool_cancelled`, `refunded`, `admin_changed`. The app backend indexes these to keep its database in sync, and explorers such as stellar.expert show them for verification.

## Amounts

USDC on Stellar has 7 decimals: 1 USDC = 10,000,000 units. All amounts are `i128` in base units. Naira ↔ USDC conversion happens in the app, not in the contract.

## Tests

Pool creation, a second wallet joining, and a USDC contribution being recorded (balances moved, totals updated, events emitted, member auth required). Also: Open → Funded → Settled, cancel and refund, expiry and refund, and the error cases (bad goal or deadline, double join, late contribution, early settle, double refund, wrong signer). Tests use a real Stellar Asset Contract token in the test environment, not a mock.

## Deployment

Built with `stellar contract build`, deployed to testnet with the constructor arguments `admin` and `token` (Circle testnet USDC: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`). The deploy transaction also initializes the contract.
