import { z } from "zod";
import type { InviteView, PaymentResult, PoolDetail, PoolRecord } from "../../api-types.ts";
import type { AuthUser } from "../../auth.ts";
import type { Db, Queryable } from "../../db.ts";
import { ApiError } from "../../errors.ts";
import type { Chain } from "../../stellar/chain.ts";
import type { ChainPool, PoolContract } from "../../stellar/pool-contract.ts";
import type { Wallets } from "../wallets.ts";
import {
  approvalsNeeded,
  centsOf,
  centsToBase,
  codeSuffix,
  feeOn,
  isUuid,
  nameOf,
  newPoolCode,
  POOL_TYPES,
  shareCents,
  toUsdc,
  UsdcInput,
  type PersonRow,
} from "./common.ts";
import type { Notifications, ReminderRecipient } from "./notifications.ts";
import type { AppPoolRow, DiverRow, PoolViews } from "./pool-views.ts";

/** Deadlines closer than this are rejected, so ledger clock drift can't make them already past. */
const MIN_DEADLINE_LEAD_MS = 60_000;
/** A payment that hasn't finished after this long has failed; its name can be picked again. */
const PAYING_HOLD = "5 minutes";
/** Someone on the list is emailed a reminder at most this often. */
const REMINDER_GAP = "12 hours";
/** Tries at a pool code before giving up (codes rarely collide). */
const CODE_ATTEMPTS = 5;

const NewDiverInput = z.object({
  name: z.string().trim().min(1).max(80),
  contact: z.string().trim().max(120).default(""),
});

export const CreatePoolInput = z.object({
  type: z.enum(POOL_TYPES),
  emoji: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(120),
  amount: UsdcInput,
  feeCoveredByDivers: z.boolean(),
  expectedCount: z.number().int().min(1).max(100_000),
  deadline: z.iso.datetime({ offset: true }),
  approverIds: z.array(z.string().min(1).max(200)).max(10),
  members: z.array(NewDiverInput).max(1000),
  pickYourName: z.boolean(),
  allowNotOnList: z.boolean(),
  diversCanShare: z.boolean(),
  /** Divers see each other's payments. Off: each sees only their own, and the totals. */
  diversSeePayments: z.boolean().default(false),
});

export const PoolSettingsInput = z.object({ diversSeePayments: z.boolean() });

export const AddDiversInput = z.object({ divers: z.array(NewDiverInput).min(1).max(1000) });
export const PayoutInput = z.object({ destination: z.enum(["wallet", "bank"]) });
export const DeclineInput = z.object({ reason: z.string().trim().min(1).max(300) });
export const PayInput = z.union([
  z.object({ diverId: z.string().min(1) }),
  z.object({ name: z.string().trim().min(1).max(80) }),
]);

/** A diver picked or added for a payment, and how to undo that if the payment fails. */
interface Held {
  diver: DiverRow;
  /** True when the row was made for this payment (a name not on the list). */
  created: boolean;
  previousUserId: string | null;
}

/**
 * What the web app does with pools: creating them, the member list, paying a
 * share by invite link, and payouts (approved by the pool's approvers, if it
 * has any). Money moves in the contract; this keeps the details around it.
 */
export class AppPools {
  private readonly contracts: { pool: string; usdc: string };

  constructor(
    private readonly db: Db,
    private readonly chain: Chain,
    private readonly contract: PoolContract,
    private readonly wallets: Wallets,
    private readonly views: PoolViews,
    private readonly notify: Notifications,
  ) {
    this.contracts = { pool: chain.poolContractId, usdc: chain.usdcContractId };
  }

