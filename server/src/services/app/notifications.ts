import type { Db } from "../../db.ts";
import type { Email, Mailer } from "../../email/mailer.ts";
import {
  approvalNeededEmail,
  deadlineExtendedEmail,
  goalMetEmail,
  goalMissedEmail,
  paidOutEmail,
  payoutDeclinedEmail,
  receiptEmail,
  refundEmail,
  reminderEmail,
  type EmailContext,
  type Rendered,
  usdc,
} from "../../email/messages.ts";
import type { Push } from "../push.ts";
import { nameOf, toUsdc, type PersonRow } from "./common.ts";
import type { AppPoolRow } from "./pool-views.ts";

/** A reminder's recipient: someone on the list whose contact is an email address. */
export interface ReminderRecipient {
  diverId: string;
  name: string;
  email: string;
}

/**
 * Emails people about what happened in their pools. Only people with an email on
 * their account (or, for reminders, on the list) get one; phone sign-ins don't.
 */
export class Notifications {
  constructor(
    private readonly db: Db,
    private readonly mail: Mailer,
    private readonly defaults: { appUrl: string | null; timeZone: string },
    /** Device notifications, sent alongside the emails. */
    private readonly push?: Push,
  ) {}

  /** The payer's receipt, and the lifeguard's "goal met" if this payment reached it. */
  async paid(
    row: AppPoolRow,
    p: { payerId: string; diverName: string; amount: bigint; receiptRef: string; goalReachedWith: bigint | null },
    appUrl: string | null,
  ) {
    const ctx = this.context(appUrl);
    const people = await this.people([p.payerId, row.admin_user_id]);
    const payer = people.get(p.payerId);
    const lifeguard = people.get(row.admin_user_id);
    const emails: Email[] = [];
    if (payer?.email) {
      emails.push(
        email(payer.email, `receipt:${p.receiptRef}`, receiptEmail({
          poolName: row.name,
          poolEmoji: row.emoji,
          lifeguardName: nameOf(lifeguard),
          diverName: p.diverName,
          amount: toUsdc(p.amount),
          ref: p.receiptRef,
          paidAt: new Date(),
        }, ctx)),
      );
    }
    // The lifeguard's devices hear about each payment (one notification per pool, replaced as more come in).
    if (p.payerId !== row.admin_user_id) {
      await this.push?.toUsers([row.admin_user_id], {
        title: `${row.emoji} ${row.name}`,
        body: `${p.diverName} paid ${usdc(toUsdc(p.amount))}.`,
        url: `/pools/${row.id}`,
        tag: `payments-${row.id}`,
      });
    }
    if (p.goalReachedWith !== null) {
      await this.push?.toUsers([row.admin_user_id], {
        title: `🎉 ${row.name} is full`,
        body: `${usdc(toUsdc(p.goalReachedWith))} is in. Request the payout when you're ready.`,
        url: `/pools/${row.id}/payout`,
      });
    }
    if (p.goalReachedWith !== null && lifeguard?.email) {
      const approvers = await this.approverIds(row.id);
      emails.push(
        email(lifeguard.email, `goal-met:${row.id}`, goalMetEmail({ poolName: row.name, poolId: row.id, raised: toUsdc(p.goalReachedWith), approvers: approvers.length }, ctx)),
      );
    }
    await this.mail.send(emails);
  }

  /** Asks each approver to look at the payout the lifeguard requested. */
  async approvalNeeded(row: AppPoolRow, p: { requestId: string; gross: bigint; needed: number }, appUrl: string | null) {
    const ctx = this.context(appUrl);
    const ids = await this.approverIds(row.id);
    const people = await this.people([row.admin_user_id, ...ids]);
    const lifeguardName = nameOf(people.get(row.admin_user_id));
    await this.push?.toUsers(ids, {
      title: "🔑 Your approval is needed",
      body: `${lifeguardName} asked to pay out ${usdc(toUsdc(p.gross))} from ${row.name}.`,
      url: `/pools/${row.id}/approve`,
    });
    const emails = ids.flatMap((id) => {
      const approver = people.get(id);
      if (!approver?.email) return [];
      return [
        email(approver.email, `approval:${p.requestId}:${id}`, approvalNeededEmail({
          poolName: row.name,
          poolId: row.id,
          lifeguardName,
          gross: toUsdc(p.gross),
          needed: p.needed,
          approvers: ids.length,
        }, ctx)),
      ];
    });
    await this.mail.send(emails);
  }

  /** An approver agreed but more approvals are still needed: the lifeguard sees progress. */
  async approvalGiven(row: AppPoolRow, p: { approverName: string; approvals: number; needed: number }) {
    await this.push?.toUsers([row.admin_user_id], {
      title: `✅ ${p.approverName} approved`,
      body: `${p.approvals} of ${p.needed} approvals for the ${row.name} payout.`,
      url: `/pools/${row.id}/payout/status`,
      tag: `approvals-${row.id}`,
    });
  }

