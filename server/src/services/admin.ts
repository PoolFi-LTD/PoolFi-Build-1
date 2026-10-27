import { Networks } from "@stellar/stellar-sdk";
import { z } from "zod";
import type {
  AdminAction,
  AdminChain,
  AdminContribution,
  AdminDeposit,
  AdminEvent,
  AdminJobRun,
  AdminMoney,
  AdminOverview,
  AdminPayout,
  AdminPerson,
  AdminPoolDetail,
  AdminPoolList,
  AdminPoolRow,
  AdminRefund,
  AdminUserDetail,
  AdminUserList,
  AdminUserRow,
  AdminUserState,
  Avatar,
  PoolStatus,
} from "../api-types.ts";
import type { AuthUser } from "../auth.ts";
import type { Config } from "../config.ts";
import type { Db, Queryable } from "../db.ts";
import { ApiError } from "../errors.ts";
import type { Chain } from "../stellar/chain.ts";
import { nameOf, toUsdc } from "./app/common.ts";
import { activityTitle, toDiver, type ActivityRow, type AppPoolRow, type PoolViews } from "./app/pool-views.ts";
import type { AppPools } from "./app/pools.ts";
import type { RefundJob } from "./refunds.ts";
import type { Wallets } from "./wallets.ts";

export const AdminUserQuery = z.object({
  filter: z.enum(["all", "active", "quiet", "new", "suspended", "locked"]).default("all"),
  q: z.string().trim().max(120).default(""),
});
export const AdminPoolQuery = z.object({
  status: z.enum(["all", "active", "met", "approval", "paidout", "missed", "refunded"]).default("all"),
  q: z.string().trim().max(120).default(""),
});
/** Why the team did something; kept in the admin log. */
export const ReasonInput = z.object({ reason: z.string().trim().min(3).max(300) });
export const AdminExtendInput = z.object({
  deadline: z.iso.datetime({ offset: true }),
  reason: z.string().trim().max(300).default(""),
});

/** Rows a list page shows at most; searching narrows it down. */
const PAGE = 300;
/** Payouts, refunds, contributions and deposits the money page shows of each. */
const MONEY_ROWS = 100;
/** Lines in the front page's activity feed. */
const EVENTS = 60;
/** Days of the front page's growth chart. */
const GROWTH_DAYS = 30;

type Action = AdminAction["action"];
type TargetKind = AdminAction["target"]["kind"];

// When something is stuck. The refund job (every few minutes) normally finishes a
// pool's refunds, and a wallet is put on Stellar when it's made; one still waiting
// after this long needs a person to look at it.
const refundsStuck = (p: string) =>
  `(${p}.refund_chosen_at is not null and ${p}.refunds_finished_at is null and ${p}.refund_chosen_at < now() - interval '15 minutes')`;
const walletStuck = (w: string) => `(${w}.activated_at is null and ${w}.created_at < now() - interval '10 minutes')`;

/**
 * Each pool with its totals and a status worked out from the database (the same
 * statuses the app shows), so listing every pool needs no contract reads. $1 is the
 * pool contract.
 */
const POOLS = `
  with facts as (
    select p.*,
      u.first_name as lg_first, u.last_name as lg_last, u.email as lg_email,
      coalesce((select sum(c.amount) from contributions c where c.pool_id = p.id), 0) as raised,
      (select count(*)::int from contributions c where c.pool_id = p.id) as paid_count,
      (select count(*)::int from pool_approvers a where a.pool_id = p.id) as approver_count,
      coalesce((select sum(f.amount) from refunds f where f.pool_id = p.id), 0) as refunded,
      req.id as req_id, req.approvals_needed as req_needed,
      coalesce(req.paid_at, (select w.created_at from withdrawals w where w.pool_id = p.id)) as req_paid_at,
      (select count(*)::int from payout_votes v where v.request_id = req.id and v.vote = 'approved') as req_approvals
    from pools p
    join users u on u.id = p.admin_user_id
    left join lateral (
      select r.* from payout_requests r where r.pool_id = p.id and r.declined_at is null order by r.requested_at desc limit 1
    ) req on true
    where p.contract_id = $1
  ),
  pool_rows as (
    select *, case
      when req_paid_at is not null then 'paidout'
      when refund_chosen_at is not null then 'refunded'
      when req_id is not null then 'approval'
      when raised >= goal_amount then 'met'
      when deadline <= now() then 'missed'
      else 'active' end as status
    from facts
  )`;

/** Everyone, with what they've done on PoolFi. */
const PEOPLE = `
  with people as (
    select u.*,
      w.public_key as wallet_address, w.activated_at as wallet_activated_at, w.activation_tx_hash,
      (select max(s.last_seen_at) from verified_sessions s where s.user_id = u.id) as last_seen_at,
      (select count(*)::int from pools p where p.admin_user_id = u.id) as created,
      (select count(*)::int from (
         select id as pool_id from pools where admin_user_id = u.id
         union select pool_id from pool_members where user_id = u.id
         union select pool_id from pool_divers where user_id = u.id
         union select pool_id from pool_approvers where user_id = u.id) x) as pool_count,
      (select count(*)::int from contributions c where c.user_id = u.id) as payment_count,
      coalesce((select sum(c.amount) from contributions c where c.user_id = u.id), 0) as paid,
      coalesce((select sum(d.amount) from deposits d where d.user_id = u.id), 0) as deposited,
      coalesce(f.locked_at is not null, false) as locked,
      coalesce(f.failures, 0) as failures,
      exists (select 1 from push_subscriptions ps where ps.user_id = u.id) as push_on
    from users u
    left join wallets w on w.user_id = u.id
    left join sign_in_failures f on f.email = lower(u.email)
  ),
  person_rows as (
    select *, case
      when pool_count = 0 and payment_count = 0 then 'new'
      when coalesce(last_seen_at, created_at) > now() - interval '7 days' then 'active'
      else 'quiet' end as state
    from people
  )`;

