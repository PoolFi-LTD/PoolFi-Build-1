import type { Db } from "../../db.ts";
import type { Email, Mailer } from "../../email/mailer.ts";
import {
  approvalNeededEmail,
  goalMetEmail,
  paidOutEmail,
  payoutDeclinedEmail,
  receiptEmail,
  refundEmail,
  reminderEmail,
  type EmailContext,
  type Rendered,
} from "../../email/messages.ts";
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

  async paidOut(row: AppPoolRow, p: { gross: bigint; net: bigint; reference: string }, appUrl: string | null) {
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

  async reminders(row: AppPoolRow, recipients: ReminderRecipient[], appUrl: string | null) {
    if (recipients.length === 0) return;
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
  }

  /** Tells refunded PoolFi users their money is back. */
  async refunded(poolId: string, refunds: { userId: string; amount: bigint }[]) {
    if (refunds.length === 0) return;
    const [pool] = await this.db.query<{ name: string }>("select name from pools where id = $1", [poolId]);
    if (!pool) return;
    const people = await this.people(refunds.map((r) => r.userId));
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

function email(to: string, key: string, rendered: Rendered): Email {
  return { to, key, ...rendered };
}