  async paidOut(row: AppPoolRow, p: { gross: bigint; net: bigint; reference: string }, appUrl: string | null) {
    const payers = await this.db.query<{ user_id: string }>(
      "select distinct user_id from contributions where pool_id = $1 and user_id <> $2",
      [row.id, row.admin_user_id],
    );
    await this.push?.toUsers([row.admin_user_id], {
      title: "💸 Your payout landed",
      body: `${usdc(toUsdc(p.net))} from ${row.name} is in your PoolFi balance.`,
      url: `/pools/${row.id}/record`,
    });
    await this.push?.toUsers(
      payers.map((x) => x.user_id),
      { title: `${row.emoji} ${row.name} was paid out`, body: "The pool reached its goal and the lifeguard has been paid.", url: `/pools/${row.id}` },
    );
    const lifeguard = (await this.people([row.admin_user_id])).get(row.admin_user_id);
    if (!lifeguard?.email) return;
    await this.mail.send([
      email(lifeguard.email, `paid-out:${row.id}`, paidOutEmail({
        poolName: row.name,
        poolId: row.id,
        gross: toUsdc(p.gross),
        fee: toUsdc(p.gross - p.net),
        net: toUsdc(p.net),
        reference: p.reference,
      }, this.context(appUrl))),
    ]);
  }

  async declined(row: AppPoolRow, p: { requestId: string; approverName: string; reason: string }, appUrl: string | null) {
    await this.push?.toUsers([row.admin_user_id], {
      title: "✋ Payout declined",
      body: `${p.approverName}: "${p.reason}". The money stays in ${row.name}.`,
      url: `/pools/${row.id}`,
    });
    const lifeguard = (await this.people([row.admin_user_id])).get(row.admin_user_id);
    if (!lifeguard?.email) return;
    await this.mail.send([
      email(lifeguard.email, `declined:${p.requestId}`, payoutDeclinedEmail({
        poolName: row.name,
        poolId: row.id,
        approverName: p.approverName,
        reason: p.reason,
      }, this.context(appUrl))),
    ]);
  }

  /** Emails the reminders; returns how many were sent. */
  async reminders(row: AppPoolRow, allRecipients: ReminderRecipient[], appUrl: string | null): Promise<number> {
    // People with a PoolFi account who turned deadline reminders off don't get them.
    const off = allRecipients.length
      ? await this.db.query<{ email: string }>(
          "select lower(email) as email from users where lower(email) = any($1::text[]) and not reminders_on",
          [allRecipients.map((r) => r.email.toLowerCase())],
        )
      : [];
    const muted = new Set(off.map((o) => o.email));
    const recipients = allRecipients.filter((r) => !muted.has(r.email.toLowerCase()));
    if (recipients.length === 0) return 0;
    // People on the list who have a PoolFi account (with reminders on) also get it on their devices.
    const accounts = await this.db.query<{ id: string }>(
      "select id from users where lower(email) = any($1::text[]) and reminders_on",
      [recipients.map((r) => r.email.toLowerCase())],
    );
    await this.push?.toUsers(
      accounts.map((a) => a.id),
      { title: `👋 ${row.emoji} ${row.name}`, body: `Your ${usdc(toUsdc(row.share_amount))} share is waiting. Tap to pay.`, url: `/p/${row.code}` },
    );
    const ctx = this.context(appUrl);
    const lifeguardName = nameOf((await this.people([row.admin_user_id])).get(row.admin_user_id));
    // One a day per person at most, even if the lifeguard taps Remind again.
    const today = new Date().toISOString().slice(0, 10);
    await this.mail.send(
      recipients.map((r) =>
        email(r.email, `reminder:${r.diverId}:${today}`, reminderEmail({
          poolName: row.name,
          poolEmoji: row.emoji,
          code: row.code,
          lifeguardName,
          diverName: r.name,
          share: toUsdc(row.share_amount),
          deadline: row.deadline,
        }, ctx)),
      ),
    );
    return recipients.length;
  }