  async create(user: AuthUser, input: z.infer<typeof CreatePoolInput>): Promise<PoolDetail> {
    const deadline = new Date(input.deadline);
    if (deadline.getTime() < Date.now() + MIN_DEADLINE_LEAD_MS) {
      throw new ApiError(400, "invalid_deadline", "The deadline must be at least a minute from now.");
    }
    const approverIds = [...new Set(input.approverIds)];
    if (approverIds.length !== input.approverIds.length || approverIds.includes(user.id)) {
      throw new ApiError(400, "invalid_approvers", "Pick up to 10 different approvers, not including yourself.");
    }
    const approvers = await this.approverAddresses(approverIds);

    await this.wallets.ensureUser(user);
    const bps = await this.views.feeBps(true);
    const share = centsToBase(shareCents(centsOf(input.amount), bps, input.feeCoveredByDivers));
    const expected = Math.max(input.expectedCount, input.members.length, 1);
    const goal = share * BigInt(expected);

    const keypair = await this.wallets.keypair(user.id);
    const { chainPoolId, txHash } = await this.views.onChain(() =>
      approvers.length > 0
        ? this.contract.createPoolWithApprovers(keypair, goal, deadline, approvers)
        : this.contract.createPool(keypair, goal, deadline),
    );
    const lifeguard = (await this.views.people([user.id])).get(user.id);

    for (let attempt = 1; ; attempt++) {
      try {
        const row = await this.db.transaction(async (client) => {
          const { rows } = await client.query<AppPoolRow>(
            `insert into pools (contract_id, chain_pool_id, admin_user_id, name, goal_amount, deadline, create_tx_hash,
               code, emoji, type, share_amount, expected_count, fee_bps, fee_covered, pick_your_name, allow_not_on_list,
               divers_can_share, divers_see_payments)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning *`,
            [
              this.contracts.pool,
              chainPoolId.toString(),
              user.id,
              input.name,
              goal.toString(),
              deadline,
              txHash,
              newPoolCode(),
              input.emoji,
              input.type,
              share.toString(),
              expected,
              bps,
              input.feeCoveredByDivers,
              input.pickYourName,
              input.allowNotOnList,
              input.diversCanShare,
              input.diversSeePayments,
            ],
          );
          const pool = rows[0];
          if (!pool) throw new Error(`Pool ${chainPoolId} (tx ${txHash}) was not saved`);
          await client.query(
            `insert into pool_approvers (pool_id, user_id, position)
             select $1, t.id, t.i from unnest($2::text[]) with ordinality as t(id, i)`,
            [pool.id, approverIds],
          );
          await insertDivers(client, pool.id, input.members);
          await client.query(
            "insert into activity (pool_id, kind, actor_user_id, actor_name) values ($1, 'created', $2, $3)",
            [pool.id, user.id, nameOf(lifeguard)],
          );
          return pool;
        });
        return this.views.detail(row, user.id);
      } catch (error) {
        // Another pool got the same code first; the contract pool is made, so just pick another code.
        if (attempt < CODE_ATTEMPTS && isUniqueViolation(error, "pools_code_key")) continue;
        throw error;
      }
    }
  }

  /** The contract's payout fee, for the create screen's preview. */
  async feeBps(): Promise<number> {
    return this.views.feeBps();
  }

  async get(user: AuthUser, poolId: string): Promise<PoolDetail> {
    const { row } = await this.views.forViewer(poolId, user.id);
    return this.views.detail(row, user.id);
  }

  async list(user: AuthUser) {
    return (await this.views.summaries(await this.views.visible(user.id), user.id)).map((b) => b.summary);
  }

  /** The lifeguard changes who can see what: whether divers see each other's payments. */
  async updateSettings(user: AuthUser, poolId: string, input: z.infer<typeof PoolSettingsInput>): Promise<PoolDetail> {
    const row = await this.lifeguardsPool(user, poolId, "Only the lifeguard can change the pool's settings.");
    const [updated] = await this.db.query<AppPoolRow>(
      "update pools set divers_see_payments = $2 where id = $1 returning *",
      [row.id, input.diversSeePayments],
    );
    return this.views.detail(updated ?? row, user.id);
  }

