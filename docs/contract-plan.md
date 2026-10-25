# PoolFi Pool Contract — Plan

One Soroban contract on Stellar holds group contributions in USDC. A single deployment manages any number of pools. Each pool has its own admin wallet, goal, deadline and optional approvers. Members join, contribute USDC into the contract, and the money is either released to the pool admin once the goal is met (after a majority of approvers agree, if the pool has any) or, if the deadline passes first, the pool admin decides: extend the deadline or cancel so the money goes back to members. PoolFi's fee is taken from payouts, never from refunds.

## Principles

- **One contract, unlimited pools.** Pools are keyed by an incrementing `pool_id` (u64). No per-pool deployment.
- **Nothing hardcoded.** The contract admin, the USDC token address and the fee are set at deploy time (constructor), so the same code runs on testnet and mainnet. Goal, deadline, pool admin and approvers are inputs to each pool.
- **The contract holds the money.** Contributions move from the member's wallet into the contract. No personal wallet holds group funds before settlement.
- **Everything verifiable.** Pool totals, each member's contribution and an event for every action are on-chain.
- **Off-chain data stays off-chain.** Pool name, description, custom form fields and Naira amounts live in the app database, linked by `pool_id`.

## Roles

| Role | Who | Can |
|---|---|---|
| Contract admin | Address passed to the constructor | Hand over the admin role, upgrade the contract code, change the fee |
| Pool admin | Wallet passed to `create_pool` | Settle (withdraw) a funded pool, or request the payout when it has approvers; extend the deadline; cancel a pool |
| Approver | Wallet listed when the pool is created | Approve or decline the pool admin's payout request |
| Member | Any wallet that joins a pool | Join, contribute, receive a refund |
| Anyone | — | Read state; trigger a refund (funds always go to the member) |

## Pool states

```
            total ≥ goal              admin settles
   Open ───────────────────► Funded ─────────────────► Settled
   │  ▲                        │
   │  │ admin extends          │ admin cancels
   │  │ the deadline           │
   ▼  │                        │
  Expired ──────────► Refunded ◄┘
  (deadline passed  admin
   below the goal)  cancels      (admin can also cancel an Open pool)
```

| State | Meaning |
|---|---|
| Open | Accepting joins and contributions until the deadline |
| Funded | Goal reached. Still accepts joins and contributions until the deadline; the pool admin can settle |
| Settled | The full pool balance was paid to the pool admin. Final |
| Expired | The deadline passed before the goal. Nothing moves until the pool admin extends the deadline (back to Open) or cancels (Refunded). Members can't claim refunds on their own |
| Refunded | Members can claim back what they contributed. Final |

A blockchain can't act by itself when a deadline passes, so expiry is checked whenever the contract is called. A pool that is still Open after its deadline is reported as Expired; that status is never stored. The pool admin can extend the deadline any number of times, but only later and into the future.

**Payouts with approvers.** A Funded pool with approvers can't be settled directly. The pool admin calls `request_payout`; each approver then approves or declines. When a majority agrees (`approvers / 2 + 1`, so 2 of 3), the payout happens in the same call. A decline cancels the request and the admin can ask again. Contributions are paused while a request is open, so the amount the approvers agreed to can't change under them.

## Functions

| Function | Auth | Does |
|---|---|---|
| `__constructor(admin, token, fee_bps, fee_recipient)` | Deployer | Stores the contract admin, the USDC token address and the fee. Runs once, atomically with the deploy |
| `create_pool(admin, goal_amount, deadline) → pool_id` | `admin` | Validates goal > 0 and deadline in the future; creates an Open pool with no approvers |
| `create_pool_with_approvers(admin, goal_amount, deadline, approvers) → pool_id` | `admin` | Same, with up to 10 approvers (no duplicates, not the pool admin) |
| `join_pool(pool_id, member)` | `member` | Records the member once; pool must be accepting and before deadline |
| `contribute(pool_id, member, amount)` | `member` | Transfers USDC member → contract, updates the member's and the pool's totals, auto-joins if needed, flips Open → Funded at the goal |
| `settle(pool_id) → amount` | Pool admin | Funded pools without approvers. Pays the fee to the fee recipient and the rest to the pool admin → Settled. Returns what the admin received |
| `request_payout(pool_id)` | Pool admin | Funded pools with approvers. Opens a payout request |
| `approve_payout(pool_id, approver) → paid` | `approver` | Records the approval; pays out like `settle` once a majority has approved. Returns whether it paid |
| `decline_payout(pool_id, approver)` | `approver` | Cancels the open request. The money stays in the pool |
| `extend_deadline(pool_id, new_deadline)` | Pool admin | Open, Expired or Funded pools. Moves the deadline later (it must be in the future); an Expired pool is Open again |
| `cancel_pool(pool_id)` | Pool admin | Open, Expired or Funded → Refunded |
| `claim_refund(pool_id, member) → amount` | Anyone | Refunded (cancelled) pools only. Returns the member's contribution to the member, once |
| `get_pool`, `get_member`, `is_member`, `get_members(start, limit)`, `pool_count`, `admin`, `token`, `fee` | — | Read-only views |
| `set_fee(bps, recipient)` | Contract admin | Changes the fee, at most 1000 bps (10%) |
| `set_admin(new_admin)`, `upgrade(wasm_hash)` | Contract admin | Admin handover; code upgrade |

