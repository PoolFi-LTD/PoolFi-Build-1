/**
 * Escrow on Stellar testnet, through the API: the pool admin withdraws once the
 * goal is met, and contributors are refunded automatically when the deadline
 * passes below the goal.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseUsdc } from "../../src/money.ts";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

const inDays = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
const balance = async (user: Parameters<Harness["call"]>[2]) => (await h.call("GET", "/v1/wallet", user)).body.usdcBalance;

describe("withdrawal", () => {
  it("lets only the pool admin withdraw, only after the goal is met, and only once", async () => {
    const admin = await h.signIn("treasurer");
    const member = await h.signIn("guest");
    const stranger = await h.signIn("stranger");
    await h.call("GET", "/v1/me", admin);
    await h.call("GET", "/v1/me", stranger);
    await h.call("POST", "/v1/wallet/deposits", member, { amount: "12" });

    const created = await h.call("POST", "/v1/pools", admin, { name: "Wedding gift", goalAmount: "10", deadline: inDays(3) });
    const poolId = created.body.pool.id;
    const withdraw = (user: typeof admin) => h.call("POST", `/v1/pools/${poolId}/withdraw`, user);

    expect((await withdraw(admin)).body.error.code).toBe("goal_not_reached");

    const paid = await h.call("POST", `/v1/pools/${poolId}/contributions`, member, { amount: "10" });
    expect(paid.body.pool.status).toBe("funded");

    for (const user of [member, stranger]) {
      const refused = await withdraw(user);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("not_pool_admin");
    }
    expect(await balance(member)).toBe("2");
    expect(await balance(stranger)).toBe("0");

    const withdrawn = await withdraw(admin);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.withdrawal).toMatchObject({ amount: "10", txHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(withdrawn.body.pool).toMatchObject({ status: "settled", withdrawal: { amount: "10" } });
    expect(await balance(admin)).toBe("10");
    expect((await h.contract.getPool(BigInt(created.body.pool.chainPoolId))).status).toBe("settled");

    const again = await withdraw(admin);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_withdrawn");
    expect(await balance(admin)).toBe("10");

    const late = await h.call("POST", `/v1/pools/${poolId}/contributions`, member, { amount: "1" });
    expect(late.body.error.code).toBe("pool_closed");
  });
});

describe("automatic refunds", () => {
  it("refunds every contributor exactly once when the deadline passes below the goal", async () => {
    const admin = await h.signIn("organiser");
    const alice = await h.signIn("alice");
    const bob = await h.signIn("bob");
    const carol = await h.signIn("carol");
    await h.call("POST", "/v1/wallet/deposits", alice, { amount: "6" });
    await h.call("POST", "/v1/wallet/deposits", bob, { amount: "4" });

    // The shortest deadline the API allows, so the test can wait it out.
    const deadline = new Date(Date.now() + 75_000);
    const created = await h.call("POST", "/v1/pools", admin, {
      name: "Community borehole",
      goalAmount: "100",
      deadline: deadline.toISOString(),
    });
    expect(created.status).toBe(201);
    const poolId = created.body.pool.id;
    const chainPoolId = BigInt(created.body.pool.chainPoolId);

    await h.call("POST", `/v1/pools/${poolId}/contributions`, alice, { amount: "5" });
    await h.call("POST", `/v1/pools/${poolId}/contributions`, bob, { amount: "3" });
    await h.call("POST", `/v1/pools/${poolId}/join`, carol, {});
    expect(await balance(alice)).toBe("1");
    expect(await balance(bob)).toBe("1");

    // Before the deadline the job leaves the pool alone.
    expect(await h.services.refunds.runOnce()).toMatchObject({ poolsChecked: 0, refunds: 0 });

    // Wait for the ledger clock to pass the deadline.
    for (let i = 0; (await h.contract.getPool(chainPoolId)).status !== "refunded"; i++) {
      if (i > 40) throw new Error("the pool never expired on-chain");
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    expect((await h.call("POST", `/v1/pools/${poolId}/withdraw`, admin)).body.error.code).toBe("pool_refunded");

    const run = await h.services.refunds.runOnce();
    expect(run).toEqual({ poolsChecked: 1, refunds: 2, failures: 0, poolsFinished: 1 });
    expect(await balance(alice)).toBe("6");
    expect(await balance(bob)).toBe("4");

    const view = await h.call("GET", `/v1/pools/${poolId}`, alice);
    expect(view.body.pool.status).toBe("refunded");
    expect(view.body.pool.membership).toMatchObject({ status: "refunded", refund: { amount: "5" } });
    const carolView = await h.call("GET", `/v1/pools/${poolId}`, carol);
    expect(carolView.body.pool.membership).toMatchObject({ status: "pending", refund: null });

    // Running again does nothing: the pool is finished and nobody is paid twice.
    expect(await h.services.refunds.runOnce()).toMatchObject({ poolsChecked: 0, refunds: 0 });
    expect(await balance(alice)).toBe("6");
    const state = await h.contract.getPool(chainPoolId);
    expect(state.totalRefunded).toBe(parseUsdc("8"));
    expect(state.totalRefunded).toBe(state.totalContributed);
  });
});
