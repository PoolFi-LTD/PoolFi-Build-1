import type { Db } from "../db.ts";
import type { Notifications } from "./app/notifications.ts";
import { ApiError } from "../errors.ts";
import { formatUsdc } from "../money.ts";
import type { Chain } from "../stellar/chain.ts";
import type { PoolContract } from "../stellar/pool-contract.ts";
import { toApiError } from "./chain-errors.ts";
import type { Wallets } from "./wallets.ts";

export interface Logger {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

export interface RefundRun {
  poolsChecked: number;
  refunds: number;
  failures: number;
  poolsFinished: number;
}

/** How many expired pools one run looks at; the rest wait for the next run. */
const POOLS_PER_RUN = 100;

/**
 * Refunds every contributor of every pool whose deadline passed without
 * reaching its goal. The contract allows anyone to send a refund and always
 * pays it to the contributor, so no one has to sign for it. Safe to run
 * repeatedly and from several servers: each refund is sent once, and a
 * contributor already refunded is skipped.
 */
export class RefundJob {
  private readonly contracts: { pool: string; usdc: string };

  constructor(
    private readonly db: Db,
    private readonly chain: Chain,
    private readonly contract: PoolContract,
    private readonly wallets: Wallets,
    private readonly concurrency: number,
    private readonly log: Logger,
    private readonly notify?: Notifications,
  ) {
    this.contracts = { pool: chain.poolContractId, usdc: chain.usdcContractId };
  }

  /** One pass over expired pools. Returns null if another server is already running it. */
  async runOnce(): Promise<RefundRun | null> {
    return this.db.tryWithLock("poolfi:refund-job", async () => {
      const pools = await this.db.query<{ id: string; chain_pool_id: string }>(
        `select id, chain_pool_id from pools
         where contract_id = $1 and deadline <= now() and refunds_finished_at is null
         order by deadline limit $2`,
        [this.contracts.pool, POOLS_PER_RUN],
      );
      const run: RefundRun = { poolsChecked: pools.length, refunds: 0, failures: 0, poolsFinished: 0 };
      for (const pool of pools) {
        const result = await this.refundPool(pool.id, BigInt(pool.chain_pool_id));
        run.refunds += result.refunds;
        run.failures += result.failures;
        if (result.finished) run.poolsFinished += 1;
      }
      if (run.poolsChecked > 0) this.log.info({ ...run }, "refund job run");
      return run;
    });
  }

  private async refundPool(poolId: string, chainPoolId: bigint) {
    const state = await this.contract.getPool(chainPoolId);
    // The goal was met: the pool admin withdraws (or already has); nothing to refund.
    if (state.status === "funded" || state.status === "settled") {
      await this.finish(poolId);
      return { refunds: 0, failures: 0, finished: true };
    }
    // Still open: the ledger clock hasn't reached the deadline yet. Try next run.
    if (state.status !== "refunded") return { refunds: 0, failures: 0, finished: false };

    const members = await this.contract.getMembers(chainPoolId, state.memberCount);
    const outcomes = await mapConcurrently(members, this.concurrency, (address) =>
      this.refundMember(poolId, chainPoolId, address),
    );
    const failures = outcomes.filter((o) => o === "failed").length;
    if (failures === 0) {
      await this.noteRefunded(poolId);
      await this.finish(poolId);
    }
    const refunded = outcomes.flatMap((o) => (typeof o === "object" ? [o] : []));
    await this.notify?.refunded(
      poolId,
      refunded.flatMap((r) => (r.userId ? [{ userId: r.userId, amount: r.amount }] : [])),
    );
    return { refunds: refunded.length, failures, finished: failures === 0 };
  }

  /** "nothing" or "failed", or who was refunded and how much. */
  private async refundMember(
    poolId: string,
    chainPoolId: bigint,
    address: string,
  ): Promise<"nothing" | "failed" | { userId: string | null; amount: bigint }> {
    try {
      const member = await this.contract.getMember(chainPoolId, address);
      if (!member || member.refunded || member.contributed === 0n) return "nothing";

      // A PoolFi wallet sends its own refund, so refunds go out side by side; others use the sponsor.
      const owner = await this.wallets.ownerOf(address);
      const caller = owner ? await this.wallets.keypair(owner) : this.chain.sponsor;
      const { amount, txHash } = await this.contract.claimRefund(caller, chainPoolId, address);
      await this.db.query(
        `insert into refunds (pool_id, wallet_address, user_id, amount, tx_hash) values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [poolId, address, owner, amount.toString(), txHash],
      );
      this.log.info({ poolId, address, amount: formatUsdc(amount), txHash }, "refunded contributor");
      return { userId: owner, amount };
    } catch (error) {
      const mapped = toApiError(error, this.contracts);
      // Someone else refunded them first.
      if (mapped instanceof ApiError && mapped.code === "nothing_to_refund") return "nothing";
      this.log.warn({ poolId, address, error: String(error) }, "refund failed; it will be retried");
      return "failed";
    }
  }

  /** One line in the pool's activity once everyone is refunded. */
  private async noteRefunded(poolId: string) {
    await this.db.query(
      `insert into activity (pool_id, kind, amount)
       select $1::uuid, 'refund', sum(amount) from refunds where pool_id = $1::uuid having sum(amount) > 0
         and not exists (select 1 from activity where pool_id = $1::uuid and kind = 'refund')`,
      [poolId],
    );
  }

  private async finish(poolId: string) {
    await this.db.query("update pools set refunds_finished_at = now() where id = $1", [poolId]);
  }
}

async function mapConcurrently<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