interface PoolFactsRow extends AppPoolRow {
  lg_first: string | null;
  lg_last: string | null;
  lg_email: string | null;
  raised: string;
  paid_count: number;
  approver_count: number;
  refunded: string;
  req_id: string | null;
  req_needed: number | null;
  req_paid_at: Date | null;
  req_approvals: number;
  status: PoolStatus;
  total?: string;
}

interface PersonFactsRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  avatar: Avatar | null;
  created_at: Date;
  suspended_at: Date | null;
  suspended_reason: string | null;
  wallet_address: string | null;
  wallet_activated_at: Date | null;
  activation_tx_hash: string | null;
  last_seen_at: Date | null;
  created: number;
  pool_count: number;
  payment_count: number;
  paid: string;
  deposited: string;
  locked: boolean;
  failures: number;
  push_on: boolean;
  state: AdminUserState;
  total?: string;
}

interface NamedRow {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface PoolRef {
  pool_id: string;
  pool_name: string;
  emoji: string;
}

interface ActionRow {
  id: string;
  admin_user_id: string;
  admin_email: string;
  action: Action;
  target_kind: TargetKind;
  target_id: string | null;
  target_label: string | null;
  reason: string | null;
  details: Record<string, unknown>;
  at: Date;
}

/** Which money rows to list: one pool's, one person's, or everyone's. */
interface MoneyScope {
  poolId?: string;
  userId?: string;
}

/**
 * The admin dashboard: what is happening across PoolFi (people, pools and USDC) and
 * the team's fixes, each written to the admin log. Only people on ADMIN_EMAILS get here
 * (admin-routes.ts). Money still only moves by the contract's rules: closing a pool or
 * moving its deadline is signed with the lifeguard's own wallet, and refunds go through
 * the refund job's code.
 */
export class Admin {
  readonly chainInfo: AdminChain;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly chain: Chain,
    private readonly views: PoolViews,
    private readonly pools: AppPools,
    private readonly wallets: Wallets,
    private readonly refunds: RefundJob,
  ) {
    const passphrase = config.stellar.networkPassphrase;
    const network = passphrase === Networks.PUBLIC ? "public" : passphrase === Networks.TESTNET ? "testnet" : null;
    this.chainInfo = {
      network: network === "public" ? "Stellar" : network === "testnet" ? "Stellar testnet" : "Stellar (local)",
      poolContractId: chain.poolContractId,
      explorer: network ? `https://stellar.expert/explorer/${network}` : null,
    };
  }

  /** Whether this signed-in person is on the team's allow-list. */
  isAdmin(user: Pick<AuthUser, "email">): boolean {
    return this.isAdminEmail(user.email);
  }

  private isAdminEmail(email: string | null): boolean {
    return email !== null && this.config.adminEmails.includes(email.trim().toLowerCase());
  }

  private get contract(): string {
    return this.chain.poolContractId;
  }

  // Reading

