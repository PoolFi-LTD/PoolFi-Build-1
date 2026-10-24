import webpush from "web-push";
import { z } from "zod";
import type { AuthUser } from "../auth.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import { ApiError } from "../errors.ts";

/** What a device shows: a title, a line of text, and where tapping it goes. */
export interface PushMessage {
  title: string;
  body: string;
  /** A path in the web app, e.g. /pools/<id>. */
  url: string;
  /** Notifications with the same tag replace each other instead of piling up. */
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Delivers one notification to one device; resolves with the push service's HTTP status. */
export type PushSender = (target: PushTarget, payload: string) => Promise<{ statusCode: number }>;

export const SubscriptionInput = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({ p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(128) }),
});

interface Logger {
  warn(details: object, message: string): void;
}

/** Notifications on people's devices (Web Push): phones and computers, even with PoolFi closed. */
export class Push {
  private readonly send: PushSender | null;

  constructor(
    private readonly db: Db,
    private readonly config: Config["push"],
    private readonly log: Logger,
    sender?: PushSender,
  ) {
    this.send =
      sender ??
      (config
        ? (target, payload) =>
            webpush.sendNotification(target, payload, {
              vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
              TTL: 24 * 3600,
              timeout: 8000,
            })
        : null);
  }

  /** The key browsers subscribe with; null when push isn't set up. */
  get publicKey(): string | null {
    return this.config?.publicKey ?? null;
  }

  /** Turns notifications on for this device. A device moves to whoever signed in on it last. */
  async subscribe(user: AuthUser, input: z.infer<typeof SubscriptionInput>, userAgent: string | null): Promise<void> {
    if (!this.send) throw new ApiError(503, "push_unavailable", "Device notifications aren't set up yet.");
    await this.db.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         user_agent = excluded.user_agent`,
      [user.id, input.endpoint, input.keys.p256dh, input.keys.auth, userAgent?.slice(0, 300) ?? null],
    );
  }

  async unsubscribe(user: AuthUser, endpoint: string): Promise<void> {
    await this.db.query("delete from push_subscriptions where endpoint = $1 and user_id = $2", [endpoint, user.id]);
  }

  /** Sends to every device of these users. Never throws: a notification never stops a payment. */
  async toUsers(userIds: string[], message: PushMessage): Promise<number> {
    const ids = [...new Set(userIds)];
    if (!this.send || ids.length === 0) return 0;
    const send = this.send;
    const devices = await this.db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
      "select id, endpoint, p256dh, auth from push_subscriptions where user_id = any($1::text[])",
      [ids],
    );
    const payload = JSON.stringify(message);
    const results = await Promise.allSettled(
      devices.map(async (d) => {
        try {
          await send({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload);
          await this.db.query("update push_subscriptions set last_sent_at = now() where id = $1", [d.id]);
          return true;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // The device unsubscribed or the browser was reset: forget it.
          if (status === 404 || status === 410) {
            await this.db.query("delete from push_subscriptions where id = $1", [d.id]);
          } else {
            this.log.warn({ status, error: String(error).slice(0, 200) }, "push notification not sent");
          }
          return false;
        }
      }),
    );
    return results.filter((r) => r.status === "fulfilled" && r.value).length;
  }
}
