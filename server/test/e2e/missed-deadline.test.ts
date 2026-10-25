/**
 * A pool that misses its deadline, through the web app's API on Stellar testnet:
 * nothing is refunded by itself. The lifeguard is told, then gives the pool more
 * time (as often as they like) or refunds everyone who paid.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type TestUser } from "./harness.ts";

let h: Harness;
const people: Record<"lifeguard" | "ada" | "tobi" | "zara", TestUser> = {} as never;
let pool: { id: string; code: string; chainPoolId: bigint };

const app = (method: "GET" | "POST", path: string, user?: TestUser, body?: unknown) => h.call(method, `/v1/app${path}`, user, body);
/** The shortest deadline the API allows, so the test can wait it out. */
const soon = () => new Date(Date.now() + 75_000).toISOString();
const phone = (key: string) => h.pushes.filter((p) => p.endpoint === `https://push.example.com/${key}`).map((p) => `${p.message.title} | ${p.message.body}`);
const inbox = (to: string) => h.emails.filter((e) => e.to === to).map((e) => e.subject);
const balance = async (user: TestUser) => (await app("GET", "/wallet", user)).body.balance as number;

/** Waits for the ledger clock to pass the pool's deadline. */
async function waitForExpiry() {
  for (let i = 0; (await h.contract.getPool(pool.chainPoolId)).status !== "expired"; i++) {
    if (i > 40) throw new Error("the pool never expired on-chain");
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

beforeAll(async () => {
  h = await startHarness();
  const names = { lifeguard: "Judith Okafor", ada: "Ada Eze", tobi: "Tobi Bello", zara: "Zara Musa" };
  for (const [key, name] of Object.entries(names) as [keyof typeof people, string][]) {
    const user = await h.signIn(key);
    people[key] = user;
    expect((await app("GET", "/me", user)).status).toBe(200);
    const [firstName, lastName] = name.split(" ");
    await h.app.inject({ method: "PUT", url: "/v1/app/me/profile", headers: user.headers, payload: { firstName, lastName, avatar: null } });
    const device = { endpoint: `https://push.example.com/${key}`, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlU", auth: "tBHItJI5svbpez7KI4CCXg" } };
    expect((await app("POST", "/push/subscriptions", user, device)).status).toBe(201);
  }
});

afterAll(async () => {
  await h?.close();
});

describe("a pool that misses its deadline", () => {
  it("waits for the lifeguard instead of refunding", async () => {
    expect((await app("POST", "/wallet/deposits", people.ada, { amount: 3 })).status).toBe(201);
    const created = await app("POST", "/pools", people.lifeguard, {
      type: "Class dues",
      emoji: "🥼",
      name: "Lab coats",
      amount: 1,
      feeCoveredByDivers: false,
      expectedCount: 3,
      deadline: soon(),
      approverIds: [people.tobi.id],
      members: [],
      pickYourName: false,
      allowNotOnList: true,
      diversCanShare: true,
    });
    expect(created.status).toBe(201);
    const [row] = await h.db.query<{ chain_pool_id: string }>("select chain_pool_id from pools where id = $1", [created.body.id]);
    pool = { id: created.body.id, code: created.body.code, chainPoolId: BigInt(row?.chain_pool_id ?? "0") };
    expect((await app("POST", `/invites/${pool.code}/pay`, people.ada, { name: "Ada Eze" })).status).toBe(201);
    // The lifeguard can't refund an open pool.
    expect((await app("POST", `/pools/${pool.id}/refund`, people.lifeguard)).body.error.code).toBe("deadline_not_passed");

    await waitForExpiry();
    const view = await app("GET", `/pools/${pool.id}`, people.lifeguard);
    expect(view.body).toMatchObject({ status: "missed", raised: 1, goal: 3, closedAt: null });
    expect((await app("GET", `/pools/${pool.id}`, people.ada)).body).toMatchObject({ status: "missed", raised: null });
    // Nobody can pay in or be paid out while the lifeguard decides.
    expect((await app("POST", `/invites/${pool.code}/pay`, people.zara, { name: "Zara Musa" })).body.error.code).toBe("deadline_passed");
    expect((await app("POST", `/pools/${pool.id}/payout`, people.lifeguard, { destination: "wallet" })).body.error.code).toBe("goal_not_reached");

    // The job asks the lifeguard once, on every channel, and refunds nobody.
    expect(await h.services.refunds.runOnce()).toEqual({ poolsChecked: 1, lifeguardsAsked: 1, refunds: 0, failures: 0, poolsFinished: 0 });
    expect(await h.services.refunds.runOnce()).toMatchObject({ poolsChecked: 0, lifeguardsAsked: 0 });
    expect(await balance(people.ada)).toBeCloseTo(2, 7);
    expect(inbox("lifeguard@example.com")).toEqual(["Lab coats missed its deadline"]);
    expect(phone("lifeguard")).toContain("⏰ Lab coats missed its deadline | 1.00 USDC of 3.00 USDC came in. Extend the date or refund the divers.");
    expect(phone("ada")).toEqual([]);
    const notes = await app("GET", "/notifications", people.lifeguard);
    expect(notes.body.items[0]).toMatchObject({ icon: "⏰", href: `/pools/${pool.id}`, unread: true });
    expect((await app("GET", "/notifications", people.ada)).body.items.some((n: { icon: string }) => n.icon === "⏰")).toBe(false);
    expect((await app("GET", "/home", people.lifeguard)).body.alerts).toContainEqual({ kind: "goal_missed", poolId: pool.id, poolName: "Lab coats" });
  });

  it("takes payments again once the lifeguard gives it more time", async () => {
    expect((await app("POST", `/pools/${pool.id}/extend`, people.ada, { deadline: soon() })).status).toBe(403);
    const past = await app("POST", `/pools/${pool.id}/extend`, people.lifeguard, { deadline: new Date(Date.now() - 60_000).toISOString() });
    expect(past.body.error.code).toBe("invalid_deadline");

    const deadline = soon();
    const extended = await app("POST", `/pools/${pool.id}/extend`, people.lifeguard, { deadline });
    expect(extended.status).toBe(200);
    expect(extended.body).toMatchObject({ status: "active", deadline: new Date(deadline).toISOString() });
    expect(extended.body.activity[0].title).toBe("You extended the deadline for Lab coats");
    expect((await h.contract.getPool(pool.chainPoolId)).status).toBe("open");

    // Everyone else in the pool hears about it: Ada paid, Tobi approves.
    expect(inbox("ada@example.com")).toContain("Lab coats has a new deadline");
    expect(inbox("tobi@example.com")).toContain("Lab coats has a new deadline");
    expect(phone("ada").some((n) => n.startsWith("📅 🥼 Lab coats has a new deadline | Judith Okafor gave it more time"))).toBe(true);
    const adaNotes = await app("GET", "/notifications", people.ada);
    expect(adaNotes.body.items).toContainEqual(expect.objectContaining({ icon: "📅", title: "Judith Okafor gave Lab coats more time." }));

    expect((await app("POST", "/wallet/deposits", people.zara, { amount: 2 })).status).toBe(201);
    expect((await app("POST", `/invites/${pool.code}/pay`, people.zara, { name: "Zara Musa" })).status).toBe(201);
  });

  it("asks again when the new deadline passes, then refunds everyone when the lifeguard chooses", async () => {
    await waitForExpiry();
    expect(await h.services.refunds.runOnce()).toMatchObject({ poolsChecked: 1, lifeguardsAsked: 1, refunds: 0 });
    expect(inbox("lifeguard@example.com")).toEqual(["Lab coats missed its deadline", "Lab coats missed its deadline"]);

    expect((await app("POST", `/pools/${pool.id}/refund`, people.ada)).status).toBe(403);
    const refunded = await app("POST", `/pools/${pool.id}/refund`, people.lifeguard);
    expect(refunded.status).toBe(200);
    expect(refunded.body).toMatchObject({ status: "refunded", totalRefunded: 2 });
    expect(await balance(people.ada)).toBeCloseTo(3, 7);
    expect(await balance(people.zara)).toBeCloseTo(2, 7);
    expect(inbox("ada@example.com")).toContain("Your 1.00 USDC from Lab coats is back");
    expect(inbox("zara@example.com")).toContain("Your 1.00 USDC from Lab coats is back");
    expect((await app("GET", `/pools/${pool.id}`, people.ada)).body).toMatchObject({ status: "refunded", yourRefund: 1 });

    // Decided for good: no more time, and nobody is refunded twice.
    expect((await app("POST", `/pools/${pool.id}/extend`, people.lifeguard, { deadline: soon() })).body.error.code).toBe("pool_refunded");
    expect((await app("POST", `/pools/${pool.id}/refund`, people.lifeguard)).status).toBe(200);
    expect(await h.services.refunds.runOnce()).toMatchObject({ poolsChecked: 0, refunds: 0 });
    expect(await balance(people.ada)).toBeCloseTo(3, 7);
    const state = await h.contract.getPool(pool.chainPoolId);
    expect(state.totalRefunded).toBe(state.totalContributed);
  });
});