  async overview(): Promise<AdminOverview> {
    const timeZone = this.config.email?.timeZone ?? "Africa/Lagos";
    const [[k], growth, events] = await Promise.all([
      this.db.query<Record<string, string | number>>(
        `${POOLS}
         select
           (select count(*)::int from users) as users,
           (select count(*)::int from users where created_at > now() - interval '7 days') as users_new,
           (select count(distinct user_id)::int from verified_sessions where last_seen_at > now() - interval '7 days') as users_active,
           (select count(*)::int from pool_rows) as pools,
           (select count(*)::int from pool_rows where status in ('active', 'met', 'approval')) as pools_open,
           (select coalesce(sum(raised), 0) from pool_rows) as collected,
           (select coalesce(sum(paid_count), 0)::int from pool_rows) as payments,
           (select coalesce(sum(amount), 0) from deposits) as deposited,
           (select count(*)::int from deposits) as deposits,
           (select coalesce(sum(raised), 0) from pool_rows where status in ('active', 'met', 'approval', 'missed')) as in_pools,
           (select coalesce(sum(r.net), 0) from payout_requests r join pools p on p.id = r.pool_id where p.contract_id = $1 and r.paid_at is not null)
             + (select coalesce(sum(w.amount), 0) from withdrawals w join pools p on p.id = w.pool_id where p.contract_id = $1) as paid_out,
           (select count(*)::int from pool_rows where status = 'paidout') as payouts,
           (select coalesce(sum(r.fee), 0) from payout_requests r join pools p on p.id = r.pool_id where p.contract_id = $1 and r.paid_at is not null) as fees,
           (select coalesce(sum(refunded), 0) from pool_rows) as refunded,
           (select coalesce(sum(greatest(raised - refunded, 0)), 0) from pool_rows where refund_chosen_at is not null and refunds_finished_at is null) as owed,
           (select count(*)::int from pool_rows p where ${refundsStuck("p")}) as att_refunds,
           (select count(*)::int from wallets w where ${walletStuck("w")}) as att_wallets,
           (select count(*)::int from pool_rows where status = 'missed') as att_missed,
           (select count(*)::int from pool_rows where status = 'approval') as att_approval,
           (select count(*)::int from sign_in_failures where locked_at is not null) as att_locked,
           (select count(*)::int from sign_in_failures where last_failed_at > now() - interval '7 days') as sign_in_failures,
           (select count(*)::int from auth_codes where purpose = 'sign_in' and created_at > now() - interval '7 days') as codes_sent,
           (select count(*)::int from auth_codes where purpose = 'sign_in' and used_at is not null and created_at > now() - interval '7 days') as codes_used,
           (select count(*)::int from users u where not exists (select 1 from pools p where p.admin_user_id = u.id)
              and not exists (select 1 from contributions c where c.user_id = u.id)
              and not exists (select 1 from pool_divers d where d.user_id = u.id)
              and not exists (select 1 from pool_approvers a where a.user_id = u.id)) as signed_up_only,
           (select count(*)::int from wallets w where not exists (select 1 from deposits d where d.user_id = w.user_id)) as never_funded,
           (select count(distinct user_id)::int from push_subscriptions) as push_on`,
        [this.contract],
      ),
      this.db.query<{ day: string; signups: number; users: number; collected: string }>(
        `with days as (
           select generate_series((now() at time zone $1)::date - ($2::int - 1), (now() at time zone $1)::date, interval '1 day')::date as day
         )
         select to_char(d.day, 'YYYY-MM-DD') as day,
           (select count(*)::int from users u where (u.created_at at time zone $1)::date = d.day) as signups,
           (select count(*)::int from users u where (u.created_at at time zone $1)::date <= d.day) as users,
           (select coalesce(sum(c.amount), 0) from contributions c where (c.created_at at time zone $1)::date = d.day) as collected
         from days d order by d.day`,
        [timeZone, GROWTH_DAYS],
      ),
      this.events(),
    ]);
    const n = (key: string) => Number(k?.[key] ?? 0);
    const usdc = (key: string) => toUsdc(String(k?.[key] ?? "0"));
    return {
      generatedAt: new Date().toISOString(),
      chain: this.chainInfo,
      kpis: {
        users: n("users"),
        usersNew7d: n("users_new"),
        activeUsers7d: n("users_active"),
        pools: n("pools"),
        poolsOpen: n("pools_open"),
        collected: usdc("collected"),
        payments: n("payments"),
        deposited: usdc("deposited"),
        deposits: n("deposits"),
        inPools: usdc("in_pools"),
        paidOut: usdc("paid_out"),
        payouts: n("payouts"),
        fees: usdc("fees"),
        refunded: usdc("refunded"),
        owed: usdc("owed"),
      },
      attention: {
        refunds: n("att_refunds"),
        wallets: n("att_wallets"),
        poolsMissed: n("att_missed"),
        payoutsAwaitingApproval: n("att_approval"),
        lockedAccounts: n("att_locked"),
      },
      friction: {
        signInFailures: n("sign_in_failures"),
        codesSent: n("codes_sent"),
        codesUsed: n("codes_used"),
        signedUpOnly: n("signed_up_only"),
        walletsNeverFunded: n("never_funded"),
        pushOn: n("push_on"),
      },
      growth: growth.map((g) => ({ day: g.day, signups: g.signups, users: g.users, collected: toUsdc(g.collected) })),
      events,
    };
  }

  /** The feed: what happened in pools, who signed up or added USDC, and what the team did. */
  private async events(): Promise<AdminEvent[]> {
    const [activity, signups, deposits, actions] = await Promise.all([
      this.db.query<ActivityRow>(
        `select a.*, p.name as pool_name from activity a join pools p on p.id = a.pool_id
         where p.contract_id = $1 order by a.at desc, a.id limit $2`,
        [this.contract, EVENTS],
      ),
      this.db.query<NamedRow & { id: string; created_at: Date }>(
        "select id, first_name, last_name, email, created_at from users order by created_at desc limit $1",
        [EVENTS],
      ),
      this.db.query<NamedRow & { id: string; user_id: string; amount: string; created_at: Date }>(
        `select d.id, d.user_id, d.amount, d.created_at, u.first_name, u.last_name, u.email
         from deposits d join users u on u.id = d.user_id order by d.created_at desc limit $1`,
        [EVENTS],
      ),
      this.actionRows({}, EVENTS),
    ]);
    const all: AdminEvent[] = [
      ...activity.map((a) => ({
        id: `a:${a.id}`,
        kind: a.kind,
        title: activityTitle(a, null),
        at: a.at.toISOString(),
        amount: a.amount === null ? null : toUsdc(a.amount),
        poolId: a.pool_id,
        userId: a.actor_user_id,
      })),
      ...signups.map((u) => ({
        id: `u:${u.id}`,
        kind: "signup" as const,
        title: `${personName(u)} signed up`,
        at: u.created_at.toISOString(),
        amount: null,
        poolId: null,
        userId: u.id,
      })),
      ...deposits.map((d) => ({
        id: `d:${d.id}`,
        kind: "deposit" as const,
        title: `${personName(d)} added USDC to their wallet`,
        at: d.created_at.toISOString(),
        amount: toUsdc(d.amount),
        poolId: null,
        userId: d.user_id,
      })),
      ...actions.map((a) => ({
        id: `x:${a.id}`,
        kind: "admin" as const,
        title: `${a.admin_email} ${actionSentence(a.action, a.target_label)}`,
        at: a.at.toISOString(),
        amount: null,
        poolId: a.target_kind === "pool" ? a.target_id : null,
        userId: a.target_kind === "user" ? a.target_id : null,
      })),
    ];
    return all.sort((x, y) => y.at.localeCompare(x.at)).slice(0, EVENTS);
  }

