# PoolFi Build

 We did the full build for [PoolFi](https://app.thepoolfi.com), group money collection on Stellar blockchain. It has three parts: the pool contract, a Soroban contract that holds group contributions in USDC; the server, an HTTP API that gives every user a wallet and also runs the contribution flow for them; and the web app in `web/` (see [web/README.md](web/README.md)).

The design, states, roles and functions are well described and stated in [docs/contract-plan.md](docs/contract-plan.md).

## Deployments

| Network | Contract ID | Admin | Token |
|---|---|---|---|
| Testnet | [`CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY`](https://stellar.expert/explorer/testnet/contract/CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY) | `GA6PUGXGJYWDKMJCHPYXKHE7HTUJPSAC5XI7DEOTMQDY5MFT3O7KG3E4` | Circle testnet USDC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Testnet (development) | [`CCOOBNXMOJTZVGNX7X33ZBQMBEBVITFYVBY4SS67I43UHUW5C2ZY7P2R`](https://stellar.expert/explorer/testnet/contract/CCOOBNXMOJTZVGNX7X33ZBQMBEBVITFYVBY4SS67I43UHUW5C2ZY7P2R) | `GCQJS3YZ6G75FBHPFAR5HLZE44TY4ZMOAN5JAQUDWN4IAREYA5LVP7ZB` | Same |

Testnet deploy and initialization transaction: [`dafa67a0…61fc9b7`](https://stellar.expert/explorer/testnet/tx/dafa67a0853ecac4d369b7c0ee6cb7c2ba27b8fe19481f6097c5f94e361fc9b7)

The development deployment runs the same code and is what the server's automated tests use, so they don't add pools to the client's contract.

### Contract code versions

| Code (Wasm hash) | Change | Running on |
|---|---|---|
| `9ad4d3b934929e473c543ee480511d05e814a7604e457c5e3356b6ad4f1a5480` | A missed deadline waits for the pool admin: `extend_deadline` (any number of times) or `cancel_pool` to refund; no refunds by themselves (status `Expired`) | Development deployment (uploaded in [`88759b8d…`](https://stellar.expert/explorer/testnet/tx/88759b8d40758aa357e1d34916a64aed3e2a3d8a0a9c82003554e83171c9384e), upgraded in [`c1b3d30d…`](https://stellar.expert/explorer/testnet/tx/c1b3d30db756fbc6c3e5f824a95445cb382bdc39c10e401274e97522f983f1be)) |
| `0d70a2d9170bc74cbb9631be3bd3c43ffbc51b324e5d99447a7dbaf758e459c9` | Payout approvers (majority must agree) and the PoolFi fee on payouts; errors 110–118 | Development deployment before the missed-deadline release (upgraded in [`940ba6ee…`](https://stellar.expert/explorer/testnet/tx/940ba6ee20be4760d782bc1c93c5dca63bcc1a287663e95ede5d61eeb21f754e), fee set to 5% in [`c52c535f…`](https://stellar.expert/explorer/testnet/tx/c52c535f0f67d4df431e4f32cd5db497ec5ac7339d07a48dd5b18b2f689ed424)) |
| `b4f6432c90ab25f5a07f55e8403903742a237f3a41bae074656fd0a7f0f1c861` | Error codes renumbered to 100–109 so they can't clash with the USDC token's codes | Development deployment before the approvers release (upgraded in [`d0f0c729…`](https://stellar.expert/explorer/testnet/tx/d0f0c729a7023ff20d5bf826f7e05f5fa39c05543198fce66f0c970f864ec7e7)) |
| `70bf2650a1a9f3a24ec80517d03ec1f56ecb3534be8dfbc594d8a733e6af70b5` | First release, errors 1–10 | Client's deployment, until its Admin upgrades |

The newest code is uploaded to testnet. Upgrading keeps the contract ID and all pools and funds, and can go straight from the first release to the newest. Only the contract admin can do it. An upgraded contract charges no fee until the admin sets one (500 = 5%):

```sh
stellar contract invoke --id <contract ID> --network testnet --source-account <admin identity> -- \
  upgrade --new_wasm_hash 9ad4d3b934929e473c543ee480511d05e814a7604e457c5e3356b6ad4f1a5480
stellar contract invoke --id <contract ID> --network testnet --source-account <admin identity> -- \
  set_fee --bps 500 --recipient <PoolFi fee wallet>
```

The server understands both error numberings, and both ways a contract reports a missed deadline (`Refunded` before this release, `Expired` after), so it works before and after the upgrade.

## Layout

```text
.
├── contracts
│   └── pool
│       ├── src
│       │   ├── lib.rs            contract
│       │   ├── test.rs           tests
│       │   ├── test_security.rs  security tests
│       │   └── test_approvals.rs approver and fee tests
│       └── Cargo.toml
├── server                        HTTP API (Node.js, TypeScript)
│   ├── src
│   │   ├── app-routes.ts         the web app's endpoints (/v1/app)
│   │   ├── admin-routes.ts       the admin dashboard's endpoints (/v1/admin)
│   │   ├── api-types.ts          what those endpoints return, shared with web/
│   │   ├── services/app/         pools, payouts, invites, home, wallet, receipts
│   │   ├── services/admin.ts     the admin dashboard: what it shows, and the team's fixes
│   │   └── email/                emails (Resend) and their wording
│   ├── migrations                database schema
│   └── test                      unit and testnet end-to-end tests
├── web                           web app (Next.js); also serves the API at /api, and the admin dashboard at /admin
├── .github/workflows/refunds.yml runs the refund job every 10 minutes
├── docs
│   └── contract-plan.md
├── package.json                  npm workspaces: server and web, installed together
└── Cargo.toml                    Rust workspace
```

## Requirements

- Rust 1.84 or newer, with the `wasm32v1-none` target: `rustup target add wasm32v1-none`
- [Stellar CLI](https://github.com/stellar/stellar-cli)

## Build and test

```sh
cargo test
stellar contract build
```

The build writes `target/wasm32v1-none/release/pool.wasm`.

## Deploy

The constructor takes the contract admin, the USDC token address and the fee (basis points, and the wallet it goes to), so the deploy also initializes the contract:

```sh
stellar contract deploy \
  --wasm target/wasm32v1-none/release/pool.wasm \
  --source-account <identity> \
  --network testnet \
  --alias poolfi-pool \
  -- \
  --admin <admin address> \
  --token <USDC token contract address> \
  --fee_bps 500 \
  --fee_recipient <PoolFi fee wallet>
```

## Testing on testnet

Each step must be signed by the account it names, so run them with the Admin and Member keys. Amounts are in USDC base units (7 decimals, so 1 USDC = `10000000`). Deadlines are Unix timestamps in seconds.

**1. Add the two accounts to the Stellar CLI.** Each command asks for that account's secret key (`S…`) or recovery phrase.

```sh
stellar keys add admin
stellar keys add member
```

**2. Give the Member USDC.** Add a USDC trustline, then get testnet USDC from [Circle's faucet](https://faucet.circle.com) (choose Stellar testnet and paste the Member address).

```sh
stellar tx new change-trust --source-account member --network testnet \
  --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```

**3. Create a pool as the Admin:** 100 USDC goal, deadline 7 days from now. The command prints the new pool's id (the first pool is `0`).

```sh
stellar contract invoke --id CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY \
  --network testnet --source-account admin -- \
  create_pool --admin admin --goal_amount 1000000000 --deadline $(( $(date +%s) + 7 * 86400 ))
```

**4. Join as the Member.**

```sh
stellar contract invoke --id CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY \
  --network testnet --source-account member -- \
  join_pool --pool_id 0 --member member
```

**5. Contribute 20 USDC as the Member.**

```sh
stellar contract invoke --id CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY \
  --network testnet --source-account member -- \
  contribute --pool_id 0 --member member --amount 200000000
```

**6. Verify.** `get_pool` should show `member_count: 1` and `total_contributed: 200000000`, and `get_member` the Member's contribution. Each step above also prints a stellar.expert link to its transaction, and every call appears on the [contract's explorer page](https://stellar.expert/explorer/testnet/contract/CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY).

```sh
stellar contract invoke --id CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY \
  --network testnet --source-account admin -- get_pool --pool_id 0
stellar contract invoke --id CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY \
  --network testnet --source-account admin -- get_member --pool_id 0 --member member
```

`stellar contract invoke --id CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY --network testnet -- --help` lists every function.

## Server

The server in `server/` runs the contribution flow so users never touch a CLI or a wallet app:

- **Wallets are automatic.** The first time a user signs in, the server creates a Stellar wallet for them, sets it up to hold USDC and stores its secret key encrypted (AES-256-GCM). It signs for the user from then on.
- **PoolFi pays every fee.** A sponsor account covers each wallet's reserves and pays all transaction fees through fee bumps, so user wallets hold no XLM.
- **Pool details live in Postgres, money lives in the contract.** Names, descriptions and custom fields are in the database; balances, totals and status are read from the contract.

Sign-in tokens come from the auth provider (e.g. Supabase Auth), so the sign-up method can change without touching the server.

### Endpoints

All endpoints except `/health` and viewing a pool need `Authorization: Bearer <sign-in token>`. Amounts are USDC as decimal strings (`"20.5"`). Errors are `{ "error": { "code", "message", "details" } }`.

| Method | Path | Does |
|---|---|---|
| GET | `/health` | Database and Stellar connectivity |
| GET | `/v1/me` | The signed-in user and their wallet (created on first sign-in) |
| GET | `/v1/wallet` | Wallet address and USDC balance |
| POST | `/v1/wallet/deposits` | `{ amount }`: adds test USDC to the wallet (testnet treasury, with per-deposit and daily limits) |
| POST | `/v1/pools` | `{ name, description?, goalAmount, deadline, fields? }`: creates a pool with the user's wallet as pool admin |
| GET | `/v1/pools/:poolId` | A pool, with live on-chain totals; signed-in viewers also get their membership |
| POST | `/v1/pools/:poolId/join` | `{ fieldValues? }`: joins without paying (membership `pending`) |
| POST | `/v1/pools/:poolId/contributions` | `{ amount, fieldValues? }`: pays USDC into the pool, joining first if needed (membership `paid`) |
| POST | `/v1/pools/:poolId/withdraw` | Pool admin only: once the goal is met, moves the pool's USDC into the admin's wallet (pool `settled`) |

### Web app endpoints

The screens in `web/` use `/v1/app`, shaped as `server/src/api-types.ts` describes. Amounts there are USDC as plain numbers (`1.58`). The pool's lifeguard (its admin) creates it; divers pay their share by invite link; approvers, if any, release the payout by majority.

| Method | Path | Does |
|---|---|---|
| GET | `/v1/app/me` | The signed-in user (wallet made on first visit), with `admin: true` for the team (`ADMIN_EMAILS`) |
| PUT | `/v1/app/me/profile` | `{ firstName, lastName, avatar }` |
| GET | `/v1/app/home` | Balance, alerts, the user's pools and recent activity |
| GET | `/v1/app/pools` | Every pool the user leads, approves or paid into |
| POST | `/v1/app/pools` | Creates a pool: share (with the fee covered by divers or not), expected divers, deadline, approvers, member list |
| GET | `/v1/app/pools/:id` | One pool, with its divers, approvers, payout and activity. Contacts only for the lifeguard |
| POST | `/v1/app/pools/:id/divers` | Lifeguard: adds people to the list |
| POST | `/v1/app/pools/:id/reminders` | Lifeguard: marks the unpaid as reminded and returns the message to send |
| GET | `/v1/app/pools/:id/record` | The pool's statement |
| POST | `/v1/app/pools/:id/payout` | Lifeguard: `{ destination: "wallet" }`. Paid at once without approvers; otherwise waits for them. Bank is "coming soon" |
| POST | `/v1/app/pools/:id/payout/approve` | Approver: agrees; the last approval needed pays out |
| POST | `/v1/app/pools/:id/payout/decline` | Approver: `{ reason }`; the money stays and the lifeguard can ask again |
| GET | `/v1/app/invites/:code` | Public: what the invite link shows (names only) |
| POST | `/v1/app/invites/:code/pay` | `{ diverId }` or `{ name }`: pays the share from the user's wallet, returns the receipt reference |
| GET | `/v1/app/activity`, `/v1/app/contacts` | The user's activity feed; people they share pools with (for picking approvers) |
| GET | `/v1/app/wallet` | Address, balance and history |
| POST | `/v1/app/wallet/deposits` | `{ amount }`: test USDC (testnet) |
| GET | `/v1/app/receipts/:ref` | Public: checks a receipt |
| GET | `/v1/app/fee` | Public: the contract's payout fee in basis points |
| PATCH | `/v1/app/pools/:id/settings` | Lifeguard: `{ diversSeePayments }`. Off (the default), each diver sees only their own payment and the totals |
| GET, POST | `/v1/app/notifications`, `/v1/app/notifications/read` | The notifications inbox with unread items; marking it read |
| GET, PUT | `/v1/app/me/achievements`, `/v1/app/me/preferences` | Streak and badges for the Settings screen; `{ remindersOn }` |

### Device notifications

PoolFi pushes the moments that matter to people's phones and computers (Web Push), even with the app closed: a payment into your pool, the pool filling up, a payout waiting for your approval, an approval or decline, the payout landing, a reminder, your pool missing its deadline, a new deadline, a refund. Settings → Device notifications turns them on per device; the Notifications page offers it too. Android, Windows, macOS and Linux browsers work as they are; on iPhone and iPad (iOS 16.4+) PoolFi must first be added to the Home Screen (Share → Add to Home Screen) and opened from there. The service worker is `web/public/sw.js`; the app manifest is `web/src/app/manifest.ts`.

### Sign-in

Signing in takes a password and then a code. Supabase checks the password in the browser; PoolFi then emails a 6-digit code (through Resend), and only a session whose code is confirmed can use `/v1/*`.

| Method | Path | Does |
|---|---|---|
| POST | `/v1/auth/status` | `{ email }`: whether the account is locked, and how many wrong passwords are left |
| POST | `/v1/auth/failed` | `{ email }`: counts a wrong password. The fifth in a row (within 24 hours) locks the account and emails an unlock code |
| POST | `/v1/auth/code` | After the right password: emails the code (one every 30 seconds, six an hour) |
| POST | `/v1/auth/code/verify` | `{ code }`: confirms the session. A code expires after 10 minutes or five wrong tries |
| POST | `/v1/auth/unlock/code`, `/v1/auth/unlock` | A new unlock code; `{ email, code }` unlocks the account |
| POST | `/v1/auth/password-reset/done` | After a new password from the emailed reset link: unlocks the account, and every device must confirm a new code |

Sessions Supabase opens without the password (an emailed link or code) can never be confirmed, so the password and the inbox are both needed.

A session with no activity for 10 minutes ends: the server closes it (`401 session_expired`) and the app sends the person to sign in again (password and a new code), then back to the page they were on. Taps, typing and scrolling count as activity, shared by every tab; while someone is active the app tells the server (`POST /v1/auth/active`) every couple of minutes. Change the limit with `SESSION_IDLE_MINUTES` on the server and `NEXT_PUBLIC_SESSION_IDLE_MINUTES` in the web app (keep them equal).

### Emails

With `RESEND_API_KEY` set, the server emails people (through Resend) when something happens in their pools. Everyone signs in with their email, so everyone can get them; reminders go to people on a pool's list whose contact is an email address. A failed email is logged and never stops a payment or payout.

| When | Who | Email |
|---|---|---|
| A share is paid | The payer | Their receipt, with its reference |
| The goal is reached | The lifeguard | "Reached its goal", with a link to request the payout |
| A payout is requested | Each approver | "Needs your approval", with a link to approve or decline |
| An approver declines | The lifeguard | Who declined, and why |
| The payout is paid | The lifeguard | What landed, the fee and the reference |
| The lifeguard taps Remind | People on the list whose contact is an email address | A reminder with the invite link, at most once every 12 hours each |
| The deadline passes below the goal | The lifeguard | "Missed its deadline", asking them to extend it or refund the divers (once per deadline) |
| The lifeguard extends the deadline | Everyone else in the pool with an account | The new deadline, with a link to the pool (or to pay, for those who haven't) |
| The lifeguard refunds | Each refunded diver | Their money is back |

The messages are in `server/src/email/messages.ts`. Sign-in codes are sent by Supabase, through Resend too (see [Supabase](#1-supabase)).

### Escrow

- **Withdrawal:** only the pool's admin can withdraw, only after the goal is met (which can only happen before the deadline), and only once. The contract enforces all three; the API explains a refusal (`goal_not_reached`, `already_withdrawn`, `pool_refunded`, `not_pool_admin`).
- **A missed deadline:** when a pool's deadline passes below its goal, nothing is refunded by itself. The contract reports the pool as `expired`: nobody can pay in, withdraw or claim a refund. The refund job tells the pool's lifeguard once (email, device notification, inbox and a Home alert), and they choose on the pool's page:
  - **Extend the deadline** (`POST /v1/app/pools/:id/extend` with `{ "deadline" }`): the contract's `extend_deadline` moves it later, as many times as they like, and the pool takes payments again. Everyone else in the pool is told. If the new deadline passes too, the lifeguard is asked again.
  - **Refund the divers** (`POST /v1/app/pools/:id/refund`): the contract's `cancel_pool` closes the pool, and every contributor gets their USDC back straight away (membership `refunded`). The contract lets anyone send a refund but always pays the contributor, so no one else has to sign. Any refund that doesn't go through then is sent by the next job run.

  Divers can't take their money out while they wait for the lifeguard. The job runs inside the server every `REFUND_JOB_INTERVAL_SECONDS` (default 300), or once with `npm run refunds` from an external scheduler. Only one server runs it at a time, and nobody is refunded twice.

### The admin dashboard

`/admin` ("PoolFi Pulse") is for the PoolFi team: everyone, every pool and all the USDC, and the fixes the refund job can't make on its own. Team members sign in like everyone else (password, then the emailed code); the server lets in only addresses listed in `ADMIN_EMAILS` (comma-separated, any case). Team members see **Admin** in the sidebar, and **Admin dashboard** in Settings on phones. Without `ADMIN_EMAILS`, nobody can open it.

| Page | Shows | Can do |
|---|---|---|
| Overview | People, pools and USDC at a glance; what needs a look; growth over 30 days; where people get stuck; everything happening, live | Run the refund job now |
| People | Everyone, searchable; active, quiet, did nothing yet, suspended, locked. Each person's wallet (with its USDC on Stellar), pools, payments, deposits, payouts, refunds and signed-in devices | Suspend (signed out at once, can't sign in until lifted), lift a suspension, unlock after wrong passwords, sign out everywhere, put a wallet on Stellar that didn't make it |
| Pools | Every pool by status, searchable. Each pool's people (with contacts), payments, payout, refunds, approvers' votes, activity, what the contract says, and every transaction with a link to stellar.expert | Give it more time, close it and refund everyone who paid (both signed with the lifeguard's wallet), send the refunds left |
| Money | Pools still refunding, wallets not on Stellar, and the latest payouts, refunds, payments and deposits | Send a pool's refunds left; put a wallet on Stellar |
| Admin log | Everything the team did: who, to what, when and why | Read only |

Money still moves only by the contract's rules: the team acts through the lifeguard's own wallet (which the backend holds), and refunds go through the refund job's code, so nobody is refunded twice. Team members can't suspend themselves or each other. Every fix is written to the `admin_actions` table (migration `009_admin.sql`).

| Method | Path | Does |
|---|---|---|
| GET | `/v1/admin/overview` | Totals, what needs a look, growth, friction, the activity feed |
| GET | `/v1/admin/users?filter=&q=`, `/v1/admin/users/:id` | People (`all`, `active`, `quiet`, `new`, `suspended`, `locked`); one person |
| POST | `/v1/admin/users/:id/suspend`, `/unsuspend`, `/unlock`, `/sign-out`, `/wallet/activate` | `{ reason }` to suspend |
| GET | `/v1/admin/pools?status=&q=`, `/v1/admin/pools/:id` | Pools by status; one pool with its transactions |
| POST | `/v1/admin/pools/:id/extend`, `/close`, `/refunds/retry` | `{ deadline, reason? }`; `{ reason }`; nothing |
| GET | `/v1/admin/money` | Pools refunding, wallets not on Stellar, payouts, refunds, payments, deposits |
| POST | `/v1/admin/jobs/refunds` | One pass of the refund job |
| GET | `/v1/admin/log` | The admin log |

Anyone else gets `403 not_admin`. A suspended person gets `403 account_suspended` from the app and from the sign-in code step.

### Running it

Requires Node.js 22 or newer and PostgreSQL. The server and the web app are npm workspaces, installed together from the repository root:

```sh
npm install                       # in the repository root
cp server/.env.example server/.env   # then fill in the blanks
npm --workspace server run db:local  # optional: a private local Postgres on port 54329
npm run migrate                   # creates or updates the tables
npm --workspace server run dev    # the API alone, on PORT
npm run dev                       # or: the web app with the API at /api, on port 3000
```

For `npm run dev`, link the server's settings into the web app once: `ln -s ../server/.env web/.env.local`.

### Tests

```sh
npm test                              # unit tests
npm --workspace server run test:e2e   # the flows and escrow on Stellar testnet through the API (about 7 minutes)
```

`admin.test.ts` checks the admin dashboard: only the team gets in; what it shows; extending and closing a pool with the lifeguard's wallet; suspending, unlocking and signing out an account; putting a wallet on Stellar; the admin log.

`missed-deadline.test.ts` waits out a short deadline: the lifeguard is asked (and nobody is refunded), extends it, divers pay again, and when the new deadline passes too the lifeguard refunds everyone.

`app-flow.test.ts` runs the web app's flow: a pool with three approvers and a fee-covering share, the invite link, paying (including a failed payment that frees the name again), reminders, a declined payout, then a majority approval that pays the lifeguard less the fee, and the wallet, record, receipt and contacts that follow.

The end-to-end tests sign in users, create their wallets on testnet, deposit test USDC, create pools, join and contribute, withdraw, and wait out short deadlines to check that nothing is refunded until the lifeguard chooses to, checking each result on-chain. They run in temporary databases they drop afterwards.


## Deploying on Vercel

One Vercel project serves the web app and the API: `web/src/app/api/[...path]/route.ts` runs the server inside the web app at `/api`. The database and sign-in are on Supabase. Secret values go into Vercel and Supabase, never into the repository.

### 1. Supabase

- **Database.** Project Settings → Database → Connect → **Session pooler** (port 5432). That's `DATABASE_URL`, with `?sslmode=require&uselibpqcompat=true` added so the connection is encrypted. Not the transaction pooler (port 6543): the server uses session locks. Not the direct connection either: it's IPv6-only, and Vercel can't reach it.
- **Sign-in: passwords.** Signing in is two steps: the password (checked by Supabase), then a 6-digit code that PoolFi itself emails through Resend. Five wrong passwords in a row lock the account until the code emailed to its owner unlocks it, and PoolFi only accepts a session once its code is confirmed. In Supabase: Authentication → Sign In / Providers → **Email** on, **Confirm email off** (PoolFi confirms the address with its own code), and **Minimum password length** `8`. Only the organisation's Owner or an Administrator can change these.
- **Password resets: the only emailed link.** Authentication → Emails → **SMTP Settings** → enable custom SMTP so Supabase's emails go through Resend too: host `smtp.resend.com`, port `465`, username `resend`, password your Resend API key, sender `noreply@thepoolfi.com`, sender name `PoolFi`. Under Authentication → Emails → Templates → **Reset password**, paste [docs/supabase-reset-password-email.html](docs/supabase-reset-password-email.html) with the subject `Reset your PoolFi password`. The other templates aren't used.
- **Site URL and redirects.** Authentication → URL Configuration → set the Site URL to your domain, and add `https://app.thepoolfi.com/reset-password` to the allowed Redirect URLs (and `http://localhost:3000/reset-password` for local development). The reset link opens that page to choose a new password.
- **Keys.** Project Settings → API: the project URL and the anon (publishable) key, for the web app. To check sign-ins, the server needs `AUTH_JWKS_URL=https://<project>.supabase.co/auth/v1/.well-known/jwks.json` (projects on JWT signing keys, the default for new ones), or the project's legacy JWT secret as `AUTH_JWT_SECRET`. Either way set `AUTH_JWT_ISSUER=https://<project>.supabase.co/auth/v1` and `AUTH_JWT_AUDIENCE=authenticated`.

### 2. Tables

Create them before the first deploy, and run it again whenever `server/migrations` gains a file. With `DATABASE_URL` in `server/.env` set to the Supabase session pooler URL:

```bash
npm run migrate
```

Migration `004_lock_tables.sql` closes PoolFi's tables to Supabase's public Data API, so the anon key in the web page can't read or change them.

### 3. The Vercel project

- Import the repository. **Root Directory: `web`**, framework Next.js. Keep **Include files outside the root directory in the Build Step** on: the web app builds the server's code from `../server`. `web/vercel.json` installs both workspaces from the root lockfile (`cd .. && npm ci`).
- Node.js 22 or newer.
- Environment variables (Production, and Preview if you use it):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase session pooler URL, plus `?sslmode=require&uselibpqcompat=true` |
| `DATABASE_POOL_MAX` | `3` |
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `POOL_CONTRACT_ID` | The pool contract (see [Deployments](#deployments)) |
| `USDC_ISSUER` | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle testnet) |
| `SPONSOR_SECRET` | The fee-paying account's secret key |
| `WALLET_ENCRYPTION_KEY` | 32 random bytes, base64. Never change it once wallets exist: it's the only way to open them |
| `AUTH_JWKS_URL` or `AUTH_JWT_SECRET`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE` | From Supabase, as above |
| `DEPOSIT_PROVIDER`, `TREASURY_SECRET` | `testnet-treasury` and the treasury's secret key (testnet only; leave both out to turn deposits off) |
| `CRON_SECRET` | A long random string (`openssl rand -hex 32`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Device notifications (Web Push). Generate once with `npx web-push generate-vapid-keys`, and never change them: every device would have to turn notifications on again. Subject: `mailto:` an address you read |
| `RESEND_API_KEY`, `EMAIL_FROM` | Your Resend key, and the sender on your Resend-verified domain, e.g. `PoolFi <noreply@thepoolfi.com>`. Optional: `EMAIL_REPLY_TO`, and `EMAIL_TIME_ZONE` (default `Africa/Lagos`) |
| `APP_URL` | Optional: the site's address for links in reminders, e.g. `https://thepoolfi.com` (defaults to the Vercel production domain) |
| `ADMIN_EMAILS` | The PoolFi team's emails, comma-separated: they can open the admin dashboard (`/admin`) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase. Setting these switches the app from sample data to the real backend |

`NEXT_PUBLIC_` values are built into the page, so redeploy after changing them.

### 4. Refunds

`/api/cron/refunds` tells lifeguards when their pool misses its deadline, and sends any refund that didn't go through when the lifeguard chose to refund. Vercel Cron calls it daily (the most the free plan allows, `web/vercel.json`). For lifeguards to hear within minutes, `.github/workflows/refunds.yml` calls it every 10 minutes once two repository secrets are set (Settings → Secrets and variables → Actions): `POOLFI_URL` (the site, e.g. `https://thepoolfi.com`) and `CRON_SECRET` (the same value as on Vercel).

### 5. Check it

`https://<your domain>/api/health` should answer `{"status":"ok", ...}` with the contract ID. Then sign in with an email code, add test USDC in the wallet, create a pool and pay into it from a second account.

### Moving to the client's contract

The client's deployment runs the first release until its Admin upgrades it ([Contract code versions](#contract-code-versions)). After `upgrade` and `set_fee`, change `POOL_CONTRACT_ID` to it and redeploy. Pools belong to the contract they were made on, so pools made on the development deployment won't show after the switch.
