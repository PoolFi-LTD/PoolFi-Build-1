# PoolFi Backend

Backend for [PoolFi](https://thepoolfi.com), group money collection on Stellar. It has three parts: the pool contract, a Soroban smart contract that holds group contributions in USDC; the server, an HTTP API that gives every user a wallet and runs the contribution flow for them; and the web app in `web/` (see [web/README.md](web/README.md)).

The design, states, roles and functions are described and stated in [docs/contract-plan.md](docs/contract-plan.md).

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
| `0d70a2d9170bc74cbb9631be3bd3c43ffbc51b324e5d99447a7dbaf758e459c9` | Payout approvers (majority must agree) and the PoolFi fee on payouts; errors 110–118 | Development deployment (upgraded in [`940ba6ee…`](https://stellar.expert/explorer/testnet/tx/940ba6ee20be4760d782bc1c93c5dca63bcc1a287663e95ede5d61eeb21f754e), fee set to 5% in [`c52c535f…`](https://stellar.expert/explorer/testnet/tx/c52c535f0f67d4df431e4f32cd5db497ec5ac7339d07a48dd5b18b2f689ed424)) |
| `b4f6432c90ab25f5a07f55e8403903742a237f3a41bae074656fd0a7f0f1c861` | Error codes renumbered to 100–109 so they can't clash with the USDC token's codes | Development deployment before the approvers release (upgraded in [`d0f0c729…`](https://stellar.expert/explorer/testnet/tx/d0f0c729a7023ff20d5bf826f7e05f5fa39c05543198fce66f0c970f864ec7e7)) |
| `70bf2650a1a9f3a24ec80517d03ec1f56ecb3534be8dfbc594d8a733e6af70b5` | First release, errors 1–10 | Client's deployment, until its Admin upgrades |

The newest code is uploaded to testnet. Upgrading keeps the contract ID and all pools and funds, and can go straight from the first release to the newest. Only the contract admin can do it. An upgraded contract charges no fee until the admin sets one (500 = 5%):

```sh
stellar contract invoke --id <contract ID> --network testnet --source-account <admin identity> -- \
  upgrade --new_wasm_hash 0d70a2d9170bc74cbb9631be3bd3c43ffbc51b324e5d99447a7dbaf758e459c9
stellar contract invoke --id <contract ID> --network testnet --source-account <admin identity> -- \
  set_fee --bps 500 --recipient <PoolFi fee wallet>
```

The server understands both error numberings, so it works before and after the upgrade.

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
│   ├── migrations                database schema
│   └── test                      unit and testnet end-to-end tests
├── web                           web app (Next.js), desktop design
├── docs
│   └── contract-plan.md
└── Cargo.toml                    workspace
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

### Escrow

- **Withdrawal:** only the pool's admin can withdraw, only after the goal is met (which can only happen before the deadline), and only once. The contract enforces all three; the API explains a refusal (`goal_not_reached`, `already_withdrawn`, `pool_refunded`, `not_pool_admin`).
- **Automatic refunds:** when a pool's deadline passes below its goal, the refund job sends every contributor their USDC back (membership `refunded`). The contract lets anyone send a refund but always pays the contributor, so no one has to sign. The job runs inside the server every `REFUND_JOB_INTERVAL_SECONDS` (default 300), or once with `npm run refunds` from an external scheduler. Only one server runs it at a time, and nobody is refunded twice.

### Running it

Requires Node.js 22 or newer and PostgreSQL.

```sh
cd server
npm install
cp .env.example .env   # then fill in the blanks
npm run db:local       # optional: a private local Postgres on port 54329
npm run dev            # applies migrations and starts on PORT
```

### Tests

```sh
npm test               # unit tests
npm run test:e2e       # the full flow and escrow on Stellar testnet through the API (about 4 minutes)
```

The end-to-end tests sign in users, create their wallets on testnet, deposit test USDC, create pools, join and contribute, withdraw, and wait out a short deadline to check that contributors are refunded automatically, checking each result on-chain. They run in temporary databases they drop afterwards.