  async users(query: z.infer<typeof AdminUserQuery>): Promise<AdminUserList> {
    const rows = await this.db.query<PersonFactsRow>(
      `${PEOPLE}
       select *, count(*) over () as total from person_rows
       where ($1 = 'all' or ($1 in ('active', 'quiet', 'new') and state = $1)
           or ($1 = 'suspended' and suspended_at is not null) or ($1 = 'locked' and locked))
         and ($2 = '' or concat_ws(' ', first_name, last_name, email, phone, id, wallet_address) ilike $3)
       order by coalesce(last_seen_at, created_at) desc limit $4`,
      [query.filter, query.q, likePattern(query.q), PAGE],
    );
    return { users: rows.map((r) => this.userRow(r)), total: Number(rows[0]?.total ?? 0) };
  }

  async user(userId: string): Promise<AdminUserDetail> {
    const [row] = await this.db.query<PersonFactsRow>(`${PEOPLE} select * from person_rows where id = $1`, [userId]);
    if (!row) throw new ApiError(404, "user_not_found", "No PoolFi user has that id.");
    const [[sessions], balance, poolList, money, log] = await Promise.all([
      this.db.query<{ count: number }>(
        "select count(*)::int as count from verified_sessions where user_id = $1 and last_seen_at > now() - make_interval(mins => $2)",
        [userId, this.config.sessionIdleMinutes],
      ),
      row.wallet_address && row.wallet_activated_at
        ? this.chain.usdcBalance(row.wallet_address).catch(() => null)
        : Promise.resolve(null),
      this.poolRows(
        `id in (select id from pools where admin_user_id = $2
           union select pool_id from pool_members where user_id = $2
           union select pool_id from pool_divers where user_id = $2
           union select pool_id from pool_approvers where user_id = $2)`,
        [userId],
      ),
      this.moneyFor({ userId }),
      this.log({ kind: "user", id: userId }),
    ]);
    return {
      ...this.userRow(row),
      chain: this.chainInfo,
      suspendedAt: row.suspended_at?.toISOString() ?? null,
      suspendedReason: row.suspended_reason,
      signInFailures: row.failures,
      sessions: sessions?.count ?? 0,
      balance: balance === null ? null : toUsdc(balance),
      activationTx: row.activation_tx_hash,
      poolList,
      contributionList: money.contributions,
      depositList: money.deposits,
      refundList: money.refunds,
      payoutList: money.payouts,
      log,
    };
  }

  async poolList(query: z.infer<typeof AdminPoolQuery>): Promise<AdminPoolList> {
    const rows = await this.db.query<PoolFactsRow>(
      `${POOLS}
       select *, count(*) over () as total from pool_rows
       where ($2 = 'all' or status = $2)
         and ($3 = '' or concat_ws(' ', name, code, lg_first, lg_last, lg_email) ilike $4)
       order by created_at desc limit $5`,
      [this.contract, query.status, query.q, likePattern(query.q), PAGE],
    );
    return { pools: rows.map(toPoolRow), total: Number(rows[0]?.total ?? 0) };
  }

  async pool(poolId: string): Promise<AdminPoolDetail> {
    const row = await this.views.byId(poolId);
    const [[facts], state, divers, request] = await Promise.all([
      this.poolRows("id = $2", [row.id]),
      this.views.state(row),
      this.views.divers(row.id),
      this.views.latestRequest(row.id),
    ]);
    if (!facts) throw new ApiError(404, "pool_not_found", "Pool not found.");
    const [approvers, money, activity, transactions, log] = await Promise.all([
      this.db.query<NamedRow & { user_id: string; vote: "approved" | "declined" | null }>(
        `select a.user_id, u.first_name, u.last_name, u.email, v.vote from pool_approvers a
         join users u on u.id = a.user_id
         left join payout_votes v on v.user_id = a.user_id and v.request_id = $2
         where a.pool_id = $1 order by a.position`,
        [row.id, request?.id ?? null],
      ),
      this.moneyFor({ poolId: row.id }),
      this.views.activity([row.id], null, 100),
      this.transactions(row),
      this.log({ kind: "pool", id: row.id }),
    ]);
    return {
      ...facts,
      chain: this.chainInfo,
      description: row.description,
      chainPoolId: row.chain_pool_id,
      ledger: {
        status: state.status,
        goal: toUsdc(state.goalAmount),
        contributed: toUsdc(state.totalContributed),
        refunded: toUsdc(state.totalRefunded),
        members: state.memberCount,
        deadline: state.deadline.toISOString(),
      },
      feeBps: row.fee_bps,
      feeCovered: row.fee_covered,
      settings: {
        pickYourName: row.pick_your_name,
        allowNotOnList: row.allow_not_on_list,
        diversCanShare: row.divers_can_share,
        diversSeePayments: row.divers_see_payments,
      },
      missedNotifiedAt: row.missed_notified_at?.toISOString() ?? null,
      refundChosenAt: row.refund_chosen_at?.toISOString() ?? null,
      refundsFinishedAt: row.refunds_finished_at?.toISOString() ?? null,
      divers: divers.map((d) => toDiver(d, true)),
      approverList: approvers.map((a) => ({ user: person(a.user_id, a), vote: a.vote })),
      contributionList: money.contributions,
      payoutList: money.payouts,
      refundList: money.refunds,
      activity,
      transactions,
      log,
    };
  }

