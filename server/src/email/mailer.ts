import { createHash } from "node:crypto";
import type { Config } from "../config.ts";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend drops a repeat with the same key for 24 hours, so a retried action doesn't email twice. */
  key: string;
}

export interface Mailer {
  /** Sends what it can. Failures are logged, never thrown: an email never stops a payment or payout. */
  send(emails: Email[]): Promise<void>;
}

interface Logger {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

const BATCH_URL = "https://api.resend.com/emails/batch";
/** Resend's most per batch call. */
const BATCH_SIZE = 100;
const TIMEOUT_MS = 8_000;

/** Sends through Resend's API (https://resend.com/docs/api-reference/emails/send-batch-emails). */
export class ResendMailer implements Mailer {
  constructor(
    private readonly config: NonNullable<Config["email"]>,
    private readonly log: Logger,
    private readonly post: typeof fetch = fetch,
  ) {}

  async send(emails: Email[]): Promise<void> {
    for (let start = 0; start < emails.length; start += BATCH_SIZE) {
      const batch = emails.slice(start, start + BATCH_SIZE);
      const idempotencyKey = createHash("sha256")
        .update(batch.map((e) => e.key).join("\n"))
        .digest("hex");
      try {
        const response = await this.post(BATCH_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.resendApiKey}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify(
            batch.map((e) => ({
              from: this.config.from,
              to: [e.to],
              subject: e.subject,
              html: e.html,
              text: e.text,
              ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}),
            })),
          ),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.ok) {
          this.log.info({ count: batch.length }, "emails sent");
        } else {
          const reason = (await response.text().catch(() => "")).slice(0, 300);
          this.log.warn({ count: batch.length, status: response.status, reason }, "emails not sent");
        }
      } catch (error) {
        this.log.warn({ count: batch.length, error: String(error) }, "emails not sent");
      }
    }
  }
}

/** Without Resend set up, emails are skipped. */
export const noMailer: Mailer = { send: async () => {} };

export function createMailer(config: Config["email"], log: Logger): Mailer {
  return config ? new ResendMailer(config, log) : noMailer;
}