  /** The deadline passed below the goal: the lifeguard is asked to extend it or refund the divers. */
  async goalMissed(row: AppPoolRow, p: { raised: bigint; goal: bigint }) {
    await this.push?.toUsers([row.admin_user_id], {
      title: `⏰ ${row.name} missed its deadline`,
      body: `${usdc(toUsdc(p.raised))} of ${usdc(toUsdc(p.goal))} came in. Extend the date or refund the divers.`,
      url: `/pools/${row.id}`,
    });
    const lifeguard = (await this.people([row.admin_user_id])).get(row.admin_user_id);
    if (!lifeguard?.email) return;
    const [counted] = await this.db.query<{ paid: number }>(
      "select count(*)::int as paid from contributions where pool_id = $1",
      [row.id],
    );
    await this.mail.send([
      // One per deadline: a pool extended and missed again asks again.
      email(lifeguard.email, `missed:${row.id}:${row.deadline.toISOString()}`, goalMissedEmail({
        poolName: row.name,
        poolId: row.id,
        raised: toUsdc(p.raised),
        goal: toUsdc(p.goal),
        paidCount: counted?.paid ?? 0,
        expectedCount: row.expected_count,
        deadline: row.deadline,
      }, this.context(null))),
    ]);
  }

  /** The lifeguard gave the pool more time: everyone else in it hears the new deadline. */
  async extended(row: AppPoolRow, p: { lifeguardName: string }, appUrl: string | null) {
    const people = await this.db.query<PersonRow & { paid: boolean; approver: boolean }>(
      `select u.*,
         exists (select 1 from contributions c where c.pool_id = $1 and c.user_id = u.id) as paid,
         exists (select 1 from pool_approvers a where a.pool_id = $1 and a.user_id = u.id) as approver
       from users u
       where u.id <> $2 and (
         exists (select 1 from contributions c where c.pool_id = $1 and c.user_id = u.id)
         or exists (select 1 from pool_divers d where d.pool_id = $1 and d.user_id = u.id)
         or exists (select 1 from pool_members m where m.pool_id = $1 and m.user_id = u.id)
         or exists (select 1 from pool_approvers a where a.pool_id = $1 and a.user_id = u.id))`,
      [row.id, row.admin_user_id],
    );
    if (people.length === 0) return;
    const ctx = this.context(appUrl);
    // Approvers and people who've paid follow the pool; the rest can still pay.
    const following = (u: { paid: boolean; approver: boolean }) => u.paid || u.approver;
    const message = {
      title: `📅 ${row.emoji} ${row.name} has a new deadline`,
      body: `${p.lifeguardName} gave it more time, until ${dayIn(row.deadline, ctx.timeZone)}.`,
    };
    await this.push?.toUsers(people.filter(following).map((u) => u.id), { ...message, url: `/pools/${row.id}` });
    await this.push?.toUsers(people.filter((u) => !following(u)).map((u) => u.id), { ...message, url: `/p/${row.code}` });
    await this.mail.send(
      people.flatMap((u) =>
        u.email
          ? [
              email(u.email, `extended:${row.id}:${row.deadline.toISOString()}:${u.id}`, deadlineExtendedEmail({
                poolName: row.name,
                poolId: row.id,
                code: row.code,
                lifeguardName: p.lifeguardName,
                deadline: row.deadline,
                paid: following(u),
              }, ctx)),
            ]
          : [],
      ),
    );
  }

  /** Tells refunded PoolFi users their money is back. */
  async refunded(poolId: string, refunds: { userId: string; amount: bigint }[]) {
    if (refunds.length === 0) return;
    const [pool] = await this.db.query<{ name: string }>("select name from pools where id = $1", [poolId]);
    if (!pool) return;
    const people = await this.people(refunds.map((r) => r.userId));
    for (const r of refunds) {
      await this.push?.toUsers([r.userId], {
        title: "↩️ You've been refunded",
        body: `${usdc(toUsdc(r.amount))} from ${pool.name} is back in your PoolFi balance.`,
        url: "/wallet",
      });
    }
    const ctx = this.context(null);
    await this.mail.send(
      refunds.flatMap((r) => {
        const person = people.get(r.userId);
        return person?.email
          ? [email(person.email, `refund:${poolId}:${r.userId}`, refundEmail({ poolName: pool.name, amount: toUsdc(r.amount) }, ctx))]
          : [];
      }),
    );
  }

  private context(appUrl: string | null): EmailContext {
    return { appUrl: this.defaults.appUrl ?? appUrl, timeZone: this.defaults.timeZone };
  }

  private async people(ids: string[]): Promise<Map<string, PersonRow>> {
    const rows = await this.db.query<PersonRow>("select * from users where id = any($1::text[])", [[...new Set(ids)]]);
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async approverIds(poolId: string): Promise<string[]> {
    const rows = await this.db.query<{ user_id: string }>(
      "select user_id from pool_approvers where pool_id = $1 order by position",
      [poolId],
    );
    return rows.map((r) => r.user_id);
  }
}

/** "Fri 7 Nov", for a device notification. */
function dayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(date);
}

function email(to: string, key: string, rendered: Rendered): Email {
  return { to, key, ...rendered };
}
