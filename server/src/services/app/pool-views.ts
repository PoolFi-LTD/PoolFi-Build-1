import type { ActivityItem, Approver, Diver, PoolDetail, PoolSummary, PoolType, Role } from "../../api-types.ts";
import type { Db } from "../../db.ts";
import { ApiError } from "../../errors.ts";
import type { ChainPool, PoolContract } from "../../stellar/pool-contract.ts";
import { toApiError } from "../chain-errors.ts";
import {
  approvalsNeeded,
  feeOn,
  isUuid,
  mapLimit,
  nameOf,
  notFound,
  statusOf,
  toUsdc,
  type PersonRow,
} from "./common.ts";

/** A pool's row with the app's details (migration 003). */
export interface AppPoolRow {
  id: string;
  contract_id: string;
  chain_pool_id: string;
  admin_user_id: string;
  name: string;
  description: string | null;
  goal_amount: string;
  deadline: Date;
  create_tx_hash: string;
  created_at: Date;
  refunds_finished_at: Date | null;
  code: string;
  emoji: string;
  type: PoolType;
  share_amount: string;
  expected_count: number;
  fee_bps: number;
  fee_covered: boolean;
  pick_your_name: boolean;
  allow_not_on_list: boolean;
  divers_can_share: boolean;
  /** Divers see each other's payments; otherwise only their own and the totals. */
  divers_see_payments: boolean;
}

export interface DiverRow {
  id: string;
  pool_id: string;
  name: string;
  contact: string | null;
  user_id: string | null;
  on_list: boolean;
  last_reminded_at: Date | null;
  paid_amount: string | null;
  paid_at: Date | null;
  receipt_ref: string | null;
}

export interface PayoutRequestRow {
  id: string;
  pool_id: string;
  requested_by: string;
  destination: "wallet" | "bank";
  approvals_needed: number;
  requested_at: Date;
  declined_by: string | null;
  decline_reason: string | null;
  declined_at: Date | null;
  paid_at: Date | null;
  paid_tx_hash: string | null;
  gross: string | null;
  fee: string | null;
  net: string | null;
  reference: string | null;
}

interface VoteRow {
  user_id: string;
  vote: "approved" | "declined";
  at: Date;
}

interface ActivityRow {
  id: string;
  pool_id: string;
  pool_name: string;
  kind: ActivityItem["kind"];
  actor_user_id: string | null;
  actor_name: string | null;
  amount: string | null;
  data: { count?: number; vote?: "approved" | "declined"; reason?: string };
  at: Date;
}

interface ViewerRow {
  id: string;
  approver: boolean;
  diver: boolean;
  paid_count: number;
  you_paid: boolean;
}

/** A pool as the screens list it, with what it was built from. */
export interface BuiltPool {
  row: AppPoolRow;
  state: ChainPool;
  summary: PoolSummary;
}

/** How long the contract's fee is remembered between reads. */
const FEE_CACHE_MS = 60_000;
/** Contract reads at once when listing many pools. */
const READS_AT_ONCE = 8;

/**
 * Builds what the screens show from the database (names, lists, history) and
 * the contract (money and status, which the contract decides).
 */
export class PoolViews {
  private fee: { bps: number; until: number } | null = null;

  constructor(
    private readonly db: Db,
    private readonly contract: PoolContract,
    private readonly contracts: { pool: string; usdc: string },
  ) {}

  /** The contract's payout fee in basis points; `fresh` skips the cache before money moves. */
  async feeBps(fresh = false): Promise<number> {
    if (!fresh && this.fee && this.fee.until > Date.now()) return this.fee.bps;
    const fee = await this.onChain(() => this.contract.fee());
    this.fee = { bps: fee?.bps ?? 0, until: Date.now() + FEE_CACHE_MS };
    return this.fee.bps;
  }

  async byId(poolId: string): Promise<AppPoolRow> {
    if (!isUuid(poolId)) throw notFound();
    const [row] = await this.db.query<AppPoolRow>("select * from pools where id = $1 and contract_id = $2", [
      poolId,
      this.contracts.pool,
    ]);
    if (!row) throw notFound();
    return row;
  }

  async byCode(code: string): Promise<AppPoolRow> {
    const [row] = await this.db.query<AppPoolRow>("select * from pools where code = $1 and contract_id = $2", [
      code.trim().toUpperCase(),
      this.contracts.pool,
    ]);
    if (!row) throw new ApiError(404, "pool_not_found", "This invite link doesn't match any pool.");
    return row;
  }

