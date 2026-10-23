/**
 * The web app's API (/v1/app) on Stellar testnet: a lifeguard makes a pool with
 * approvers, divers pay their share by invite link, and the payout goes out once
 * a majority of approvers agree, less PoolFi's fee.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type TestUser } from "./harness.ts";

let h: Harness;
let bps: number;
const people: Record<"lifeguard" | "ada" | "tobi" | "zainab" | "dayo" | "emeka" | "stranger", TestUser> = {} as never;

/** Subjects of the emails sent to `to` so far. */
const inbox = (to: string) => h.emails.filter((e) => e.to === to).map((e) => e.subject);
const inDays = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
const app = (method: "GET" | "POST", path: string, user?: TestUser, body?: unknown) => h.call(method, `/v1/app${path}`, user, body);
const put = async (path: string, user: TestUser, body: unknown) => {
  const response = await h.app.inject({ method: "PUT", url: `/v1/app${path}`, headers: user.headers, payload: body as object });
  return { status: response.statusCode, body: response.json() };
};

beforeAll(async () => {
  h = await startHarness();
  bps = (await h.contract.fee())?.bps ?? 0;
  const names = { lifeguard: "Judith Okafor", ada: "Ada Eze", tobi: "Tobi Bello", zainab: "Zainab Musa", dayo: "Dayo Okeke", emeka: "Emeka Obi", stranger: "Sam Stranger" };
  for (const [key, name] of Object.entries(names) as [keyof typeof people, string][]) {
    const user = await h.signIn(key);
    people[key] = user;
    // Signing in makes the wallet; the profile screen saves the name.
    expect((await app("GET", "/me", user)).status).toBe(200);
    const [firstName, lastName] = name.split(" ");
    const saved = await put("/me/profile", user, { firstName, lastName, avatar: { kind: "emoji", emoji: "🌻", bg: "#F4E8D2" } });
    expect(saved.body).toMatchObject({ id: user.id, firstName, lastName, email: `${key}@example.com` });
  }
});

afterAll(async () => {
  await h?.close();
});