  async addDivers(user: AuthUser, poolId: string, input: z.infer<typeof AddDiversInput>): Promise<PoolDetail> {
    const row = await this.lifeguardsPool(user, poolId, "Only the lifeguard can add people.");
    const status = (await this.views.state(row)).status;
    if (status === "settled" || status === "refunded") throw new ApiError(409, "pool_closed", "This pool is closed.");
    await this.db.transaction(async (client) => {
      await insertDivers(client, row.id, input.divers);
      // The goal stays as the contract has it; the count follows the list.
      await client.query(
        `update pools set expected_count = greatest(expected_count, (select count(*) from pool_divers where pool_id = $1))
         where id = $1`,
        [row.id],
      );
    });
    return this.views.detail(await this.views.byId(row.id), user.id);
  }

  /**
   * Marks everyone unpaid as reminded, emails those whose contact is an email
   * address (once every 12 hours at most), and returns the message for the
   * lifeguard to send the rest.
   */
  async remindUnpaid(user: AuthUser, poolId: string, appUrl: string): Promise<{ count: number; emailed: number; message: string }> {
    const row = await this.lifeguardsPool(user, poolId, "Only the lifeguard can send reminders.");
    const { count, recipients } = await this.db.transaction(async (client) => {
      const { rows: recipients } = await client.query<ReminderRecipient>(
        `select d.id as "diverId", d.name, d.contact as email from pool_divers d
         where d.pool_id = $1 and d.contact ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
           and (d.last_reminded_at is null or d.last_reminded_at < now() - $2::interval)
           and not exists (select 1 from contributions c where c.diver_id = d.id)
         order by d.seq`,
        [row.id, REMINDER_GAP],
      );
      const { rowCount } = await client.query(
        `update pool_divers d set last_reminded_at = now()
         where d.pool_id = $1 and not exists (select 1 from contributions c where c.diver_id = d.id)`,
        [row.id],
      );
      const reminded = rowCount ?? 0;
      if (reminded > 0) {
        const lifeguard = (await this.views.people([user.id])).get(user.id);
        await client.query(
          "insert into activity (pool_id, kind, actor_user_id, actor_name, data) values ($1, 'reminder', $2, $3, $4)",
          [row.id, user.id, nameOf(lifeguard), JSON.stringify({ count: reminded })],
        );
      }
      return { count: reminded, recipients };
    });
    const emailed = await this.notify.reminders(row, recipients, appUrl);
    const link = `${appUrl.replace(/\/$/, "")}/p/${row.code}`;
    return {
      count,
      emailed,
      message: `Reminder 👋 If you haven't paid your ${toUsdc(row.share_amount).toFixed(2)} USDC for ${row.name} yet, here's the link: ${link}`,
    };
  }

  /** The pool's statement: everyone on the list and what they paid. */
  async record(user: AuthUser, poolId: string): Promise<PoolRecord> {
    const { row } = await this.views.forViewer(poolId, user.id);
    const pool = await this.views.detail(row, user.id);
    const refunded = pool.status === "refunded";
    return {
      pool,
      reference: pool.payout?.paidAt && pool.payout.reference ? pool.payout.reference : `PF-${codeSuffix(row.code)}-REC`,
      rows: pool.divers.map((d, i) => ({
        index: i + 1,
        name: d.name,
        contact: d.contact,
        paidAt: d.paidAt,
        amount: d.amount,
        status: d.paid ? (refunded ? "refunded" : "paid") : "not_paid",
      })),
    };
  }

