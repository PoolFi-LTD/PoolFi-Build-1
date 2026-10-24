import { Networks } from "@stellar/stellar-sdk";
import { z } from "zod";
import type {
  Achievements,
  ActivityItem,
  AppNotification,
  Contact,
  HomeAlert,
  HomeSummary,
  NotificationsView,
  Receipt,
  Transaction,
  User,
  Wallet,
} from "../../api-types.ts";
import type { AuthUser } from "../../auth.ts";
import type { Db } from "../../db.ts";
import { ApiError } from "../../errors.ts";
import type { Chain } from "../../stellar/chain.ts";
import type { Deposits } from "../deposits.ts";
import type { Wallets } from "../wallets.ts";
import { centsOf, centsToBase, nameOf, toUser, toUsdc, UsdcInput, type PersonRow } from "./common.ts";
import type { PoolViews } from "./pool-views.ts";

/** A 256px photo from the profile screen is ~30 KB; this leaves room without letting rows balloon. */
const MAX_PHOTO_CHARS = 300_000;
const OPEN = new Set(["active", "met", "approval"]);

const AvatarInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("emoji"),
    emoji: z.string().min(1).max(16),
    bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  z.object({
    kind: z.literal("photo"),
    url: z
      .string()
      .max(MAX_PHOTO_CHARS)
      .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, "must be a JPEG, PNG or WebP image"),
  }),
]);

export const ProfileInput = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60),
  avatar: AvatarInput,
});

export const DepositInput = z.object({ amount: UsdcInput });
export const PreferencesInput = z.object({ remindersOn: z.boolean() });

interface ReceiptRow {
  receipt_ref: string;
  amount: string;
  created_at: Date;
  tx_hash: string;
  pool_name: string;
  pool_emoji: string;
  diver_name: string | null;
  payer_first: string | null;
  payer_last: string | null;
  lifeguard_first: string | null;
  lifeguard_last: string | null;
}

/** The signed-in person's side of the app: profile, home, wallet and history. */
export class Account {
  constructor(
    private readonly db: Db,
    private readonly chain: Chain,
    private readonly wallets: Wallets,
    private readonly deposits: Deposits,
    private readonly views: PoolViews,
    private readonly network: string,
  ) {}

  /** The signed-in user; their wallet is made on their first visit. */
  async me(user: AuthUser): Promise<User> {
    await this.wallets.ensureUser(user);
    return toUser(await this.person(user.id));
  }

  async saveProfile(user: AuthUser, input: z.infer<typeof ProfileInput>): Promise<User> {
    await this.wallets.ensureUser(user);
    const [row] = await this.db.query<PersonRow>(
      "update users set first_name = $2, last_name = $3, avatar = $4 where id = $1 returning *",
      [user.id, input.firstName, input.lastName, JSON.stringify(input.avatar)],
    );
    if (!row) throw new Error(`User ${user.id} disappeared while saving their profile`);
    return toUser(row);
  }