  /** Pools being refunded, wallets not on Stellar yet, and the latest of everything else. */
  async money(): Promise<AdminMoney> {
    const [refunding, wallets, rest] = await Promise.all([
      this.db.query<PoolFactsRow & { stuck: boolean }>(
        `${POOLS} select *, ${refundsStuck("pool_rows")} as stuck from pool_rows
         where refund_chosen_at is not null and refunds_finished_at is null order by refund_chosen_at`,
        [this.contract],
      ),
      this.db.query<NamedRow & { user_id: string; public_key: string; created_at: Date }>(
        `select w.user_id, w.public_key, w.created_at, u.first_name, u.last_name, u.email
         from wallets w join users u on u.id = w.user_id where w.activated_at is null order by w.created_at`,
      ),
      this.moneyFor({}),
    ]);
    return {
      chain: this.chainInfo,
      refunding: refunding.map((p) => ({
        pool: toPoolRow(p),
        startedAt: (p.refund_chosen_at ?? p.created_at).toISOString(),
        owed: toUsdc(BigInt(p.raised) > BigInt(p.refunded) ? (BigInt(p.raised) - BigInt(p.refunded)).toString() : "0"),
        needsAttention: p.stuck,
      })),
      wallets: wallets.map((w) => ({ user: person(w.user_id, w), address: w.public_key, createdAt: w.created_at.toISOString() })),
      ...rest,
    };
  }

  /** The admin log, newest first. */
  async log(target?: { kind: TargetKind; id: string }, limit = 200): Promise<AdminAction[]> {
    return (await this.actionRows(target ?? {}, limit)).map((a) => ({
      id: a.id,
      admin: { id: a.admin_user_id, email: a.admin_email },
      action: a.action,
      target: { kind: a.target_kind, id: a.target_id, label: a.target_label },
      reason: a.reason,
      details: a.details,
      at: a.at.toISOString(),
    }));
  }

  // Fixing things. Each is written to the admin log with who did it.

  /** Stops an account from signing in or using the app, and signs it out everywhere now. */
  async suspend(admin: AuthUser, userId: string, reason: string): Promise<AdminUserDetail> {
    const target = await this.person(userId);
    if (target.id === admin.id) throw new ApiError(409, "cannot_suspend_self", "You can't suspend your own account.");
    if (this.isAdminEmail(target.email)) {
      throw new ApiError(409, "cannot_suspend_admin", "This person is on the admin list. Take them off ADMIN_EMAILS first.");
    }
    await this.act(admin, "suspend_user", "user", userId, reason, {}, async (client) => {
      await client.query("update users set suspended_at = coalesce(suspended_at, now()), suspended_reason = $2 where id = $1", [
        userId,
        reason,
      ]);
      await client.query("delete from verified_sessions where user_id = $1", [userId]);
    });
    return this.user(userId);
  }

  async unsuspend(admin: AuthUser, userId: string): Promise<AdminUserDetail> {
    const target = await this.person(userId);
    if (!target.suspended_at) throw new ApiError(409, "not_suspended", "This account isn't suspended.");
    await this.act(admin, "unsuspend_user", "user", userId, null, { reason: target.suspended_reason }, async (client) => {
      await client.query("update users set suspended_at = null, suspended_reason = null where id = $1", [userId]);
    });
    return this.user(userId);
  }

  /** Clears wrong-password lockouts, as the emailed unlock code would. */
  async unlock(admin: AuthUser, userId: string): Promise<AdminUserDetail> {
    const target = await this.person(userId);
    if (!target.email) throw new ApiError(409, "no_email", "This account has no email address to unlock.");
    await this.act(admin, "unlock_user", "user", userId, null, {}, async (client) => {
      await client.query("delete from sign_in_failures where email = $1", [target.email?.trim().toLowerCase()]);
    });
    return this.user(userId);
  }

  /** Closes every signed-in session: the person signs in again (password and code) on each device. */
  async signOut(admin: AuthUser, userId: string): Promise<AdminUserDetail> {
    await this.person(userId);
    await this.act(admin, "sign_out_user", "user", userId, null, {}, async (client) => {
      const { rowCount } = await client.query("delete from verified_sessions where user_id = $1", [userId]);
      return { sessions: rowCount ?? 0 };
    });
    return this.user(userId);
  }