  /** What anyone with the invite link sees. */
  async invite(code: string): Promise<InviteView> {
    const row = await this.views.byCode(code);
    const [[built], people, divers, [approvers]] = await Promise.all([
      this.views.summaries([row], null),
      this.views.people([row.admin_user_id]),
      row.pick_your_name ? this.views.divers(row.id) : Promise.resolve([]),
      this.db.query<{ count: number }>("select count(*)::int as count from pool_approvers where pool_id = $1", [row.id]),
    ]);
    if (!built) throw new ApiError(404, "pool_not_found", "This invite link doesn't match any pool.");
    const { summary } = built;
    const lifeguard = people.get(row.admin_user_id);
    return {
      pool: {
        id: row.id,
        code: row.code,
        emoji: row.emoji,
        name: row.name,
        share: summary.share,
        deadline: summary.deadline,
        status: summary.status,
        paidCount: summary.paidCount,
        expectedCount: summary.expectedCount,
        progress: summary.progress,
        approverCount: approvers?.count ?? 0,
        pickYourName: row.pick_your_name,
        allowNotOnList: row.allow_not_on_list,
      },
      lifeguard: { name: nameOf(lifeguard), avatar: lifeguard?.avatar ?? null },
      // Names only: contacts are never shown on the public page, nor who has paid
      // unless the lifeguard lets divers see payments.
      names: divers.map((d) => ({ id: d.id, name: d.name, paid: row.divers_see_payments && d.paid_at !== null })),
    };
  }

  /** Pays the user's share from their wallet, as a name on the list or a new one. */
  async payShare(user: AuthUser, code: string, as: z.infer<typeof PayInput>, appUrl: string): Promise<PaymentResult> {
    const row = await this.views.byCode(code);
    const wallet = await this.wallets.ensureUser(user);
    const state = await this.views.state(row);
    ensureAcceptingPayments(state);

    const [already] = await this.db.query<{ name: string }>(
      `select d.name from pool_divers d join contributions c on c.diver_id = d.id
       where d.pool_id = $1 and d.user_id = $2`,
      [row.id, user.id],
    );
    if (already) throw new ApiError(409, "already_paid", `You've already paid into this pool as ${already.name}.`);

    const share = BigInt(row.share_amount);
    const held = await this.hold(row, user, as);
    let txHash: string;
    try {
      const balance = (await this.chain.usdcBalance(wallet.address)) ?? 0n;
      if (balance < share) {
        throw new ApiError(400, "insufficient_funds", "Your PoolFi wallet doesn't have enough USDC.", {
          balance: toUsdc(balance),
          needed: toUsdc(share),
        });
      }
      const keypair = await this.wallets.keypair(user.id);
      txHash = await this.views.onChain(() => this.contract.contribute(keypair, BigInt(row.chain_pool_id), share));
    } catch (error) {
      await this.release(held);
      throw error;
    }

    const result = await this.db.transaction(async (client) => {
      // One payment at a time per pool here, so receipt numbers and "goal met" come out right.
      await client.query("select id from pools where id = $1 for update", [row.id]);
      const { rows: counted } = await client.query<{ receipts: number; total: string }>(
        `select count(receipt_ref)::int as receipts, coalesce(sum(amount), 0)::text as total
         from contributions where pool_id = $1`,
        [row.id],
      );
      const before = BigInt(counted[0]?.total ?? "0");
      const receiptRef = `PF-R-${codeSuffix(row.code)}-${String((counted[0]?.receipts ?? 0) + 1).padStart(4, "0")}`;

      await client.query("update pool_divers set paying_at = null where id = $1", [held.diver.id]);
      await client.query(
        `insert into pool_members (pool_id, user_id, join_tx_hash) values ($1, $2, $3) on conflict do nothing`,
        [row.id, user.id, txHash],
      );
      await client.query(
        `insert into contributions (pool_id, user_id, amount, tx_hash, diver_id, receipt_ref)
         values ($1, $2, $3, $4, $5, $6)`,
        [row.id, user.id, share.toString(), txHash, held.diver.id, receiptRef],
      );
      await client.query(
        "insert into activity (pool_id, kind, actor_user_id, actor_name, amount) values ($1, 'payment', $2, $3, $4)",
        [row.id, user.id, held.diver.name, share.toString()],
      );
      const goal = BigInt(row.goal_amount);
      const reachedGoal = before < goal && before + share >= goal;
      if (reachedGoal) {
        await client.query("insert into activity (pool_id, kind, amount) values ($1, 'goal_met', $2)", [
          row.id,
          (before + share).toString(),
        ]);
      }
      const { rows: streak } = await client.query<{ pools: number }>(
        "select count(distinct pool_id)::int as pools from contributions where user_id = $1",
        [user.id],
      );
      return { receiptRef, streak: streak[0]?.pools ?? 1, goalReachedWith: reachedGoal ? before + share : null };
    });
    await this.notify.paid(
      row,
      { payerId: user.id, diverName: held.diver.name, amount: share, receiptRef: result.receiptRef, goalReachedWith: result.goalReachedWith },
      appUrl,
    );

    const now = Date.now();
    const created = row.created_at.getTime();
    const early = now - created < (row.deadline.getTime() - created) * 0.25;
    return {
      receiptRef: result.receiptRef,
      amount: toUsdc(share),
      poolId: row.id,
      badges: [...(result.streak >= 2 ? [`🔥 ${result.streak}-pool streak`] : []), ...(early ? ["⚡ Early diver badge"] : [])],
    };
  }