  async home(user: AuthUser): Promise<HomeSummary> {
    const address = await this.wallets.address(user.id);
    const rows = await this.views.visible(user.id);
    const [built, balance, activity, approvals, locked] = await Promise.all([
      this.views.summaries(rows, user.id),
      address ? this.chain.usdcBalance(address) : Promise.resolve(0n),
      Promise.all([this.views.paymentsHiddenIn(rows, user.id), this.views.diverIn(rows, user.id)]).then(([hidden, diver]) =>
        this.views.activity(
          rows.map((r) => r.id),
          user.id,
          4,
          hidden,
          diver,
        ),
      ),
      // Approvers who haven't voted on a waiting payout yet.
      this.db.query<{ pool_id: string }>(
        `select r.pool_id from payout_requests r
         join pool_approvers a on a.pool_id = r.pool_id and a.user_id = $1
         where r.paid_at is null and r.declined_at is null
           and not exists (select 1 from payout_votes v where v.request_id = r.id and v.user_id = $1)`,
        [user.id],
      ),
      this.db.query<{ pool_id: string; amount: string }>(
        "select pool_id, sum(amount)::text as amount from contributions where user_id = $1 group by pool_id",
        [user.id],
      ),
    ]);

    const open = built.filter((b) => OPEN.has(b.summary.status));
    const paidByPool = new Map(locked.map((l) => [l.pool_id, BigInt(l.amount)]));
    // USDC the user paid into pools that haven't paid out or refunded yet.
    const lockedPools = open.filter((b) => (paidByPool.get(b.row.id) ?? 0n) > 0n);
    const lockedBase = lockedPools.reduce((sum, b) => sum + (paidByPool.get(b.row.id) ?? 0n), 0n);
    const available = balance ?? 0n;
    const leading = open.filter((b) => b.summary.role === "lifeguard");
    const waiting = new Set(approvals.map((a) => a.pool_id));
    const lifeguards = await this.views.people(open.map((b) => b.row.admin_user_id));

    const alerts: HomeAlert[] = [
      ...leading
        .filter((b) => b.summary.status === "met")
        .map((b) => ({ kind: "goal_met" as const, poolId: b.row.id, poolName: b.row.name })),
      ...open
        .filter((b) => b.summary.status === "approval" && b.summary.role === "approver" && waiting.has(b.row.id))
        .map((b) => ({
          kind: "approval_needed" as const,
          poolId: b.row.id,
          poolName: b.row.name,
          requester: lifeguards.get(b.row.admin_user_id)?.first_name || nameOf(lifeguards.get(b.row.admin_user_id)),
        })),
    ];

    return {
      balance: toUsdc(available + lockedBase),
      available: toUsdc(available),
      locked: toUsdc(lockedBase),
      lockedPools: lockedPools.length,
      activePools: open.length,
      contributionsIn: leading.reduce((n, b) => n + b.summary.paidCount, 0),
      contributionsExpected: leading.reduce((n, b) => n + b.summary.expectedCount, 0),
      alerts,
      pools: leading.map((b) => b.summary),
      activity,
    };
  }

  async activity(user: AuthUser): Promise<ActivityItem[]> {
    const rows = await this.views.visible(user.id);
    return this.views.activity(
      rows.map((r) => r.id),
      user.id,
      100,
      await this.views.paymentsHiddenIn(rows, user.id),
      await this.views.diverIn(rows, user.id),
    );
  }