  /** Pools the user leads, approves or paid into (or is on the list of, once they've paid). */
  async visible(userId: string): Promise<AppPoolRow[]> {
    return this.db.query<AppPoolRow>(
      `select p.* from pools p
       where p.contract_id = $2 and (
         p.admin_user_id = $1
         or exists (select 1 from pool_approvers a where a.pool_id = p.id and a.user_id = $1)
         or exists (select 1 from pool_divers d where d.pool_id = p.id and d.user_id = $1)
         or exists (select 1 from pool_members m where m.pool_id = p.id and m.user_id = $1)
       )
       order by p.deadline desc`,
      [userId, this.contracts.pool],
    );
  }

  /** The user's role in a pool, or null if it isn't theirs to see. */
  async roleOf(row: AppPoolRow, userId: string): Promise<Role | null> {
    if (row.admin_user_id === userId) return "lifeguard";
    const [viewer] = await this.viewers([row.id], userId);
    return viewer?.approver ? "approver" : viewer?.diver ? "diver" : null;
  }

  /** A pool the user can see, or 404 (so pools stay private to the people in them). */
  async forViewer(poolId: string, userId: string): Promise<{ row: AppPoolRow; role: Role }> {
    const row = await this.byId(poolId);
    const role = await this.roleOf(row, userId);
    if (!role) throw notFound();
    return { row, role };
  }

  async state(row: AppPoolRow): Promise<ChainPool> {
    return this.onChain(() => this.contract.getPool(BigInt(row.chain_pool_id)));
  }

  async summaries(rows: AppPoolRow[], viewerId: string | null): Promise<BuiltPool[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [states, viewers, lifeguards] = await Promise.all([
      mapLimit(rows, READS_AT_ONCE, (row) => this.state(row)),
      this.viewers(ids, viewerId),
      this.people(rows.map((r) => r.admin_user_id)),
    ]);
    const byPool = new Map(viewers.map((v) => [v.id, v]));
    return rows.map((row, i) => {
      const state = states[i] as ChainPool;
      const viewer = byPool.get(row.id);
      const role: Role =
        row.admin_user_id === viewerId ? "lifeguard" : viewer?.approver ? "approver" : "diver";
      // The money totals are for the lifeguard (and approvers, who approve the payout); divers see progress.
      const totals = role !== "diver";
      const progress =
        state.goalAmount > 0n ? Math.min(100, Number((state.totalContributed * 100n) / state.goalAmount)) : 0;
      return {
        row,
        state,
        summary: {
          id: row.id,
          code: row.code,
          emoji: row.emoji,
          name: row.name,
          type: row.type,
          role,
          status: statusOf(state),
          share: toUsdc(row.share_amount),
          expectedCount: row.expected_count,
          progress,
          goal: totals ? toUsdc(state.goalAmount) : null,
          raised: totals ? toUsdc(state.totalContributed) : null,
          paidCount: viewer?.paid_count ?? 0,
          deadline: row.deadline.toISOString(),
          lifeguard: { id: row.admin_user_id, name: nameOf(lifeguards.get(row.admin_user_id)) },
          youPaid: viewer?.you_paid ?? false,
        },
      };
    });
  }