  /** Puts a wallet on Stellar (account and USDC trustline) when the first try didn't finish. */
  async activateWallet(admin: AuthUser, userId: string): Promise<AdminUserDetail> {
    await this.person(userId);
    const wallet = await this.wallets.activateFor(userId);
    await this.act(admin, "activate_wallet", "user", userId, null, { address: wallet.address });
    return this.user(userId);
  }

  /** Gives a pool more time, signed with its lifeguard's wallet. */
  async extendPool(admin: AuthUser, poolId: string, input: z.infer<typeof AdminExtendInput>, appUrl: string): Promise<AdminPoolDetail> {
    const row = await this.views.byId(poolId);
    const from = row.deadline.toISOString();
    await this.pools.extend(row, new Date(input.deadline), { userId: null, name: "PoolFi" }, appUrl);
    await this.act(admin, "extend_pool", "pool", row.id, input.reason || null, { from, to: new Date(input.deadline).toISOString() });
    return this.pool(row.id);
  }

  /** Closes a pool that hasn't paid out and refunds everyone who paid into it. */
  async closePool(admin: AuthUser, poolId: string, reason: string): Promise<AdminPoolDetail> {
    const row = await this.views.byId(poolId);
    await this.pools.close(row);
    await this.act(admin, "close_pool", "pool", row.id, reason, {});
    return this.pool(row.id);
  }

  /** Sends the refunds a cancelled pool still owes, now rather than at the next job run. */
  async retryRefunds(admin: AuthUser, poolId: string): Promise<AdminPoolDetail> {
    const row = await this.views.byId(poolId);
    const state = await this.views.state(row);
    if (state.status !== "refunded") throw new ApiError(409, "not_refunding", "This pool isn't being refunded.");
    const result = await this.refunds.refundNow(row.id, BigInt(row.chain_pool_id));
    await this.act(admin, "retry_refunds", "pool", row.id, null, { ...result });
    return this.pool(row.id);
  }

  /** Runs the scheduled refund job now. */
  async runRefundJob(admin: AuthUser): Promise<AdminJobRun> {
    const run = await this.refunds.runOnce();
    if (!run) throw new ApiError(409, "job_running", "The refund job is already running. Try again in a minute.");
    await this.act(admin, "run_refund_job", "job", null, null, { ...run });
    return run;
  }

  // Building blocks

  private userRow(row: PersonFactsRow): AdminUserRow {
    return {
      id: row.id,
      name: personName(row),
      email: row.email,
      phone: row.phone,
      avatar: row.avatar,
      joinedAt: row.created_at.toISOString(),
      lastSeenAt: row.last_seen_at?.toISOString() ?? null,
      state: row.state,
      pools: row.pool_count,
      created: row.created,
      paid: toUsdc(row.paid),
      payments: row.payment_count,
      deposited: toUsdc(row.deposited),
      wallet: row.wallet_address ? { address: row.wallet_address, activated: row.wallet_activated_at !== null } : null,
      suspended: row.suspended_at !== null,
      locked: row.locked,
      admin: this.isAdminEmail(row.email),
      pushOn: row.push_on,
    };
  }

  /** Pools matching `where` (on pool_rows; its parameters start at $2), newest first. */
  private async poolRows(where: string, params: unknown[]): Promise<AdminPoolRow[]> {
    const rows = await this.db.query<PoolFactsRow>(`${POOLS} select * from pool_rows where ${where} order by created_at desc`, [
      this.contract,
      ...params,
    ]);
    return rows.map(toPoolRow);
  }

