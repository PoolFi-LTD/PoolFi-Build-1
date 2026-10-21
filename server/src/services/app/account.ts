import { Networks } from "@stellar/stellar-sdk";
import { z } from "zod";
import type { ActivityItem, Contact, HomeAlert, HomeSummary, Receipt, Transaction, User, Wallet } from "../../api-types.ts";
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
      this.views.activity(
        rows.map((r) => r.id),
        user.id,
        4,
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
    );
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