  /**
   * The notifications inbox: what happened in the user's pools that they'd want to
   * know (not their own actions), newest first, with what's new since they last looked.
   */
  async notifications(user: AuthUser): Promise<NotificationsView> {
    const rows = await this.views.visible(user.id);
    const ids = rows.map((r) => r.id);
    const hidden = await this.views.paymentsHiddenIn(rows, user.id);
    const [[me], paid, waiting, events] = await Promise.all([
      this.db.query<{ seen: Date | null; created_at: Date }>(
        "select notifications_seen_at as seen, created_at from users where id = $1",
        [user.id],
      ),
      this.db.query<{ pool_id: string }>("select distinct pool_id from contributions where user_id = $1", [user.id]),
      // Payouts waiting for this approver's vote.
      this.db.query<{ id: string; pool_id: string; pool_name: string; requested_at: Date; first_name: string | null; last_name: string | null; gross: string | null }>(
        `select r.id, r.pool_id, p.name as pool_name, r.requested_at, u.first_name, u.last_name, r.gross
         from payout_requests r
         join pool_approvers a on a.pool_id = r.pool_id and a.user_id = $1
         join pools p on p.id = r.pool_id
         join users u on u.id = p.admin_user_id
         where r.paid_at is null and r.declined_at is null
           and not exists (select 1 from payout_votes v where v.request_id = r.id and v.user_id = $1)`,
        [user.id],
      ),
      ids.length === 0
        ? Promise.resolve([])
        : this.db.query<{
            id: string;
            pool_id: string;
            kind: ActivityItem["kind"];
            actor_name: string | null;
            amount: string | null;
            data: { count?: number; vote?: string; reason?: string };
            at: Date;
            pool_name: string;
            admin_user_id: string;
            deadline: Date;
          }>(
            `select a.id, a.pool_id, a.kind, a.actor_name, a.amount, a.data, a.at, p.name as pool_name, p.admin_user_id, p.deadline
             from activity a join pools p on p.id = a.pool_id
             where a.pool_id = any($1::uuid[]) and a.actor_user_id is distinct from $2
               and a.kind in ('payment', 'goal_met', 'approval', 'payout', 'refund', 'reminder')
               and not (a.kind = 'payment' and a.pool_id = any($3::uuid[]))
             order by a.at desc limit 60`,
            [ids, user.id, hidden],
          ),
    ]);
    const paidInto = new Set(paid.map((p) => p.pool_id));
    const seen = me?.seen?.getTime() ?? 0;
    const items: Omit<AppNotification, "unread">[] = [];

    for (const w of waiting) {
      const who = nameOf({ first_name: w.first_name, last_name: w.last_name });
      items.push({
        id: `approval-${w.id}`,
        icon: "🔑",
        title: `${who} requested the payout from ${w.pool_name}. You're an approver.`,
        at: w.requested_at.toISOString(),
        href: `/pools/${w.pool_id}/approve`,
      });
    }
    for (const e of events) {
      const lifeguard = e.admin_user_id === user.id;
      const amount = e.amount === null ? "" : ` ${toUsdc(e.amount).toFixed(2)} USDC`;
      const pool = `/pools/${e.pool_id}`;
      const at = e.at.toISOString();
      switch (e.kind) {
        case "payment":
          items.push({ id: e.id, icon: "🌊", title: `${e.actor_name ?? "Someone"} paid${amount} into ${e.pool_name}.`, at, href: pool });
          break;
        case "goal_met":
          items.push({
            id: e.id,
            icon: "🎉",
            title: lifeguard ? `${e.pool_name} is full! Request your payout when you're ready.` : `${e.pool_name} reached its goal.`,
            at,
            href: lifeguard ? `${pool}/payout` : pool,
          });
          break;
        case "approval":
          if (!lifeguard) break;
          items.push({
            id: e.id,
            icon: e.data.vote === "declined" ? "✋" : "✅",
            title:
              e.data.vote === "declined"
                ? `${e.actor_name ?? "An approver"} declined the payout for ${e.pool_name}${e.data.reason ? `: "${e.data.reason}"` : "."}`
                : `${e.actor_name ?? "An approver"} approved the payout for ${e.pool_name}.`,
            at,
            href: `${pool}/payout/status`,
          });
          break;
        case "payout":
          if (!lifeguard && !paidInto.has(e.pool_id)) break;
          items.push({
            id: e.id,
            icon: "💸",
            title: lifeguard ? `${amount.trim()} from ${e.pool_name} landed in your PoolFi balance.` : `${e.pool_name} was paid out to ${e.actor_name ?? "the lifeguard"}.`,
            at,
            href: lifeguard ? `${pool}/record` : pool,
          });
          break;
        case "refund":
          if (!lifeguard && !paidInto.has(e.pool_id)) break;
          items.push({
            id: e.id,
            icon: "↩️",
            title: lifeguard
              ? `${e.pool_name} didn't reach its goal. Everyone who paid got their money back.`
              : `${e.pool_name} didn't reach its goal. Your money is back in your PoolFi balance.`,
            at,
            href: lifeguard ? pool : "/wallet",
          });
          break;
        case "reminder":
          // Reminders matter to people in the pool who haven't paid yet.
          if (lifeguard || paidInto.has(e.pool_id)) break;
          items.push({ id: e.id, icon: "📣", title: `${e.actor_name ?? "The lifeguard"} reminded you: ${e.pool_name} closes soon.`, at, href: pool });
          break;
      }
    }
    if (items.length === 0 && me) {
      items.push({ id: "welcome", icon: "👋", title: "Welcome to PoolFi! Create your first pool, or pay into one from an invite link.", at: me.created_at.toISOString(), href: "/create" });
    }
    const sorted = items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50).map((n) => ({ ...n, unread: new Date(n.at).getTime() > seen }));
    return { items: sorted, unread: sorted.filter((n) => n.unread).length };
  }

  /** The on-time streak and badges on the Me screen, worked out from what the user has done. */
  async achievements(user: AuthUser): Promise<Achievements> {
    const [row] = await this.db.query<{
      early: boolean;
      first_pool: boolean;
      full_pool: boolean;
      trusted: boolean;
      paid_any: boolean;
      pools: number;
      verified: boolean;
      reminders_on: boolean | null;
      streak: number;
    }>(
      `with misses as (
         -- Pools the user joined but closed without their payment.
         select max(p.deadline) as last from pool_members m join pools p on p.id = m.pool_id
         where m.user_id = $1 and p.deadline < now()
           and not exists (select 1 from contributions c where c.pool_id = p.id and c.user_id = $1)
       )
       select
         exists (select 1 from contributions c join pools p on p.id = c.pool_id
                 where c.user_id = $1 and c.created_at <= p.created_at + interval '1 day') as early,
         exists (select 1 from pools where admin_user_id = $1) as first_pool,
         exists (select 1 from activity a join pools p on p.id = a.pool_id where a.kind = 'goal_met' and p.admin_user_id = $1) as full_pool,
         exists (select 1 from payout_votes where user_id = $1 and vote = 'approved') as trusted,
         exists (select 1 from contributions where user_id = $1) as paid_any,
         (select count(*)::int from pools p where p.admin_user_id = $1
            or exists (select 1 from pool_approvers a where a.pool_id = p.id and a.user_id = $1)
            or exists (select 1 from contributions c where c.pool_id = p.id and c.user_id = $1)) as pools,
         (select email_verified_at is not null from users where id = $1) as verified,
         (select reminders_on from users where id = $1) as reminders_on,
         (select count(distinct c.pool_id)::int from contributions c, misses
          where c.user_id = $1 and (misses.last is null or c.created_at > misses.last)) as streak`,
      [user.id],
    );
    const has = (key: keyof NonNullable<typeof row>) => Boolean(row?.[key]);
    return {
      streak: row?.streak ?? 0,
      emailVerified: has("verified"),
      remindersOn: row?.reminders_on ?? true,
      badges: [
        { id: "early", icon: "⚡", name: "Early diver", detail: "Paid within a day", earned: has("early") },
        { id: "first_pool", icon: "🛟", name: "First pool", detail: "Started a pool", earned: has("first_pool") },
        { id: "full_pool", icon: "🎉", name: "Full pool", detail: "A pool hit its goal", earned: has("full_pool") },
        { id: "trusted", icon: "🔑", name: "Trusted", detail: "Approved a payout", earned: has("trusted") },
        { id: "stablecoins", icon: "🌍", name: "Diaspora diver", detail: "Paid in stablecoins", earned: has("paid_any") },
        { id: "ten_pools", icon: "💯", name: "10 pools", detail: "Be in 10 pools", earned: (row?.pools ?? 0) >= 10 },
      ],
    };
  }

  async savePreferences(user: AuthUser, input: z.infer<typeof PreferencesInput>): Promise<Achievements> {
    await this.db.query("update users set reminders_on = $2 where id = $1", [user.id, input.remindersOn]);
    return this.achievements(user);
  }

  async markNotificationsRead(user: AuthUser): Promise<void> {
    await this.db.query("update users set notifications_seen_at = now() where id = $1", [user.id]);
  }

  /** People the user shares a pool with, for picking approvers. Only people who can approve (an active wallet). */
  async contacts(user: AuthUser): Promise<Contact[]> {
    const rows = await this.db.query<PersonRow & { pool_name: string }>(
      `with mine as (
         select p.id, p.name, p.created_at, p.admin_user_id from pools p
         where p.admin_user_id = $1
            or exists (select 1 from pool_approvers a where a.pool_id = p.id and a.user_id = $1)
            or exists (select 1 from pool_divers d where d.pool_id = p.id and d.user_id = $1)
       ),
       people as (
         select m.admin_user_id as user_id, m.name, m.created_at from mine m
         union all
         select a.user_id, m.name, m.created_at from mine m join pool_approvers a on a.pool_id = m.id
         union all
         select d.user_id, m.name, m.created_at from mine m join pool_divers d on d.pool_id = m.id where d.user_id is not null
       ),
       latest as (
         select distinct on (user_id) user_id, name as pool_name from people
         where user_id <> $1 order by user_id, created_at desc
       )
       select u.*, l.pool_name from latest l
       join users u on u.id = l.user_id
       join wallets w on w.user_id = u.id and w.activated_at is not null
       where u.first_name is not null
       limit 500`,
      [user.id],
    );
    return rows
      .map((r) => ({ userId: r.id, name: nameOf(r), detail: `From ${r.pool_name}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async wallet(user: AuthUser): Promise<Wallet> {
    const wallet = await this.wallets.ensureUser(user);
    const [balance, transactions] = await Promise.all([
      this.chain.usdcBalance(wallet.address),
      this.db.query<{ id: string; kind: Transaction["kind"]; title: string; at: Date; amount: string; direction: "in" | "out"; tx_hash: string | null }>(
        `select * from (
           select d.id::text, 'deposit' as kind, 'USDC deposit' as title, d.created_at as at, d.amount, 'in' as direction, d.tx_hash
           from deposits d where d.user_id = $1
           union all
           select c.id::text, 'contribution', 'Paid into ' || p.name, c.created_at, c.amount, 'out', c.tx_hash
           from contributions c join pools p on p.id = c.pool_id where c.user_id = $1
           union all
           select w.id::text, 'payout', 'Payout from ' || p.name, w.created_at, w.amount, 'in', w.tx_hash
           from withdrawals w join pools p on p.id = w.pool_id where w.user_id = $1
           union all
           select r.id::text, 'refund', 'Refund from ' || p.name, r.created_at, r.amount, 'in', r.tx_hash
           from refunds r join pools p on p.id = r.pool_id where r.user_id = $1
         ) t order by at desc limit 100`,
        [user.id],
      ),
    ]);
    return {
      address: wallet.address,
      network: this.network,
      balance: toUsdc(balance ?? 0n),
      transactions: transactions.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        at: t.at.toISOString(),
        amount: toUsdc(t.amount),
        direction: t.direction,
        txHash: t.tx_hash,
      })),
    };
  }

  /** Testnet: test USDC from PoolFi's treasury. */
  async deposit(user: AuthUser, input: z.infer<typeof DepositInput>): Promise<Wallet> {
    await this.deposits.deposit(user, centsToBase(centsOf(input.amount)));
    return this.wallet(user);
  }

  /** A payment's receipt. Public, so anyone given the reference can check it. */
  async receipt(ref: string): Promise<Receipt> {
    const [row] = await this.db.query<ReceiptRow>(
      `select c.receipt_ref, c.amount, c.created_at, c.tx_hash, p.name as pool_name, p.emoji as pool_emoji,
         d.name as diver_name, payer.first_name as payer_first, payer.last_name as payer_last,
         lg.first_name as lifeguard_first, lg.last_name as lifeguard_last
       from contributions c
       join pools p on p.id = c.pool_id
       join users lg on lg.id = p.admin_user_id
       join users payer on payer.id = c.user_id
       left join pool_divers d on d.id = c.diver_id
       where c.receipt_ref = $1`,
      [ref.trim().toUpperCase()],
    );
    if (!row) throw new ApiError(404, "receipt_not_found", "There's no receipt with that reference.");
    return {
      ref: row.receipt_ref,
      amount: toUsdc(row.amount),
      poolName: row.pool_name,
      poolEmoji: row.pool_emoji,
      lifeguardName: nameOf({ first_name: row.lifeguard_first, last_name: row.lifeguard_last }),
      paidBy: row.diver_name ?? nameOf({ first_name: row.payer_first, last_name: row.payer_last }),
      method: "USDC from PoolFi wallet",
      paidAt: row.created_at.toISOString(),
      status: "confirmed",
      txHash: row.tx_hash,
    };
  }

  private async person(userId: string): Promise<PersonRow> {
    const [row] = await this.db.query<PersonRow>("select * from users where id = $1", [userId]);
    if (!row) throw new Error(`User ${userId} was not saved`);
    return row;
  }
}

export function networkName(passphrase: string): string {
  if (passphrase === Networks.PUBLIC) return "Stellar";
  if (passphrase === Networks.TESTNET) return "Stellar testnet";
  return "Stellar (local)";
}