  private async moneyFor(scope: MoneyScope): Promise<Omit<AdminMoney, "chain" | "refunding" | "wallets">> {
    const poolId = scope.poolId ?? null;
    const userId = scope.userId ?? null;
    const [payouts, withdrawals, refunds, contributions, deposits] = await Promise.all([
      this.db.query<PoolRef & NamedRow & { id: string; admin_user_id: string; gross: string; fee: string; net: string; reference: string | null; destination: "wallet" | "bank"; paid_at: Date; paid_tx_hash: string | null }>(
        `select r.id, r.pool_id, p.name as pool_name, p.emoji, p.admin_user_id, u.first_name, u.last_name, u.email,
           r.gross, r.fee, r.net, r.reference, r.destination, r.paid_at, r.paid_tx_hash
         from payout_requests r join pools p on p.id = r.pool_id join users u on u.id = p.admin_user_id
         where r.paid_at is not null and p.contract_id = $1 and ($2::uuid is null or r.pool_id = $2) and ($3::text is null or p.admin_user_id = $3)
         order by r.paid_at desc limit $4`,
        [this.contract, poolId, userId, MONEY_ROWS],
      ),
      // Pools paid out through the first API (POST /v1/pools/:id/withdraw), before payout requests.
      this.db.query<PoolRef & NamedRow & { id: string; user_id: string; amount: string; tx_hash: string; created_at: Date }>(
        `select w.id, w.pool_id, p.name as pool_name, p.emoji, w.user_id, u.first_name, u.last_name, u.email, w.amount, w.tx_hash, w.created_at
         from withdrawals w join pools p on p.id = w.pool_id join users u on u.id = w.user_id
         where p.contract_id = $1 and ($2::uuid is null or w.pool_id = $2) and ($3::text is null or w.user_id = $3)
         order by w.created_at desc limit $4`,
        [this.contract, poolId, userId, MONEY_ROWS],
      ),
      this.db.query<PoolRef & NamedRow & { id: string; user_id: string | null; wallet_address: string; amount: string; tx_hash: string; created_at: Date }>(
        `select f.id, f.pool_id, p.name as pool_name, p.emoji, f.user_id, u.first_name, u.last_name, u.email,
           f.wallet_address, f.amount, f.tx_hash, f.created_at
         from refunds f join pools p on p.id = f.pool_id left join users u on u.id = f.user_id
         where p.contract_id = $1 and ($2::uuid is null or f.pool_id = $2) and ($3::text is null or f.user_id = $3)
         order by f.created_at desc limit $4`,
        [this.contract, poolId, userId, MONEY_ROWS],
      ),
      this.db.query<PoolRef & NamedRow & { id: string; user_id: string; amount: string; receipt_ref: string | null; tx_hash: string; created_at: Date }>(
        `select c.id, c.pool_id, p.name as pool_name, p.emoji, c.user_id, u.first_name, u.last_name, u.email,
           c.amount, c.receipt_ref, c.tx_hash, c.created_at
         from contributions c join pools p on p.id = c.pool_id join users u on u.id = c.user_id
         where p.contract_id = $1 and ($2::uuid is null or c.pool_id = $2) and ($3::text is null or c.user_id = $3)
         order by c.created_at desc limit $4`,
        [this.contract, poolId, userId, MONEY_ROWS],
      ),
      // Deposits belong to people, not pools.
      poolId
        ? Promise.resolve([])
        : this.db.query<NamedRow & { id: string; user_id: string; amount: string; provider: string; tx_hash: string; created_at: Date }>(
            `select d.id, d.user_id, u.first_name, u.last_name, u.email, d.amount, d.provider, d.tx_hash, d.created_at
             from deposits d join users u on u.id = d.user_id
             where ($1::text is null or d.user_id = $1) order by d.created_at desc limit $2`,
            [userId, MONEY_ROWS],
          ),
    ]);
    const ref = (r: PoolRef) => ({ id: r.pool_id, name: r.pool_name, emoji: r.emoji });
    const paid: AdminPayout[] = [
      ...payouts.map((r) => ({
        id: r.id,
        pool: ref(r),
        lifeguard: person(r.admin_user_id, r),
        gross: toUsdc(r.gross),
        fee: toUsdc(r.fee),
        net: toUsdc(r.net),
        reference: r.reference,
        destination: r.destination,
        paidAt: r.paid_at.toISOString(),
        txHash: r.paid_tx_hash,
      })),
      ...withdrawals.map((w) => ({
        id: w.id,
        pool: ref(w),
        lifeguard: person(w.user_id, w),
        gross: toUsdc(w.amount),
        fee: 0,
        net: toUsdc(w.amount),
        reference: null,
        destination: "wallet" as const,
        paidAt: w.created_at.toISOString(),
        txHash: w.tx_hash,
      })),
    ].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
    return {
      payouts: paid.slice(0, MONEY_ROWS),
      refunds: refunds.map(
        (f): AdminRefund => ({
          id: f.id,
          pool: ref(f),
          user: f.user_id ? person(f.user_id, f) : null,
          wallet: f.wallet_address,
          amount: toUsdc(f.amount),
          txHash: f.tx_hash,
          at: f.created_at.toISOString(),
        }),
      ),
      contributions: contributions.map(
        (c): AdminContribution => ({
          id: c.id,
          pool: ref(c),
          user: person(c.user_id, c),
          amount: toUsdc(c.amount),
          receiptRef: c.receipt_ref,
          txHash: c.tx_hash,
          at: c.created_at.toISOString(),
        }),
      ),
      deposits: deposits.map(
        (d): AdminDeposit => ({
          id: d.id,
          user: person(d.user_id, d),
          amount: toUsdc(d.amount),
          provider: d.provider,
          txHash: d.tx_hash,
          at: d.created_at.toISOString(),
        }),
      ),
    };
  }

