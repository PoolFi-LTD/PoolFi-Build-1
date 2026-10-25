import { describe, expect, it, vi } from "vitest";
import { ResendMailer, type Email } from "../../src/email/mailer.ts";
import {
  deadlineExtendedEmail,
  escapeHtml,
  goalMissedEmail,
  receiptEmail,
  reminderEmail,
  usdc,
} from "../../src/email/messages.ts";

const config = { resendApiKey: "re_test", from: "PoolFi <noreply@example.com>", replyTo: null, timeZone: "Africa/Lagos" };
const log = { info: vi.fn(), warn: vi.fn() };
const email = (n: number): Email => ({ to: `p${n}@example.com`, subject: `S${n}`, html: "<p>x</p>", text: "x", key: `k${n}` });

describe("ResendMailer", () => {
  it("sends a batch to Resend with the sender, recipient and an idempotency key", async () => {
    const post = vi.fn(async () => new Response("{}", { status: 200 }));
    await new ResendMailer(config, log, post as typeof fetch).send([email(1), email(2)]);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails/batch");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test");
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(String(init.body))).toEqual([
      { from: config.from, to: ["p1@example.com"], subject: "S1", html: "<p>x</p>", text: "x" },
      { from: config.from, to: ["p2@example.com"], subject: "S2", html: "<p>x</p>", text: "x" },
    ]);
  });

  it("splits more than 100 emails into batches and sends nothing for none", async () => {
    const post = vi.fn(async () => new Response("{}", { status: 200 }));
    const mailer = new ResendMailer(config, log, post as typeof fetch);
    await mailer.send([]);
    expect(post).not.toHaveBeenCalled();
    await mailer.send(Array.from({ length: 230 }, (_, i) => email(i)));
    expect(post.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).length)).toEqual([100, 100, 30]);
  });

  it("never throws: a refused or failed send is logged", async () => {
    const refused = vi.fn(async () => new Response('{"message":"domain not verified"}', { status: 403 }));
    await expect(new ResendMailer(config, log, refused as typeof fetch).send([email(1)])).resolves.toBeUndefined();
    const broken = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(new ResendMailer(config, log, broken as typeof fetch).send([email(1)])).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(2);
    // Addresses aren't logged.
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("p1@example.com");
  });
});

describe("messages", () => {
  const ctx = { appUrl: "https://thepoolfi.com/", timeZone: "Africa/Lagos" };

  it("escapes names people typed", () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe("&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;");
    const r = reminderEmail(
      { poolName: "<script>x</script>", poolEmoji: "🎓", code: "PF-7K2Q", lifeguardName: "Judith", diverName: "Ada <i>Eze</i>", share: 1.5, deadline: new Date("2026-10-28T12:00:00Z") },
      ctx,
    );
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).not.toContain("<i>");
  });

  it("links to the app and writes amounts and dates for Lagos", () => {
    const r = receiptEmail(
      { poolName: "300L Class Dues", poolEmoji: "🎓", lifeguardName: "Judith Okafor", diverName: "Dayo Okeke", amount: 1.58, ref: "PF-R-7K2Q-0001", paidAt: new Date("2026-10-21T15:02:00Z") },
      ctx,
    );
    expect(r.subject).toBe("Receipt: 1.58 USDC paid into 300L Class Dues");
    expect(r.html).toContain('href="https://thepoolfi.com/receipts/PF-R-7K2Q-0001"');
    expect(r.html).toContain('href="https://thepoolfi.com/r/PF-R-7K2Q-0001"');
    expect(r.html).toContain("paid to 300L Class Dues");
    expect(r.text).toContain("Check it at https://thepoolfi.com/r/PF-R-7K2Q-0001");
    expect(r.text).toContain("Date: 21 Oct 2026, 16:02");
    expect(usdc(2171.3)).toBe("2,171.30 USDC");
  });

  it("asks the lifeguard to extend or refund when the deadline passes below the goal", () => {
    const r = goalMissedEmail(
      { poolName: "Lab coats", poolId: "p1", raised: 96, goal: 150, paidCount: 16, expectedCount: 25, deadline: new Date("2026-10-25T22:59:00Z") },
      ctx,
    );
    expect(r.subject).toBe("Lab coats missed its deadline");
    expect(r.text).toContain("16 of 25 divers paid");
    expect(r.text).toContain("Nothing is refunded until you decide");
    expect(r.text).toContain("Raised: 96.00 USDC");
    expect(r.text).toContain("Deadline: 25 Oct 2026, 23:59");
    expect(r.html).toContain('href="https://thepoolfi.com/pools/p1"');
  });

  it("sends divers who paid to the pool, and the rest to pay, when the deadline moves", () => {
    const base = { poolName: "Lab coats", poolId: "p1", code: "PF-LC32", lifeguardName: "Judith", deadline: new Date("2026-11-01T22:59:00Z") };
    const paid = deadlineExtendedEmail({ ...base, paid: true }, ctx);
    const unpaid = deadlineExtendedEmail({ ...base, paid: false }, ctx);
    expect(paid.subject).toBe("Lab coats has a new deadline");
    expect(paid.text).toContain("The new deadline is 1 Nov 2026, 23:59.");
    expect(paid.html).toContain('href="https://thepoolfi.com/pools/p1"');
    expect(unpaid.html).toContain('href="https://thepoolfi.com/p/PF-LC32"');
    expect(unpaid.text).toContain("still time to pay your share");
  });

  it("leaves the button out when the app's address isn't known", () => {
    const r = reminderEmail(
      { poolName: "Dues", poolEmoji: "🎓", code: "PF-7K2Q", lifeguardName: "Judith", diverName: "Ada", share: 1, deadline: new Date() },
      { appUrl: null, timeZone: "Africa/Lagos" },
    );
    expect(r.html).not.toContain("<a ");
    expect(r.text).not.toContain("Pay your share:");
  });
});

describe("Push", () => {
  it("drops devices the push service says are gone, and never throws", async () => {
    const { Push } = await import("../../src/services/push.ts");
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql.split(" ")[0] ?? "");
        return sql.startsWith("select")
          ? [
              { id: "a", endpoint: "https://push.example.com/a", p256dh: "k", auth: "x" },
              { id: "b", endpoint: "https://push.example.com/b", p256dh: "k", auth: "x" },
              { id: "c", endpoint: "https://push.example.com/c", p256dh: "k", auth: "x" },
            ]
          : [];
      },
    };
    const send = vi.fn(async (target: { endpoint: string }) => {
      if (target.endpoint.endsWith("/b")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (target.endpoint.endsWith("/c")) throw Object.assign(new Error("busy"), { statusCode: 503 });
      return { statusCode: 201 };
    });
    const push = new Push(db as never, null, log, send);
    await expect(push.toUsers(["u1", "u1"], { title: "t", body: "b", url: "/" })).resolves.toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
    // One delivered (last-sent update), one forgotten (410), the 503 only logged.
    expect(queries.filter((q) => q === "delete")).toHaveLength(1);
    expect(queries.filter((q) => q === "update")).toHaveLength(1);
  });
});