  async detail(row: AppPoolRow, viewerId: string | null): Promise<PoolDetail> {
    const [[built], divers, approvers, request, activity, mine, bps] = await Promise.all([
      this.summaries([row], viewerId),
      this.divers(row.id),
      this.db.query<PersonRow & { user_id: string }>(
        `select u.*, a.user_id from pool_approvers a join users u on u.id = a.user_id
         where a.pool_id = $1 order by a.position`,
        [row.id],
      ),
      this.latestRequest(row.id),
      viewerId
        ? Promise.all([this.paymentsHiddenIn([row], viewerId), this.diverIn([row], viewerId)]).then(([hidden, diver]) =>
            this.activity([row.id], viewerId, 50, hidden, diver),
          )
        : this.activity([row.id], null, 50, [], [row.id]),
      viewerId ? this.viewerMoney(row.id, viewerId) : null,
      this.feeBps(),
    ]);
    if (!built) throw notFound();
    const { summary, state } = built;
    const isLifeguard = summary.role === "lifeguard";
    // The money totals are for the lifeguard and approvers; divers see progress only.
    const totals = summary.role !== "diver";
    // Unless the lifeguard allows it, a diver sees only their own payment (and the totals).
    const hidePayments = summary.role === "diver" && !row.divers_see_payments;

    const votes = new Map((request?.votes ?? []).map((v) => [v.user_id, v]));
    const approverViews: Approver[] = approvers.map((a) => {
      const vote = votes.get(a.user_id);
      return {
        userId: a.user_id,
        name: nameOf(a),
        ...(a.avatar ? { avatar: a.avatar } : {}),
        status: vote?.vote ?? "waiting",
        at: vote ? vote.at.toISOString() : null,
      };
    });

    let payout: PoolDetail["payout"] = null;
    if (request) {
      const gross = request.gross !== null ? BigInt(request.gross) : state.totalContributed;
      const fee = request.fee !== null ? BigInt(request.fee) : feeOn(gross, bps);
      const net = request.net !== null ? BigInt(request.net) : gross - fee;
      payout = {
        requestedAt: request.requested_at.toISOString(),
        destination: request.destination,
        gross: totals ? toUsdc(gross) : null,
        fee: totals ? toUsdc(fee) : null,
        net: totals ? toUsdc(net) : null,
        approvalsNeeded: request.approvals_needed,
        approvals: request.votes.filter((v) => v.vote === "approved").length,
        paidAt: request.paid_at?.toISOString() ?? null,
        reference: request.reference,
        declinedBy: request.declined_at
          ? { name: request.decliner ?? "An approver", reason: request.decline_reason ?? "" }
          : null,
      };
    }

    const refunded = summary.status === "refunded";
    const closedAt =
      summary.status === "paidout"
        ? (request?.paid_at ?? null)
        : refunded
          ? (row.refunds_finished_at ?? row.deadline)
          : null;

    return {
      ...summary,
      description: row.description,
      createdAt: row.created_at.toISOString(),
      feeBps: bps,
      feeCoveredByDivers: row.fee_covered,
      approvers: approverViews,
      approvalsNeeded: approvalsNeeded(approvers.length),
      payout,
      // Phone numbers and emails are only for the lifeguard.
      divers: divers.filter((d) => !hidePayments || d.user_id === viewerId).map((d) => toDiver(d, isLifeguard)),
      pickYourName: row.pick_your_name,
      allowNotOnList: row.allow_not_on_list,
      diversCanShare: row.divers_can_share,
      diversSeePayments: row.divers_see_payments,
      activity,
      yourRefund: refunded && mine && mine.paid > 0n ? toUsdc(mine.refunded ?? mine.paid) : null,
      yourReceiptRef: mine?.receiptRef ?? null,
      closedAt: closedAt?.toISOString() ?? null,
      // Everything paid into a pool that missed its goal goes back; the refund job sends it.
      totalRefunded: !totals ? null : refunded ? toUsdc(state.totalContributed) : 0,
    };
  }

  async divers(poolId: string): Promise<DiverRow[]> {
    return this.db.query<DiverRow>(
      `select d.*, c.amount as paid_amount, c.created_at as paid_at, c.receipt_ref
       from pool_divers d left join contributions c on c.diver_id = d.id
       where d.pool_id = $1 order by d.seq`,
      [poolId],
    );
  }

  /** The newest payout request, open, declined or paid, with its votes. */
  async latestRequest(poolId: string): Promise<(PayoutRequestRow & { votes: VoteRow[]; decliner: string | null }) | null> {
    const [request] = await this.db.query<PayoutRequestRow & { decliner_first: string | null; decliner_last: string | null }>(
      `select r.*, u.first_name as decliner_first, u.last_name as decliner_last
       from payout_requests r left join users u on u.id = r.declined_by
       where r.pool_id = $1 order by r.requested_at desc limit 1`,
      [poolId],
    );
    if (!request) return null;
    const votes = await this.db.query<VoteRow>(
      "select user_id, vote, at from payout_votes where request_id = $1 order by at",
      [request.id],
    );
    const decliner = request.declined_by
      ? nameOf({ first_name: request.decliner_first, last_name: request.decliner_last })
      : null;
    return { ...request, votes, decliner };
  }