  /** Every transaction PoolFi sent the contract for this pool, from the hashes it kept, oldest first. */
  private async transactions(row: AppPoolRow): Promise<AdminPoolDetail["transactions"]> {
    const rows = await this.db.query<NamedRow & { hash: string; kind: AdminPoolDetail["transactions"][number]["kind"]; user_id: string | null; amount: string | null; at: Date }>(
      `select t.*, u.first_name, u.last_name, u.email from (
         select create_tx_hash as hash, 'created' as kind, 1 as step, admin_user_id as user_id, goal_amount as amount, created_at as at from pools where id = $1
         union all select join_tx_hash, 'joined', 2, user_id, null, joined_at from pool_members where pool_id = $1
         union all select tx_hash, 'contributed', 3, user_id, amount, created_at from contributions where pool_id = $1
         union all select data->>'txHash', 'extended', 4, actor_user_id, null, at from activity where pool_id = $1 and kind = 'extended' and data ? 'txHash'
         union all select request_tx_hash, 'payout_requested', 5, requested_by, null, requested_at from payout_requests where pool_id = $1 and request_tx_hash is not null
         union all select v.tx_hash, 'voted', 6, v.user_id, null, v.at from payout_votes v join payout_requests r on r.id = v.request_id where r.pool_id = $1
         union all select paid_tx_hash, 'paid_out', 7, requested_by, net, paid_at from payout_requests where pool_id = $1 and paid_tx_hash is not null
         union all select tx_hash, 'paid_out', 7, user_id, amount, created_at from withdrawals where pool_id = $1
         union all select tx_hash, 'refunded', 8, user_id, amount, created_at from refunds where pool_id = $1
       ) t left join users u on u.id = t.user_id
       -- Steps saved in one transaction share a time; they happened in step order.
       where t.hash is not null order by t.at, t.step`,
      [row.id],
    );
    return rows.map((t) => ({
      hash: t.hash,
      kind: t.kind,
      user: t.user_id ? person(t.user_id, t) : null,
      amount: t.amount === null ? null : toUsdc(t.amount),
      at: t.at.toISOString(),
    }));
  }

  private async actionRows(target: { kind?: TargetKind; id?: string }, limit: number): Promise<ActionRow[]> {
    return this.db.query<ActionRow>(
      `select a.*, case a.target_kind
           when 'user' then (select coalesce(nullif(concat_ws(' ', first_name, last_name), ''), email) from users where id = a.target_id)
           when 'pool' then (select name from pools where id::text = a.target_id)
         end as target_label
       from admin_actions a
       where ($1::text is null or (a.target_kind = $1 and a.target_id = $2))
       order by a.at desc limit $3`,
      [target.kind ?? null, target.id ?? null, limit],
    );
  }

  private async person(userId: string): Promise<{ id: string; email: string | null; suspended_at: Date | null; suspended_reason: string | null }> {
    const [row] = await this.db.query<{ id: string; email: string | null; suspended_at: Date | null; suspended_reason: string | null }>(
      "select id, email, suspended_at, suspended_reason from users where id = $1",
      [userId],
    );
    if (!row) throw new ApiError(404, "user_not_found", "No PoolFi user has that id.");
    return row;
  }

  /** Does `change` (if any) and writes the log line in one transaction. */
  private async act(
    admin: AuthUser,
    action: Action,
    kind: TargetKind,
    targetId: string | null,
    reason: string | null,
    details: Record<string, unknown>,
    change?: (client: Queryable) => Promise<Record<string, unknown> | void>,
  ): Promise<void> {
    await this.db.query(
      `insert into users (id, email, phone) values ($1, $2, $3)
       on conflict (id) do update set email = coalesce(excluded.email, users.email), phone = coalesce(excluded.phone, users.phone)`,
      [admin.id, admin.email, admin.phone],
    );
    await this.db.transaction(async (client) => {
      const more = (await change?.(client)) ?? {};
      await client.query(
        `insert into admin_actions (admin_user_id, admin_email, action, target_kind, target_id, reason, details)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [admin.id, admin.email ?? "", action, kind, targetId, reason, JSON.stringify({ ...details, ...more })],
      );
    });
  }
}

function personName(row: NamedRow): string {
  const name = nameOf(row);
  return name === "PoolFi user" && row.email ? row.email : name;
}

function person(id: string, row: NamedRow): AdminPerson {
  return { id, name: personName(row), email: row.email };
}

/** `%text%` for ilike, with the search's own % and _ taken literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

function toPoolRow(row: PoolFactsRow): AdminPoolRow {
  return {
    id: row.id,
    code: row.code,
    emoji: row.emoji,
    name: row.name,
    type: row.type,
    status: row.status,
    lifeguard: person(row.admin_user_id, { first_name: row.lg_first, last_name: row.lg_last, email: row.lg_email }),
    goal: toUsdc(row.goal_amount),
    raised: toUsdc(row.raised),
    refunded: toUsdc(row.refunded),
    share: toUsdc(row.share_amount),
    paidCount: row.paid_count,
    expectedCount: row.expected_count,
    approvers: row.approver_count,
    deadline: row.deadline.toISOString(),
    createdAt: row.created_at.toISOString(),
    payout:
      row.req_id || row.req_paid_at
        ? { approvals: row.req_approvals, needed: row.req_needed ?? 0, paidAt: row.req_paid_at?.toISOString() ?? null }
        : null,
  };
}

/** The log line as a sentence after the admin's address: "suspended Ada Eze". */
export function actionSentence(action: Action, label: string | null): string {
  const what = label ?? "something that no longer exists";
  switch (action) {
    case "suspend_user":
      return `suspended ${what}`;
    case "unsuspend_user":
      return `lifted ${what}'s suspension`;
    case "unlock_user":
      return `unlocked ${what}'s account`;
    case "sign_out_user":
      return `signed ${what} out everywhere`;
    case "activate_wallet":
      return `put ${what}'s wallet on Stellar`;
    case "extend_pool":
      return `extended the deadline for ${what}`;
    case "close_pool":
      return `closed ${what} and refunded its divers`;
    case "retry_refunds":
      return `sent the refunds left in ${what}`;
    case "run_refund_job":
      return "ran the refund job";
  }
}
