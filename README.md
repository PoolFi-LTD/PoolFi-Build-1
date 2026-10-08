# PoolFi Backend

Backend for [PoolFi](https://thepoolfi.com), group money collection on Stellar. This repository currently holds the PoolFi pool contract, a Soroban smart contract that holds group contributions in USDC.

The design, states, roles and functions are described in [docs/contract-plan.md](docs/contract-plan.md).

## Deployments

| Network | Contract ID | Admin | Token |
|---|---|---|---|
| Testnet | [`CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY`](https://stellar.expert/explorer/testnet/contract/CCIFRI4TC5AEUB6FCZRA5UXPGTDDKET4PTFFGBLXTZ4WVYSL5TM6BXUY) | `GA6PUGXGJYWDKMJCHPYXKHE7HTUJPSAC5XI7DEOTMQDY5MFT3O7KG3E4` | Circle testnet USDC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

Testnet deploy and initialization transaction: [`dafa67a0…61fc9b7`](https://stellar.expert/explorer/testnet/tx/dafa67a0853ecac4d369b7c0ee6cb7c2ba27b8fe19481f6097c5f94e361fc9b7)

## Layout

```text
.
├── contracts
│   └── pool
│       ├── src
│       │   ├── lib.rs     contract
│       │   └── test.rs    tests
│       └── Cargo.toml
├── docs
│   └── contract-plan.md
└── Cargo.toml             workspace
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

The constructor takes the contract admin and the USDC token address, so the deploy also initializes the contract:

```sh
stellar contract deploy \
  --wasm target/wasm32v1-none/release/pool.wasm \
  --source-account <identity> \
  --network testnet \
  --alias poolfi-pool \
  -- \
  --admin <admin address> \
  --token <USDC token contract address>
```

## Using the contract

Amounts are in USDC base units (7 decimals, so 1 USDC = `10000000`). Deadlines are Unix timestamps in seconds. Each call must be signed by the account named in it (`--source-account`).

```sh
# Create a pool: 100 USDC goal
stellar contract invoke --id poolfi-pool --network testnet --source-account <admin> -- \
  create_pool --admin <admin address> --goal_amount 1000000000 --deadline <unix seconds>

# Join, then contribute 20 USDC (the member needs a USDC trustline and balance)
stellar contract invoke --id poolfi-pool --network testnet --source-account <member> -- \
  join_pool --pool_id 0 --member <member address>
stellar contract invoke --id poolfi-pool --network testnet --source-account <member> -- \
  contribute --pool_id 0 --member <member address> --amount 200000000

# Read state
stellar contract invoke --id poolfi-pool --network testnet --source-account <any> -- get_pool --pool_id 0
```

`stellar contract invoke --id poolfi-pool --network testnet -- --help` lists every function.
