import type { Db } from "../db.ts";
import type { Notifications } from "./app/notifications.ts";
import { ApiError } from "../errors.ts";
import { formatUsdc } from "../money.ts";
import type { Chain } from "../stellar/chain.ts";
import type { ChainPool, PoolContract } from "../stellar/pool-contract.ts";
import type { AppPoolRow } from "./app/pool-views.ts";
import { toApiError } from "./chain-errors.ts";
import type { Wallets } from "./wallets.ts";

export interface Logger {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

export interface RefundRun {
  poolsChecked: number;
  /** Lifeguards told this run that their pool missed its deadline. */
  lifeguardsAsked: number;
  refunds: number;
  failures: number;
  poolsFinished: number;
}

/** How many expired pools one run looks at; the rest wait for the next run. */
const POOLS_PER_RUN = 100;
/** How long a lifeguard's "refund now" sends refunds itself before leaving the rest to the next run. */
const REFUND_NOW_MS = 60_000;

/**
 * Looks after pools whose deadline passed without reaching the goal. Nothing
 * is refunded by itself: the lifeguard is told once, then chooses to extend
 * the deadline or refund the divers. Once they choose to refund (the contract
 * pool is cancelled), this refunds every contributor. The contract allows
 * anyone to send a refund and always pays it to the contributor, so no one
 * has to sign for it. Safe to run repeatedly and from several servers: each
 * refund is sent once, and a contributor already refunded is skipped.
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
      // Pools whose lifeguard was already asked wait for them, unless they chose to refund.
      const pools = await this.db.query<{ id: string; chain_pool_id: string; deadline: Date }>(
        `select id, chain_pool_id, deadline from pools
         where contract_id = $1 and deadline <= now() and refunds_finished_at is null
           and (missed_notified_at is null or refund_chosen_at is not null)
         order by deadline limit $2`,
        [this.contracts.pool, POOLS_PER_RUN],
      );
      const run: RefundRun = { poolsChecked: pools.length, lifeguardsAsked: 0, refunds: 0, failures: 0, poolsFinished: 0 };
      for (const pool of pools) {
        const result = await this.checkPool(pool.id, BigInt(pool.chain_pool_id), pool.deadline);
        if (result.asked) run.lifeguardsAsked += 1;
        run.refunds += result.refunds;
        run.failures += result.failures;
        if (result.finished) run.poolsFinished += 1;
      }
      if (run.poolsChecked > 0) this.log.info({ ...run }, "refund job run");
      return run;
    });
  }

  /**
   * Sends the refunds of a pool its lifeguard just chose to refund, for up to a
   * minute; the next run sends any left over.
   */
  async refundNow(poolId: string, chainPoolId: bigint) {
    const state = await this.contract.getPool(chainPoolId);
    if (state.status !== "refunded") return { refunds: 0, failures: 0, finished: false };
    return this.refundPool(poolId, chainPoolId, state, Date.now() + REFUND_NOW_MS);
  }

  private async checkPool(poolId: string, chainPoolId: bigint, deadline: Date) {
    const state = await this.contract.getPool(chainPoolId);
    // The goal was met: the pool admin withdraws (or already has); nothing to refund.
    if (state.status === "funded" || state.status === "settled") {
      await this.finish(poolId);
      return { asked: false, refunds: 0, failures: 0, finished: true };
    }
    // The deadline passed below the goal: the lifeguard decides what happens.
    if (state.status === "expired") {
      return { asked: await this.askLifeguard(poolId, state), refunds: 0, failures: 0, finished: false };
    }
    if (state.status === "open") {
      // The lifeguard moved the deadline and this database missed it: catch up.
      if (state.deadline > deadline) {
        await this.db.query("update pools set deadline = $2, missed_notified_at = null where id = $1", [poolId, state.deadline]);
      }
      // Otherwise the ledger clock hasn't reached the deadline yet. Try next run.
      return { asked: false, refunds: 0, failures: 0, finished: false };
    }
    return { asked: false, ...(await this.refundPool(poolId, chainPoolId, state)) };
  }

  /** Tells the lifeguard, once per missed deadline, that the pool needs their decision. */
  private async askLifeguard(poolId: string, state: ChainPool): Promise<boolean> {
    const [row] = await this.db.query<AppPoolRow>(
      "update pools set missed_notified_at = now() where id = $1 and missed_notified_at is null returning *",
      [poolId],
    );
    if (!row) return false;
    await this.db.query("insert into activity (pool_id, kind, amount) values ($1, 'missed', $2)", [
      poolId,
      state.totalContributed.toString(),
    ]);
    await this.notify?.goalMissed(row, { raised: state.totalContributed, goal: state.goalAmount });
    this.log.info({ poolId }, "asked the lifeguard to extend or refund");
    return true;
  }

  /** Refunds a cancelled pool's contributors; with `stopAt`, starts no new refund after then. */
  private async refundPool(poolId: string, chainPoolId: bigint, state: ChainPool, stopAt?: number) {
    const members = await this.contract.getMembers(chainPoolId, state.memberCount);
    // "later": not started, because `stopAt` came first.
    const outcomes = await mapConcurrently(members, this.concurrency, async (address) =>
      stopAt !== undefined && Date.now() > stopAt ? ("later" as const) : this.refundMember(poolId, chainPoolId, address),
    );
    const failures = outcomes.filter((o) => o === "failed").length;
    const finished = failures === 0 && !outcomes.includes("later");
    if (finished) {
      await this.noteRefunded(poolId);
      await this.finish(poolId);
    }
    const refunded = outcomes.flatMap((o) => (typeof o === "object" ? [o] : []));
    await this.notify?.refunded(
      poolId,
      refunded.flatMap((r) => (r.userId ? [{ userId: r.userId, amount: r.amount }] : [])),
    );
    return { refunds: refunded.length, failures, finished };
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