  /**
   * What happened in these pools, newest first, written for `viewerId`. In
   * `hidePaymentsIn` (pools where the viewer is a diver who can't see others'
   * payments) only the viewer's own payments are listed.
   */
  async activity(
    poolIds: string[],
    viewerId: string | null,
    limit: number,
    hidePaymentsIn: string[] = [],
    hideTotalsIn: string[] = [],
  ): Promise<ActivityItem[]> {
    if (poolIds.length === 0) return [];
    const rows = await this.db.query<ActivityRow>(
      `select a.*, p.name as pool_name from activity a join pools p on p.id = a.pool_id
       where a.pool_id = any($1::uuid[])
         and not (a.kind = 'payment' and a.pool_id = any($3::uuid[]) and a.actor_user_id is distinct from $4)
       order by a.at desc, a.id limit $2`,
      [poolIds, limit, hidePaymentsIn, viewerId],
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: activityTitle(row, viewerId),
      at: row.at.toISOString(),
      // Pool totals (goal met, payout, refund) aren't for divers; a payment is one share, which they know.
      amount:
        row.amount === null || (row.kind !== "payment" && hideTotalsIn.includes(row.pool_id)) ? null : toUsdc(row.amount),
      actorName: row.actor_name,
      poolId: row.pool_id,
    }));
  }

  /**
   * Of these pools, those where `viewerId` is a diver (not the lifeguard or an approver)
   * and the lifeguard keeps payments private: there they see only their own.
   */
  async paymentsHiddenIn(rows: AppPoolRow[], viewerId: string): Promise<string[]> {
    return this.diverIn(
      rows.filter((r) => !r.divers_see_payments),
      viewerId,
    );
  }

  /** Of these pools, those where `viewerId` is a diver: not the lifeguard, not an approver. */
  async diverIn(rows: AppPoolRow[], viewerId: string): Promise<string[]> {
    const candidates = rows.filter((r) => r.admin_user_id !== viewerId);
    if (candidates.length === 0) return [];
    const approving = await this.db.query<{ pool_id: string }>(
      "select pool_id from pool_approvers where user_id = $1 and pool_id = any($2::uuid[])",
      [viewerId, candidates.map((r) => r.id)],
    );
    const approver = new Set(approving.map((a) => a.pool_id));
    return candidates.filter((r) => !approver.has(r.id)).map((r) => r.id);
  }

  /** Profiles by user id. */
  async people(ids: string[]): Promise<Map<string, PersonRow>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db.query<PersonRow>("select * from users where id = any($1::text[])", [unique]);
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async viewers(poolIds: string[], viewerId: string | null): Promise<ViewerRow[]> {
    return this.db.query<ViewerRow>(
      `select p.id,
         exists (select 1 from pool_approvers a where a.pool_id = p.id and a.user_id = $2) as approver,
         exists (select 1 from pool_divers d where d.pool_id = p.id and d.user_id = $2)
           or exists (select 1 from pool_members m where m.pool_id = p.id and m.user_id = $2) as diver,
         (select count(*)::int from contributions c where c.pool_id = p.id) as paid_count,
         exists (select 1 from contributions c where c.pool_id = p.id and c.user_id = $2) as you_paid
       from pools p where p.id = any($1::uuid[])`,
      [poolIds, viewerId],
    );
  }

  /** What the viewer paid into a pool, got back from it, and their receipt. */
  private async viewerMoney(poolId: string, userId: string) {
    const [row] = await this.db.query<{ paid: string; refunded: string | null; receipt_ref: string | null }>(
      `select
         (select coalesce(sum(amount), 0)::text from contributions where pool_id = $1 and user_id = $2) as paid,
         (select sum(amount)::text from refunds where pool_id = $1 and user_id = $2) as refunded,
         (select receipt_ref from contributions where pool_id = $1 and user_id = $2 and receipt_ref is not null
          order by created_at limit 1) as receipt_ref`,
      [poolId, userId],
    );
    return {
      paid: BigInt(row?.paid ?? "0"),
      refunded: row?.refunded ? BigInt(row.refunded) : null,
      receiptRef: row?.receipt_ref ?? null,
    };
  }

  async onChain<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw toApiError(error, this.contracts);
    }
  }
}

export function toDiver(row: DiverRow, withContact: boolean): Diver {
  return {
    id: row.id,
    name: row.name,
    contact: withContact ? row.contact : null,
    paid: row.paid_at !== null,
    paidAt: row.paid_at?.toISOString() ?? null,
    amount: toUsdc(row.paid_amount),
    lastRemindedAt: row.last_reminded_at?.toISOString() ?? null,
    onList: row.on_list,
    userId: row.user_id,
    receiptRef: row.receipt_ref,
  };
}

/** The activity line as `viewerId` reads it: "You paid…" for them, "Ada paid…" for everyone else. */
function activityTitle(row: ActivityRow, viewerId: string | null): string {
  const you = viewerId !== null && row.actor_user_id === viewerId;
  const who = you ? "You" : (row.actor_name ?? "Someone");
  const pool = row.pool_name;
  switch (row.kind) {
    case "payment":
      return `${who} paid into ${pool}`;
    case "reminder": {
      const count = row.data.count ?? 0;
      return `${who} reminded ${count} ${count === 1 ? "diver" : "divers"} in ${pool}`;
    }
    case "goal_met":
      return `${pool} reached its goal`;
    case "approval":
      return row.data.vote === "declined"
        ? `${who} declined the payout${row.data.reason ? `: ${row.data.reason}` : ""}`
        : `${who} approved the payout`;
    case "payout":
      return `${pool} paid out to ${you ? "you" : who}`;
    case "refund":
      return `${pool} missed its goal, so everyone who paid got their USDC back`;
    case "joined":
      return `${who} joined ${pool}`;
    case "created":
      return `${who} created ${pool}`;
  }
}