  /**
   * The lifeguard asks for the payout. With approvers, it waits for a majority of
   * them; without, the pool pays out now. Bank payouts aren't available yet.
   */
  async requestPayout(user: AuthUser, poolId: string, destination: "wallet" | "bank", appUrl: string): Promise<PoolDetail> {
    const row = await this.lifeguardsPool(user, poolId, "Only this pool's lifeguard can request the payout.");
    if (destination === "bank") {
      throw new ApiError(400, "coming_soon", "Bank payouts are coming soon. Choose your PoolFi wallet for now.");
    }
    const state = await this.views.state(row);
    if (state.status === "open") throw new ApiError(409, "goal_not_reached", "This pool hasn't reached its goal yet.");
    if (state.status === "settled") throw new ApiError(409, "already_paid_out", "This pool has already been paid out.");
    if (state.status === "refunded") {
      throw new ApiError(409, "pool_refunded", "This pool missed its goal, so its USDC goes back to the divers.");
    }
    await this.wallets.ensureUser(user);
    const keypair = await this.wallets.keypair(user.id);

    if (state.approvers.length > 0) {
      // Already waiting (a retry, or a request saved on-chain but not here): nothing more to send.
      if (!state.payoutApprovals) {
        const txHash = await this.views.onChain(() => this.contract.requestPayout(keypair, BigInt(row.chain_pool_id)));
        const request = await this.saveRequest(row, state, txHash);
        await this.notify.approvalNeeded(
          row,
          { requestId: request.id, gross: state.totalContributed, needed: approvalsNeeded(state.approvers.length) },
          appUrl,
        );
      } else {
        await this.openRequest(row, state);
      }
      return this.views.detail(row, user.id);
    }

    const gross = state.totalContributed;
    const { amount: net, txHash } = await this.views.onChain(() => this.contract.settle(keypair, BigInt(row.chain_pool_id)));
    await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into payout_requests (pool_id, requested_by, destination, approvals_needed, request_tx_hash)
         values ($1, $2, 'wallet', 0, $3) returning id`,
        [row.id, user.id, txHash],
      );
      await this.recordPaid(client, row, rows[0]?.id ?? "", gross, net, txHash);
    });
    await this.notify.paidOut(row, { gross, net, reference: payoutReference(row) }, appUrl);
    return this.views.detail(row, user.id);
  }

  /** An approver agrees to the waiting payout; the last approval needed pays it out. */
  async approvePayout(user: AuthUser, poolId: string, appUrl: string): Promise<PoolDetail> {
    const row = await this.approversPool(user, poolId);
    const state = await this.views.state(row);
    const request = await this.openRequest(row, state);
    await this.wallets.ensureUser(user);
    const keypair = await this.wallets.keypair(user.id);
    const bps = await this.views.feeBps(true);
    const gross = state.totalContributed;

    const { paid, txHash } = await this.views.onChain(() => this.contract.approvePayout(keypair, BigInt(row.chain_pool_id)));
    const approver = (await this.views.people([user.id])).get(user.id);
    await this.db.transaction(async (client) => {
      await client.query(
        "insert into payout_votes (request_id, user_id, vote, tx_hash) values ($1, $2, 'approved', $3) on conflict do nothing",
        [request.id, user.id, txHash],
      );
      await client.query(
        "insert into activity (pool_id, kind, actor_user_id, actor_name, data) values ($1, 'approval', $2, $3, $4)",
        [row.id, user.id, nameOf(approver), JSON.stringify({ vote: "approved" })],
      );
      if (paid) await this.recordPaid(client, row, request.id, gross, gross - feeOn(gross, bps), txHash);
    });
    if (paid) {
      await this.notify.paidOut(row, { gross, net: gross - feeOn(gross, bps), reference: payoutReference(row) }, appUrl);
    } else {
      const [count] = await this.db.query<{ approvals: number }>(
        "select count(*)::int as approvals from payout_votes where request_id = $1 and vote = 'approved'",
        [request.id],
      );
      await this.notify.approvalGiven(row, {
        approverName: nameOf(approver),
        approvals: count?.approvals ?? 1,
        needed: approvalsNeeded(state.approvers.length),
      });
    }
    return this.views.detail(row, user.id);
  }

  /** An approver turns the payout down. The money stays in the pool; the lifeguard can ask again. */
  async declinePayout(user: AuthUser, poolId: string, reason: string, appUrl: string): Promise<PoolDetail> {
    const row = await this.approversPool(user, poolId);
    const state = await this.views.state(row);
    const request = await this.openRequest(row, state);
    await this.wallets.ensureUser(user);
    const keypair = await this.wallets.keypair(user.id);

    const txHash = await this.views.onChain(() => this.contract.declinePayout(keypair, BigInt(row.chain_pool_id)));
    const approver = (await this.views.people([user.id])).get(user.id);
    await this.db.transaction(async (client) => {
      await client.query(
        "insert into payout_votes (request_id, user_id, vote, tx_hash) values ($1, $2, 'declined', $3) on conflict do nothing",
        [request.id, user.id, txHash],
      );
      await client.query(
        "update payout_requests set declined_by = $2, decline_reason = $3, declined_at = now() where id = $1",
        [request.id, user.id, reason],
      );
      await client.query(
        "insert into activity (pool_id, kind, actor_user_id, actor_name, data) values ($1, 'approval', $2, $3, $4)",
        [row.id, user.id, nameOf(approver), JSON.stringify({ vote: "declined", reason })],
      );
    });
    await this.notify.declined(row, { requestId: request.id, approverName: nameOf(approver), reason }, appUrl);
    return this.views.detail(row, user.id);
  }

  /** Wallet addresses for approver user ids, in the order given. Approvers need an active wallet. */
  private async approverAddresses(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.query<{ user_id: string; public_key: string }>(
      "select user_id, public_key from wallets where user_id = any($1::text[]) and activated_at is not null",
      [ids],
    );
    const byUser = new Map(rows.map((r) => [r.user_id, r.public_key]));
    const addresses = ids.map((id) => byUser.get(id));
    if (addresses.some((a) => a === undefined)) {
      throw new ApiError(400, "invalid_approvers", "Some of the approvers you picked can't approve yet. Pick people from your contacts.");
    }
    return addresses as string[];
  }

  /**
   * Picks the diver this payment is for and holds them, so no one else pays as
   * them until it finishes. Undone by `release` if the payment fails.
   */
  private async hold(row: AppPoolRow, user: AuthUser, as: z.infer<typeof PayInput>): Promise<Held> {
    let diverId: string | null = null;
    if ("diverId" in as) {
      if (!row.pick_your_name || !isUuid(as.diverId)) throw new ApiError(404, "not_on_list", "That name isn't on the list.");
      diverId = as.diverId;
    } else if (!row.pick_your_name) {
      // Everyone types their name: match it to the lifeguard's list if it's there.
      const [match] = await this.db.query<{ id: string }>(
        `select d.id from pool_divers d
         where d.pool_id = $1 and d.on_list and lower(d.name) = lower($2) and (d.user_id is null or d.user_id = $3)
           and not exists (select 1 from contributions c where c.diver_id = d.id)
         order by d.seq limit 1`,
        [row.id, as.name, user.id],
      );
      diverId = match?.id ?? null;
    } else if (!row.allow_not_on_list) {
      throw new ApiError(403, "not_on_list", "Only people on the list can pay into this pool.");
    }

    // Let go of any earlier attempt of this user's that never finished.
    await this.db.query(
      `delete from pool_divers d where d.pool_id = $1 and d.user_id = $2 and not d.on_list and d.id is distinct from $3
         and (d.paying_at is null or d.paying_at < now() - $4::interval)
         and not exists (select 1 from contributions c where c.diver_id = d.id)`,
      [row.id, user.id, diverId, PAYING_HOLD],
    );
    await this.db.query(
      `update pool_divers d set user_id = null, paying_at = null
       where d.pool_id = $1 and d.user_id = $2 and d.on_list and d.id is distinct from $3
         and (d.paying_at is null or d.paying_at < now() - $4::interval)
         and not exists (select 1 from contributions c where c.diver_id = d.id)`,
      [row.id, user.id, diverId, PAYING_HOLD],
    );

    const inProgress = () =>
      new ApiError(409, "payment_in_progress", "A payment into this pool is already going through for you. Check back in a moment.");

    if (diverId === null) {
      const name = "name" in as ? as.name : "";
      try {
        const [diver] = await this.db.query<DiverRow>(
          `insert into pool_divers (pool_id, name, contact, user_id, on_list, paying_at)
           values ($1, $2, $3, $4, false, now())
           returning *, null::numeric as paid_amount, null::timestamptz as paid_at, null::text as receipt_ref`,
          [row.id, name, user.phone ?? user.email, user.id],
        );
        if (!diver) throw new Error("Diver was not saved");
        return { diver, created: true, previousUserId: null };
      } catch (error) {
        if (isUniqueViolation(error, "pool_divers_pool_user_idx")) throw inProgress();
        throw error;
      }
    }

    const [before] = await this.db.query<DiverRow>(
      `select d.*, c.amount as paid_amount, c.created_at as paid_at, c.receipt_ref
       from pool_divers d left join contributions c on c.diver_id = d.id where d.id = $1 and d.pool_id = $2`,
      [diverId, row.id],
    );
    if (!before) throw new ApiError(404, "not_on_list", "That name isn't on the list.");
    if (before.paid_at) throw new ApiError(409, "already_paid", `${before.name} has already paid.`);
    try {
      const [diver] = await this.db.query<DiverRow>(
        `update pool_divers d set user_id = $3, paying_at = now()
         where d.id = $1 and d.pool_id = $2 and (d.user_id is null or d.user_id = $3)
           and (d.paying_at is null or d.paying_at < now() - $4::interval)
           and not exists (select 1 from contributions c where c.diver_id = d.id)
         returning d.*, null::numeric as paid_amount, null::timestamptz as paid_at, null::text as receipt_ref`,
        [diverId, row.id, user.id, PAYING_HOLD],
      );
      if (!diver) throw new ApiError(409, "name_taken", `Someone else is paying as ${before.name}. Pick your own name.`);
      return { diver, created: false, previousUserId: before.user_id };
    } catch (error) {
      if (isUniqueViolation(error, "pool_divers_pool_user_idx")) throw inProgress();
      throw error;
    }
  }

  private async release(held: Held): Promise<void> {
    if (held.created) {
      await this.db.query("delete from pool_divers where id = $1", [held.diver.id]);
    } else {
      await this.db.query("update pool_divers set user_id = $2, paying_at = null where id = $1", [
        held.diver.id,
        held.previousUserId,
      ]);
    }
  }

  private async saveRequest(row: AppPoolRow, state: ChainPool, txHash: string | null): Promise<{ id: string }> {
    const [request] = await this.db.query<{ id: string }>(
      `insert into payout_requests (pool_id, requested_by, destination, approvals_needed, request_tx_hash)
       values ($1, $2, 'wallet', $3, $4) returning id`,
      [row.id, row.admin_user_id, approvalsNeeded(state.approvers.length), txHash],
    );
    if (!request) throw new Error(`Payout request for pool ${row.id} was not saved`);
    return request;
  }

  /** The payout request waiting for approvers, or 409 if there isn't one. */
  private async openRequest(row: AppPoolRow, state: ChainPool): Promise<{ id: string }> {
    if (state.status !== "funded" || !state.payoutApprovals) {
      throw new ApiError(409, "no_payout_request", "There's no payout waiting for approval.");
    }
    const [open] = await this.db.query<{ id: string }>(
      "select id from payout_requests where pool_id = $1 and paid_at is null and declined_at is null",
      [row.id],
    );
    // The contract has a request this database missed (the save after it failed): record it now.
    return open ?? this.saveRequest(row, state, null);
  }

  /** Saves a payout that happened: the amounts, the lifeguard's incoming USDC and the activity line. */
  private async recordPaid(client: Queryable, row: AppPoolRow, requestId: string, gross: bigint, net: bigint, txHash: string) {
    await client.query(
      `update payout_requests set paid_at = now(), paid_tx_hash = $2, gross = $3, fee = $4, net = $5, reference = $6
       where id = $1`,
      [requestId, txHash, gross.toString(), (gross - net).toString(), net.toString(), payoutReference(row)],
    );
    await client.query(
      "insert into withdrawals (pool_id, user_id, amount, tx_hash) values ($1, $2, $3, $4) on conflict do nothing",
      [row.id, row.admin_user_id, net.toString(), txHash],
    );
    const { rows } = await client.query<PersonRow>("select * from users where id = $1", [row.admin_user_id]);
    await client.query(
      "insert into activity (pool_id, kind, actor_user_id, actor_name, amount) values ($1, 'payout', $2, $3, $4)",
      [row.id, row.admin_user_id, nameOf(rows[0]), net.toString()],
    );
  }

  private async lifeguardsPool(user: AuthUser, poolId: string, message: string): Promise<AppPoolRow> {
    const row = await this.views.byId(poolId);
    if (row.admin_user_id !== user.id) {
      // Don't confirm the pool exists to people who aren't in it.
      if (!(await this.views.roleOf(row, user.id))) throw new ApiError(404, "pool_not_found", "Pool not found.");
      throw new ApiError(403, "not_pool_admin", message);
    }
    return row;
  }

  private async approversPool(user: AuthUser, poolId: string): Promise<AppPoolRow> {
    const { row, role } = await this.views.forViewer(poolId, user.id);
    if (role !== "approver") throw new ApiError(403, "not_approver", "You're not an approver for this payout.");
    return row;
  }
}

async function insertDivers(client: Queryable, poolId: string, divers: { name: string; contact: string }[]) {
  if (divers.length === 0) return;
  await client.query(
    `insert into pool_divers (pool_id, name, contact)
     select $1, t.name, nullif(t.contact, '') from unnest($2::text[], $3::text[]) with ordinality as t(name, contact, i)
     order by t.i`,
    [poolId, divers.map((d) => d.name), divers.map((d) => d.contact)],
  );
}

/** The payout's statement reference, e.g. PF-ST-7K2Q. */
function payoutReference(row: AppPoolRow): string {
  return `PF-ST-${codeSuffix(row.code)}`;
}

function ensureAcceptingPayments(state: ChainPool) {
  if (state.status === "settled" || state.status === "refunded") {
    throw new ApiError(409, "pool_closed", "This pool is closed.");
  }
  if (state.payoutApprovals) {
    throw new ApiError(409, "payout_pending", "Payments are paused while the payout waits for approval.");
  }
  if (state.deadline.getTime() <= Date.now()) {
    throw new ApiError(409, "deadline_passed", "This pool's deadline has passed.");
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: string; constraint?: string };
  return e?.code === "23505" && e.constraint === constraint;
}