describe("a pool with approvers", () => {
  let pool: { id: string; code: string };
  let shareBase: number;
  const diverId = async (name: string) => {
    const invite = await app("GET", `/invites/${pool.code}`);
    return (invite.body.names as { id: string; name: string }[]).find((n) => n.name === name)?.id ?? "";
  };

  it("is created with its member list, approvers and a share that covers the fee", async () => {
    const created = await app("POST", "/pools", people.lifeguard, {
      type: "Class dues",
      emoji: "🎓",
      name: "300L Class Dues",
      amount: 1.43,
      feeCoveredByDivers: true,
      expectedCount: 2,
      deadline: inDays(3),
      approverIds: [people.ada.id, people.tobi.id, people.zainab.id],
      members: [
        { name: "Dayo Okeke", contact: "+234 803 555 0100" },
        { name: "Emeka Obi", contact: "emeka.list@example.com" },
      ],
      pickYourName: true,
      allowNotOnList: true,
      diversCanShare: true,
    });
    expect(created.status).toBe(201);
    const p = created.body;
    pool = { id: p.id, code: p.code };
    // 1.43 grossed up for the fee, rounded up to the cent: 1.51 at 5%.
    const shareCents = bps > 0 ? Math.ceil((143 * 10_000) / (10_000 - bps)) : 143;
    shareBase = shareCents * 100_000;
    expect(p).toMatchObject({
      code: expect.stringMatching(/^PF-[A-Z2-9]{4}$/),
      role: "lifeguard",
      status: "active",
      share: shareCents / 100,
      goal: (shareCents * 2) / 100,
      raised: 0,
      paidCount: 0,
      expectedCount: 2,
      feeBps: bps,
      feeCoveredByDivers: true,
      approvalsNeeded: 2,
      payout: null,
      lifeguard: { id: people.lifeguard.id, name: "Judith Okafor" },
    });
    expect(p.approvers.map((a: { name: string; status: string }) => [a.name, a.status])).toEqual([
      ["Ada Eze", "waiting"],
      ["Tobi Bello", "waiting"],
      ["Zainab Musa", "waiting"],
    ]);
    // The lifeguard sees contacts; the list keeps its order.
    expect(p.divers.map((d: { name: string; contact: string | null }) => [d.name, d.contact])).toEqual([
      ["Dayo Okeke", "+234 803 555 0100"],
      ["Emeka Obi", "emeka.list@example.com"],
    ]);
    expect(p.activity.map((a: { title: string }) => a.title)).toEqual(["You created 300L Class Dues"]);

    // On-chain: the goal, and the approvers' wallets.
    const state = await h.contract.getPool(BigInt((await h.db.query<{ chain_pool_id: string }>("select chain_pool_id from pools where id = $1", [p.id]))[0]!.chain_pool_id));
    expect(state.goalAmount).toBe(BigInt(shareBase * 2));
    expect(state.approvers).toHaveLength(3);
  });

  it("refuses approvers who are the lifeguard or can't approve", async () => {
    const base = { type: "Birthday", emoji: "🎂", name: "Nope", amount: 1, feeCoveredByDivers: false, expectedCount: 1, deadline: inDays(1), members: [], pickYourName: true, allowNotOnList: true, diversCanShare: true };
    for (const approverIds of [[people.lifeguard.id], ["nobody-with-a-wallet"], [people.ada.id, people.ada.id]]) {
      const refused = await app("POST", "/pools", people.lifeguard, { ...base, approverIds });
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe("invalid_approvers");
    }
    expect((await app("POST", "/pools", people.lifeguard, { ...base, amount: 1.234, approverIds: [] })).body.error.code).toBe("invalid_request");
  });

  it("shows the invite link to anyone, names only", async () => {
    const invite = await app("GET", `/invites/${pool.code.toLowerCase()}`);
    expect(invite.status).toBe(200);
    expect(invite.body).toMatchObject({
      pool: { id: pool.id, code: pool.code, name: "300L Class Dues", status: "active", approverCount: 3, pickYourName: true },
      lifeguard: { name: "Judith Okafor" },
    });
    expect(invite.body.names).toEqual([
      { id: expect.any(String), name: "Dayo Okeke", paid: false },
      { id: expect.any(String), name: "Emeka Obi", paid: false },
    ]);
    expect((await app("GET", "/invites/PF-0000")).status).toBe(404);
  });

  it("keeps pools private to the people in them", async () => {
    expect((await app("GET", `/pools/${pool.id}`, people.stranger)).status).toBe(404);
    expect((await app("GET", `/pools/${pool.id}`)).status).toBe(401);
    expect((await app("GET", `/pools/${pool.id}`, people.ada)).body.role).toBe("approver");
  });

  it("takes a diver's share from their wallet and gives them a receipt", async () => {
    const deposited = await app("POST", "/wallet/deposits", people.dayo, { amount: 5 });
    expect(deposited.status).toBe(201);
    expect(deposited.body).toMatchObject({ balance: 5, network: "Stellar testnet" });
    expect(deposited.body.transactions[0]).toMatchObject({ kind: "deposit", title: "USDC deposit", amount: 5, direction: "in" });

    const paid = await app("POST", `/invites/${pool.code}/pay`, people.dayo, { diverId: await diverId("Dayo Okeke") });
    expect(paid.status).toBe(201);
    const suffix = pool.code.slice(3);
    expect(paid.body).toEqual({
      receiptRef: `PF-R-${suffix}-0001`,
      amount: shareBase / 1e7,
      poolId: pool.id,
      badges: ["⚡ Early diver badge"],
    });

    const again = await app("POST", `/invites/${pool.code}/pay`, people.dayo, { name: "Dayo again" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_paid");

    const wallet = await app("GET", "/wallet", people.dayo);
    expect(wallet.body.balance).toBeCloseTo(5 - shareBase / 1e7, 7);
    expect(wallet.body.transactions[0]).toMatchObject({ kind: "contribution", title: "Paid into 300L Class Dues", direction: "out" });

    const view = await app("GET", `/pools/${pool.id}`, people.dayo);
    expect(view.body).toMatchObject({ role: "diver", youPaid: true, paidCount: 1, yourReceiptRef: `PF-R-${suffix}-0001` });
    // Divers don't see other people's contacts.
    expect(view.body.divers.every((d: { contact: string | null }) => d.contact === null)).toBe(true);
    expect(view.body.activity[0].title).toBe("You paid into 300L Class Dues");

    expect(inbox("dayo@example.com")).toEqual([`Receipt: ${(shareBase / 1e7).toFixed(2)} USDC paid into 300L Class Dues`]);
    const mail = h.emails.find((e) => e.to === "dayo@example.com");
    expect(mail?.text).toContain(`PF-R-${suffix}-0001`);
    expect(mail?.text).toContain("Paid by: Dayo Okeke");

    const receipt = await app("GET", `/receipts/PF-R-${suffix}-0001`);
    expect(receipt.body).toMatchObject({ paidBy: "Dayo Okeke", poolName: "300L Class Dues", lifeguardName: "Judith Okafor", status: "confirmed", amount: shareBase / 1e7 });
    expect((await app("GET", `/receipts/PF-R-${suffix}-9999`)).status).toBe(404);
  });

  it("lets the lifeguard remind everyone who hasn't paid", async () => {
    expect((await app("POST", `/pools/${pool.id}/reminders`, people.dayo)).status).toBe(403);
    const reminded = await app("POST", `/pools/${pool.id}/reminders`, people.lifeguard);
    expect(reminded.body).toMatchObject({ count: 1, emailed: 1 });
    // Emeka's contact on the list is an email address, so the reminder went there too.
    const reminder = h.emails.find((e) => e.to === "emeka.list@example.com");
    expect(reminder?.subject).toBe(`Reminder: your ${(shareBase / 1e7).toFixed(2)} USDC for 300L Class Dues`);
    expect(reminder?.html).toContain(`/p/${pool.code}`);
    // Tapping Remind again doesn't email them again so soon.
    expect((await app("POST", `/pools/${pool.id}/reminders`, people.lifeguard)).body).toMatchObject({ count: 1, emailed: 0 });
    expect(reminded.body.message).toContain(`/p/${pool.code}`);
    const view = await app("GET", `/pools/${pool.id}`, people.lifeguard);
    expect(view.body.divers.find((d: { name: string }) => d.name === "Emeka Obi").lastRemindedAt).not.toBeNull();
    expect(view.body.activity[0].title).toBe("You reminded 1 diver in 300L Class Dues");
  });

  it("frees a name again when its payment fails, and meets the goal with the last share", async () => {
    const emeka = await diverId("Emeka Obi");
    const broke = await app("POST", `/invites/${pool.code}/pay`, people.emeka, { diverId: emeka });
    expect(broke.status).toBe(400);
    expect(broke.body.error).toMatchObject({ code: "insufficient_funds", details: { balance: 0, needed: shareBase / 1e7 } });
    const [held] = await h.db.query<{ user_id: string | null; paying_at: Date | null }>("select user_id, paying_at from pool_divers where id = $1", [emeka]);
    expect(held).toEqual({ user_id: null, paying_at: null });

    await app("POST", "/wallet/deposits", people.emeka, { amount: 2 });
    const paid = await app("POST", `/invites/${pool.code}/pay`, people.emeka, { diverId: emeka });
    expect(paid.status).toBe(201);
    expect(paid.body.receiptRef).toBe(`PF-R-${pool.code.slice(3)}-0002`);

    const view = await app("GET", `/pools/${pool.id}`, people.lifeguard);
    expect(view.body).toMatchObject({ status: "met", paidCount: 2, raised: (shareBase * 2) / 1e7 });
    expect(view.body.activity[0]).toMatchObject({ kind: "goal_met", title: "300L Class Dues reached its goal" });

    expect(inbox("lifeguard@example.com")).toEqual(["300L Class Dues reached its goal 🎉"]);

    const home = await app("GET", "/home", people.lifeguard);
    expect(home.body.alerts).toEqual([{ kind: "goal_met", poolId: pool.id, poolName: "300L Class Dues" }]);
    expect(home.body).toMatchObject({ activePools: 1, contributionsIn: 2, contributionsExpected: 2 });
  });

  it("asks the approvers for the payout, and an approver can turn it down", async () => {
    expect((await app("POST", `/pools/${pool.id}/payout`, people.ada, { destination: "wallet" })).body.error.code).toBe("not_pool_admin");
    expect((await app("POST", `/pools/${pool.id}/payout`, people.lifeguard, { destination: "bank" })).body.error.code).toBe("coming_soon");

    const requested = await app("POST", `/pools/${pool.id}/payout`, people.lifeguard, { destination: "wallet" });
    expect(requested.status).toBe(200);
    const gross = shareBase * 2;
    const fee = Math.floor((gross * bps) / 10_000);
    expect(requested.body).toMatchObject({
      status: "approval",
      payout: { destination: "wallet", approvalsNeeded: 2, approvals: 0, paidAt: null, gross: gross / 1e7, fee: fee / 1e7, net: (gross - fee) / 1e7 },
    });

    for (const approver of ["ada", "tobi", "zainab"]) {
      expect(inbox(`${approver}@example.com`)).toEqual(["Judith Okafor needs your approval for 300L Class Dues"]);
    }

    const adaHome = await app("GET", "/home", people.ada);
    expect(adaHome.body.alerts).toEqual([{ kind: "approval_needed", poolId: pool.id, poolName: "300L Class Dues", requester: "Judith" }]);

    // Payments wait while the payout does.
    const late = await app("POST", `/invites/${pool.code}/pay`, people.stranger, { name: "Sam Stranger" });
    expect(late.body.error.code).toBe("payout_pending");

    expect((await app("POST", `/pools/${pool.id}/payout/approve`, people.dayo)).body.error.code).toBe("not_approver");
    const declined = await app("POST", `/pools/${pool.id}/payout/decline`, people.ada, { reason: "Wrong account" });
    expect(declined.body).toMatchObject({ status: "met", payout: { declinedBy: { name: "Ada Eze", reason: "Wrong account" } } });
    expect(declined.body.approvers[0]).toMatchObject({ name: "Ada Eze", status: "declined" });
    expect(inbox("lifeguard@example.com")).toContain("Ada Eze declined the payout for 300L Class Dues");
    expect((await app("GET", "/home", people.ada)).body.alerts).toEqual([]);
  });

  it("pays out once a majority approves, less PoolFi's fee", async () => {
    const again = await app("POST", `/pools/${pool.id}/payout`, people.lifeguard, { destination: "wallet" });
    expect(again.body).toMatchObject({ status: "approval", payout: { approvals: 0, declinedBy: null } });
    expect(again.body.approvers.map((a: { status: string }) => a.status)).toEqual(["waiting", "waiting", "waiting"]);

    const first = await app("POST", `/pools/${pool.id}/payout/approve`, people.ada);
    expect(first.body).toMatchObject({ status: "approval", payout: { approvals: 1 } });
    expect((await app("POST", `/pools/${pool.id}/payout/approve`, people.ada)).body.error.code).toBe("already_approved");

    const second = await app("POST", `/pools/${pool.id}/payout/approve`, people.zainab);
    const gross = shareBase * 2;
    const net = gross - Math.floor((gross * bps) / 10_000);
    expect(second.body).toMatchObject({
      status: "paidout",
      payout: { approvals: 2, paidAt: expect.any(String), reference: `PF-ST-${pool.code.slice(3)}`, net: net / 1e7 },
      closedAt: expect.any(String),
    });
    expect(second.body.activity[0]).toMatchObject({ kind: "payout", title: "300L Class Dues paid out to Judith Okafor" });
    expect(inbox("lifeguard@example.com")).toContain(`${(net / 1e7).toFixed(2)} USDC from 300L Class Dues is in your PoolFi balance`);
    // Each request asked the approvers once.
    expect(inbox("tobi@example.com")).toHaveLength(2);

    const wallet = await app("GET", "/wallet", people.lifeguard);
    expect(wallet.body.balance).toBeCloseTo(net / 1e7, 7);
    expect(wallet.body.transactions[0]).toMatchObject({ kind: "payout", title: "Payout from 300L Class Dues", direction: "in" });

    const lifeguardFeed = await app("GET", "/activity", people.lifeguard);
    expect(lifeguardFeed.body[0].title).toBe("300L Class Dues paid out to you");

    const record = await app("GET", `/pools/${pool.id}/record`, people.lifeguard);
    expect(record.body.reference).toBe(`PF-ST-${pool.code.slice(3)}`);
    expect(record.body.rows.map((r: { name: string; status: string }) => [r.name, r.status])).toEqual([
      ["Dayo Okeke", "paid"],
      ["Emeka Obi", "paid"],
    ]);
  });

  it("lists the pool for everyone in it, and them as contacts", async () => {
    for (const [user, role] of [[people.lifeguard, "lifeguard"], [people.tobi, "approver"], [people.emeka, "diver"]] as const) {
      const pools = await app("GET", "/pools", user);
      expect(pools.body.map((p: { id: string; role: string }) => [p.id, p.role])).toContainEqual([pool.id, role]);
    }
    expect((await app("GET", "/pools", people.stranger)).body).toEqual([]);

    const contacts = await app("GET", "/contacts", people.lifeguard);
    expect(contacts.body.map((c: { name: string }) => c.name)).toEqual(["Ada Eze", "Dayo Okeke", "Emeka Obi", "Tobi Bello", "Zainab Musa"]);
    expect(contacts.body[0]).toEqual({ userId: people.ada.id, name: "Ada Eze", detail: "From 300L Class Dues" });
  });

  it("keeps each diver's payment private unless the lifeguard lets divers see them", async () => {
    const own = await app("GET", `/pools/${pool.id}`, people.dayo);
    expect(own.body).toMatchObject({ diversSeePayments: false, paidCount: 2 });
    expect(own.body.divers.map((d: { name: string }) => d.name)).toEqual(["Dayo Okeke"]);
    expect(own.body.activity.filter((a: { kind: string }) => a.kind === "payment").map((a: { title: string }) => a.title)).toEqual([
      "You paid into 300L Class Dues",
    ]);
    expect((await app("GET", `/invites/${pool.code}`)).body.names.every((n: { paid: boolean }) => !n.paid)).toBe(true);
    // Approvers and the lifeguard always see everyone.
    expect((await app("GET", `/pools/${pool.id}`, people.tobi)).body.divers).toHaveLength(2);

    const refused = await h.app.inject({ method: "PATCH", url: `/v1/app/pools/${pool.id}/settings`, headers: people.dayo.headers, payload: { diversSeePayments: true } });
    expect(refused.statusCode).toBe(403);
    const opened = await h.app.inject({ method: "PATCH", url: `/v1/app/pools/${pool.id}/settings`, headers: people.lifeguard.headers, payload: { diversSeePayments: true } });
    expect(opened.json()).toMatchObject({ diversSeePayments: true });
    expect((await app("GET", `/pools/${pool.id}`, people.dayo)).body.divers).toHaveLength(2);
    expect((await app("GET", `/invites/${pool.code}`)).body.names.every((n: { paid: boolean }) => n.paid)).toBe(true);
  });

  it("fills the notifications inbox and marks it read", async () => {
    const inbox = await app("GET", "/notifications", people.lifeguard);
    const titles = inbox.body.items.map((n: { title: string }) => n.title);
    expect(titles).toContain("300L Class Dues is full! Request your payout when you're ready.");
    expect(titles).toContain("Zainab Musa approved the payout for 300L Class Dues.");
    expect(titles.some((t: string) => t.startsWith("Ada Eze declined the payout for 300L Class Dues"))).toBe(true);
    expect(inbox.body.unread).toBeGreaterThan(0);
    // Your own actions aren't news to you.
    expect(titles.some((t: string) => t.includes("You "))).toBe(false);

    await app("POST", "/notifications/read", people.lifeguard);
    expect((await app("GET", "/notifications", people.lifeguard)).body.unread).toBe(0);

    const diver = (await app("GET", "/notifications", people.dayo)).body.items.map((n: { title: string }) => n.title);
    expect(diver.some((t: string) => t.includes("was paid out to Judith Okafor"))).toBe(true);
  });

  it("earns badges for what people did", async () => {
    const earned = async (user: TestUser) =>
      (await app("GET", "/me/achievements", user)).body.badges.filter((b: { earned: boolean }) => b.earned).map((b: { id: string }) => b.id);
    expect(await earned(people.lifeguard)).toEqual(["first_pool", "full_pool"]);
    expect(await earned(people.zainab)).toEqual(["trusted"]);
    expect(await earned(people.dayo)).toEqual(["early", "stablecoins"]);
    expect((await app("GET", "/me/achievements", people.dayo)).body).toMatchObject({ streak: 1, emailVerified: true, remindersOn: true });

    const off = await h.app.inject({ method: "PUT", url: "/v1/app/me/preferences", headers: people.dayo.headers, payload: { remindersOn: false } });
    expect(off.json()).toMatchObject({ remindersOn: false });
  });
});
