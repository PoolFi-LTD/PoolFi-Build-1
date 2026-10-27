/**
 * The admin dashboard on Stellar testnet: only the team on ADMIN_EMAILS gets in; it
 * shows people, pools and USDC across PoolFi; and its fixes (moving a deadline or
 * closing a pool with the lifeguard's wallet, suspending, unlocking or signing out an
 * account, putting a wallet on Stellar) each land in the admin log.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type TestUser } from "./harness.ts";

let h: Harness;
const people: Record<"admin" | "ops" | "lifeguard" | "ada" | "sam", TestUser> = {} as never;
let pool: { id: string; code: string };

const app = (method: "GET" | "POST", path: string, user?: TestUser, body?: unknown) => h.call(method, `/v1/app${path}`, user, body);
const admin = (method: "GET" | "POST", path: string, body?: unknown, user: TestUser = people.admin) => h.call(method, `/v1/admin${path}`, user, body);
const inDays = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

beforeAll(async () => {
  h = await startHarness();
  const names = { admin: "Ade Admin", ops: "Ope Ops", lifeguard: "Judith Okafor", ada: "Ada Eze", sam: "Sam Stranger" };
  for (const [key, name] of Object.entries(names) as [keyof typeof people, string][]) {
    people[key] = await h.signIn(key);
    expect((await app("GET", "/me", people[key])).status).toBe(200);
    const [firstName, lastName] = name.split(" ");
    await h.app.inject({
      method: "PUT",
      url: "/v1/app/me/profile",
      headers: people[key].headers,
      payload: { firstName, lastName, avatar: { kind: "emoji", emoji: "🌻", bg: "#F4E8D2" } },
    });
  }
  expect((await app("POST", "/wallet/deposits", people.ada, { amount: 2 })).status).toBe(201);
  const created = await app("POST", "/pools", people.lifeguard, {
    type: "Class dues", emoji: "🎓", name: "Class Dues", amount: 1, feeCoveredByDivers: false, expectedCount: 3,
    deadline: inDays(2), approverIds: [], members: [], pickYourName: false, allowNotOnList: true, diversCanShare: true,
  });
  expect(created.status).toBe(201);
  pool = { id: created.body.id, code: created.body.code };
  expect((await app("POST", `/invites/${pool.code}/pay`, people.ada, { name: "Ada Eze" })).status).toBe(201);
});

afterAll(async () => {
  await h?.close();
});

describe("who gets in", () => {
  it("is only the team on ADMIN_EMAILS, signed in", async () => {
    expect((await h.call("GET", "/v1/admin/overview")).status).toBe(401);
    const refused = await admin("GET", "/overview", undefined, people.lifeguard);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("not_admin");
    expect((await admin("GET", "/overview")).status).toBe(200);
    expect((await app("GET", "/me", people.admin)).body.admin).toBe(true);
    expect((await app("GET", "/me", people.lifeguard)).body.admin).toBe(false);
  });
});

describe("what the team sees", () => {
  it("sums up PoolFi on the front page", async () => {
    const { body } = await admin("GET", "/overview");
    expect(body.chain).toMatchObject({ network: "Stellar testnet", explorer: "https://stellar.expert/explorer/testnet" });
    expect(body.kpis).toMatchObject({ users: 5, pools: 1, poolsOpen: 1, collected: 1, payments: 1, deposited: 2, deposits: 1, inPools: 1 });
    const titles = (body.events as { title: string }[]).map((e) => e.title);
    expect(titles).toContain("Ada Eze paid into Class Dues");
    expect(titles).toContain("Ada Eze added USDC to their wallet");
  });

  it("shows a person with their wallet, its USDC and their payments", async () => {
    const found = await admin("GET", "/users?q=eze");
    expect(found.body.users).toMatchObject([{ name: "Ada Eze", paid: 1, deposited: 2, payments: 1, wallet: { activated: true } }]);
    const ada = await admin("GET", `/users/${people.ada.id}`);
    expect(ada.body).toMatchObject({ balance: 1, sessions: 1 });
    expect(ada.body.contributionList).toMatchObject([{ amount: 1, pool: { name: "Class Dues" } }]);
    expect(ada.body.depositList).toMatchObject([{ amount: 2 }]);
  });

  it("shows a pool with what the contract says and every transaction", async () => {
    expect((await admin("GET", "/pools?status=active")).body.pools).toMatchObject([{ id: pool.id, raised: 1, goal: 3, paidCount: 1 }]);
    const detail = await admin("GET", `/pools/${pool.id}`);
    expect(detail.body.ledger).toMatchObject({ status: "open", contributed: 1, goal: 3, members: 1 });
    expect(detail.body.transactions.map((t: { kind: string }) => t.kind)).toEqual(["created", "joined", "contributed"]);
    expect(detail.body.transactions.every((t: { hash: string }) => /^[0-9a-f]{64}$/.test(t.hash))).toBe(true);
  });
});

describe("pools the team fixes", () => {
  it("gives a pool more time, signed with the lifeguard's wallet", async () => {
    const extended = await admin("POST", `/pools/${pool.id}/extend`, { deadline: inDays(4), reason: "The lifeguard asked by phone" });
    expect(extended.status).toBe(200);
    expect(new Date(extended.body.ledger.deadline).getTime()).toBeGreaterThan(Date.now() + 3 * 24 * 3600 * 1000);
    expect(extended.body.activity[0].title).toBe("PoolFi extended the deadline for Class Dues");
    expect(extended.body.transactions.map((t: { kind: string }) => t.kind)).toContain("extended");
    expect(extended.body.log[0]).toMatchObject({ action: "extend_pool", reason: "The lifeguard asked by phone" });
  });

  it("closes a pool and refunds everyone who paid", async () => {
    const closed = await admin("POST", `/pools/${pool.id}/close`, { reason: "Reported as a scam" });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: "refunded", ledger: { status: "refunded", refunded: 1 } });
    expect(closed.body.refundList).toMatchObject([{ user: { name: "Ada Eze" }, amount: 1 }]);
    expect(closed.body.activity[0].title).toBe("PoolFi closed Class Dues, so everyone who paid gets their USDC back");
    expect((await app("GET", "/wallet", people.ada)).body.balance).toBe(2);
    // Sending what's left again refunds nobody twice.
    expect((await admin("POST", `/pools/${pool.id}/refunds/retry`)).body.refundList).toHaveLength(1);
    expect((await admin("GET", "/money")).body.refunding).toEqual([]);
    expect((await admin("POST", `/pools/${pool.id}/extend`, { deadline: inDays(5) })).body.error.code).toBe("pool_refunded");
  });
});

describe("accounts the team fixes", () => {
  it("puts a wallet on Stellar that wasn't yet", async () => {
    // As if the activation when Sam signed up had stopped part way.
    await h.db.query("update wallets set activated_at = null where user_id = $1", [people.sam.id]);
    expect((await admin("GET", `/users/${people.sam.id}`)).body.wallet).toMatchObject({ activated: false });
    expect((await admin("GET", "/money")).body.wallets).toMatchObject([{ user: { name: "Sam Stranger" } }]);
    const activated = await admin("POST", `/users/${people.sam.id}/wallet/activate`);
    expect(activated.status).toBe(200);
    expect(activated.body.wallet).toMatchObject({ activated: true });
    expect((await admin("GET", "/money")).body.wallets).toEqual([]);
  });

  it("suspends an account and lifts it", async () => {
    expect((await admin("POST", `/users/${people.ops.id}/suspend`, { reason: "Testing" })).body.error.code).toBe("cannot_suspend_admin");
    const suspended = await admin("POST", `/users/${people.sam.id}/suspend`, { reason: "Chargebacks" });
    expect(suspended.body).toMatchObject({ suspended: true, sessions: 0 });
    expect((await h.call("POST", "/v1/auth/code", people.sam)).body.error.code).toBe("account_suspended");
    await h.db.query("insert into verified_sessions (session_id, user_id) values ($1, $2) on conflict do nothing", [people.sam.sessionId, people.sam.id]);
    expect((await app("GET", "/home", people.sam)).body.error.code).toBe("account_suspended");
    expect((await admin("POST", `/users/${people.sam.id}/unsuspend`)).body.suspended).toBe(false);
    expect((await app("GET", "/home", people.sam)).status).toBe(200);
  });

  it("unlocks an account and signs a person out everywhere", async () => {
    for (let i = 0; i < 5; i++) await h.call("POST", "/v1/auth/failed", undefined, { email: "ada@example.com" });
    expect((await admin("GET", "/users?filter=locked")).body.users.map((u: { name: string }) => u.name)).toEqual(["Ada Eze"]);
    expect((await admin("POST", `/users/${people.ada.id}/unlock`)).body.locked).toBe(false);
    expect((await admin("POST", `/users/${people.ada.id}/sign-out`)).body.sessions).toBe(0);
    expect((await app("GET", "/home", people.ada)).body.error.code).toBe("verification_required");
  });
});

describe("the admin log", () => {
  it("runs the refund job on demand, and keeps everything the team did", async () => {
    expect((await admin("POST", "/jobs/refunds")).status).toBe(200);
    const log = (await admin("GET", "/log")).body as { action: string; admin: { email: string } }[];
    expect(log.map((a) => a.action)).toEqual([
      "run_refund_job",
      "sign_out_user",
      "unlock_user",
      "unsuspend_user",
      "suspend_user",
      "activate_wallet",
      "retry_refunds",
      "close_pool",
      "extend_pool",
    ]);
    expect(log.every((a) => a.admin.email === "admin@example.com")).toBe(true);
  });
});