## Storage

- **Instance:** contract admin, token address, fee `{ bps, recipient }`, next pool id.
- **Persistent, per pool:** `Pool { id, admin, goal_amount, deadline, total_contributed, total_refunded, member_count, status, created_at, approvers, payout_approvals }`. `approvers` and `payout_approvals` are optional so pools stored by the first release still load after an upgrade.
- **Persistent, per pool + wallet:** `Member { joined_at, contributed, refunded }`, plus an index `(pool_id, n) → wallet` so members can be listed page by page without one unbounded list.
- TTLs are extended on every write, so active pools are never archived.

## Events

`pool_created`, `member_joined`, `contributed`, `pool_funded`, `pool_settled`, `payout_requested`, `payout_approved`, `payout_declined`, `fee_changed`, `deadline_extended`, `pool_cancelled`, `refunded`, `admin_changed`. The app backend indexes these to keep its database in sync, and explorers such as stellar.expert show them for verification.

## Errors

| Code | Error | Code | Error |
|---|---|---|---|
| 100 | `PoolNotFound` | 105 | `AlreadyMember` |
| 101 | `InvalidAmount` | 106 | `GoalNotReached` |
| 102 | `InvalidDeadline` | 107 | `NotRefundable` |
| 103 | `DeadlinePassed` | 108 | `NotMember` |
| 104 | `PoolClosed` | 109 | `NothingToRefund` |
| 110 | `ApprovalRequired` (settle on a pool with approvers) | 115 | `NoPayoutRequest` |
| 111 | `NoApprovers` (request on a pool without) | 116 | `AlreadyApproved` |
| 112 | `InvalidApprovers` | 117 | `PayoutPending` (contribution while a request is open) |
| 113 | `NotApprover` | 118 | `InvalidFee` |
| 114 | `PayoutAlreadyRequested` | | |

Codes start at 100 because the USDC token reports its own errors as codes 1–15 through the same calls (for example 10 for an insufficient balance). Separate ranges mean a code alone says which contract failed. Code before the upgrade numbered these 1–10.

## Amounts

USDC on Stellar has 7 decimals: 1 USDC = 10,000,000 units. All amounts are `i128` in base units. Naira ↔ USDC conversion happens in the app, not in the contract.

## Tests

Pool creation, a second wallet joining, and a USDC contribution being recorded (balances moved, totals updated, events emitted, member auth required). Also: Open → Funded → Settled, cancel and refund, an expired pool waiting for its admin, extending the deadline again and again, and the error cases (bad goal or deadline, double join, late contribution, early settle, double refund, wrong signer). Tests use a real Stellar Asset Contract token in the test environment, not a mock.

Security tests (`contracts/pool/src/test_security.rs`) cover four guarantees: unauthorized wallets can't withdraw (stranger, contributor or contract admin can't settle; nobody can move the contract's USDC directly or contribute from someone else's wallet), a pool can't be settled twice, there are no duplicate refunds, and actions are rejected when the pool state or deadline doesn't allow them. Payout tests keep unrelated pool funds in the contract, so a payout that should be refused would actually succeed if the check were missing.

Approval and fee tests (`contracts/pool/src/test_approvals.rs`) cover the majority rule, declines, paused contributions, who may approve, the fee split and its cap, refunds without a fee, and a pool written by the first release loading after an upgrade.

## Deployment

Built with `stellar contract build`, deployed to testnet with the constructor arguments `admin`, `token` (Circle testnet USDC: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`), `fee_bps` and `fee_recipient`. The deploy transaction also initializes the contract. A contract upgraded from the first release has no fee until the contract admin calls `set_fee`.
