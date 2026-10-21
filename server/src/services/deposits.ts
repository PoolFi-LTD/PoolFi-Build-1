import { Keypair, Operation } from "@stellar/stellar-sdk";
import type { AuthUser } from "../auth.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { ApiError } from "../errors.js";
import { formatUsdc } from "../money.js";
import type { Chain } from "../stellar/chain.js";
import { toApiError } from "./chain-errors.js";
import type { Wallets } from "./wallets.js";

export interface Deposit {
  id: string;
  amount: string;
  provider: string;
  txHash: string;
  createdAt: string;
}

interface DepositRow {
  id: string;
  amount: string;
  provider: string;
  tx_hash: string;
  created_at: Date;
}

/**
 * Puts USDC into a user's wallet. On testnet (`testnet-treasury`) it comes from
 * PoolFi's treasury account, within per-deposit and daily limits.
 */
export class Deposits {
  private readonly treasury: Keypair | null;

  constructor(
    private readonly db: Db,
    private readonly chain: Chain,
    private readonly wallets: Wallets,
    private readonly config: Config["deposits"],
  ) {
    this.treasury = config ? Keypair.fromSecret(config.treasurySecret) : null;
  }

  async deposit(user: AuthUser, amount: bigint): Promise<Deposit> {
    const { config, treasury } = this;
    if (!config || !treasury) {
      throw new ApiError(503, "deposits_unavailable", "Deposits aren't available yet.");
    }
    if (amount <= 0n) throw new ApiError(400, "invalid_amount", "The amount must be greater than zero.");
    if (amount > config.maxPerDeposit) {
      throw new ApiError(400, "deposit_too_large", `You can deposit up to ${formatUsdc(config.maxPerDeposit)} USDC at a time.`);
    }
    const wallet = await this.wallets.ensureUser(user);

    return this.db.withLock(`deposits:${user.id}`, async () => {
      const [recent] = await this.db.query<{ total: string }>(
        `select coalesce(sum(amount), 0)::text as total from deposits
         where user_id = $1 and created_at > now() - interval '24 hours'`,
        [user.id],
      );
      const remaining = config.dailyMax - BigInt(recent?.total ?? "0");
      if (amount > remaining) {
        throw new ApiError(
          429,
          "deposit_limit_reached",
          `You can deposit ${formatUsdc(remaining > 0n ? remaining : 0n)} more USDC in the next 24 hours.`,
        );
      }
      const available = await this.chain.usdcBalance(treasury.publicKey());
      if (available === null || available < amount) {
        throw new ApiError(503, "deposits_unavailable", "Deposits are temporarily unavailable.");
      }

      let txHash: string;
      try {
        const payment = Operation.payment({ destination: wallet.address, asset: this.chain.usdc, amount: formatUsdc(amount) });
        txHash = (await this.chain.submit(treasury, [payment])).hash;
      } catch (error) {
        throw toApiError(error, { pool: this.chain.poolContractId, usdc: this.chain.usdcContractId });
      }

      const [row] = await this.db.query<DepositRow>(
        "insert into deposits (user_id, provider, amount, tx_hash) values ($1, $2, $3, $4) returning *",
        [user.id, config.provider, amount.toString(), txHash],
      );
      if (!row) throw new Error(`Deposit ${txHash} was not saved`);
      return toDeposit(row);
    });
  }
}

function toDeposit(row: DepositRow): Deposit {
  return {
    id: row.id,
    amount: formatUsdc(BigInt(row.amount)),
    provider: row.provider,
    txHash: row.tx_hash,
    createdAt: row.created_at.toISOString(),
  };
}
