/**
 * Approval thresholds and windows, and voluntary pools, through the web app's API
 * on Stellar testnet (contract version 3):
 * - a pool with 3 approvers and a threshold of 2 doesn't pay out on one approval,
 *   refuses approvals from anyone else, and pays out on the second;
 * - when the approvers run out of time, everyone who paid reclaims, once;
 * - a voluntary pool takes different amounts from three wallets and resolves by its
 *   rule: all-or-nothing refunds everyone below the goal, keep-what's-raised pays out.
 * Set E2E_EVIDENCE_FILE to write every transaction hash to a file.
 */
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChainError } from "../../src/stellar/errors.ts";
import { startHarness, type Harness, type TestUser } from "./harness.ts";

let h: Harness;
let bps: number;
const people: Record<"lifeguard" | "ada" | "tobi" | "zara" | "dayo" | "emeka" | "femi" | "stranger", TestUser> = {} as never;
/** Transaction hashes for the pull request, by what they show. */
const evidence: Record<string, string | string[]> = {};

const app = (method: "GET" | "POST", path: string, user?: TestUser, body?: unknown) => h.call(method, `/v1/app${path}`, user, body);
const inDays = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
/** The shortest deadline the API allows, so the test can wait it out. */
const soon = () => new Date(Date.now() + 75_000).toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const balance = async (user: TestUser) => (await app("GET", "/wallet", user)).body.balance as number;
const chainId = async (poolId: string) =>
  BigInt((await h.db.query<{ chain_pool_id: string }>("select chain_pool_id from pools where id = $1", [poolId]))[0]?.chain_pool_id ?? "0");

/** Waits until the contract reports `status` for the pool (the ledger clock lags this machine's a little). */
async function waitForStatus(poolId: string, status: string) {
  const id = await chainId(poolId);
  for (let i = 0; (await h.contract.getPool(id)).status !== status; i++) {
    if (i > 40) throw new Error(`pool ${poolId} never became ${status} on-chain`);
    await sleep(5_000);
  }
}

/** A diver pays `amount` (fixed pools: their share) into the pool by invite link, as `name`. */
async function pay(code: string, user: TestUser, name: string, amount?: number) {
  const paid = await app("POST", `/invites/${code}/pay`, user, { name, ...(amount === undefined ? {} : { amount }) });
  expect(paid.status).toBe(201);
  return paid.body as { receiptRef: string; amount: number };
}

beforeAll(async () => {
  h = await startHarness();
  // These tests need contract version 3 (pool types, thresholds and windows).
  expect(await h.contract.version()).toBeGreaterThanOrEqual(3);
  bps = (await h.contract.fee())?.bps ?? 0;
  const names = {
    lifeguard: "Judith Okafor",
    ada: "Ada Eze",
    tobi: "Tobi Bello",
    zara: "Zara Musa",
    dayo: "Dayo Okeke",
    emeka: "Emeka Obi",
    femi: "Femi Ade",
    stranger: "Sam Stranger",
  };
  for (const [key, name] of Object.entries(names) as [keyof typeof people, string][]) {
    const user = await h.signIn(key);
    people[key] = user;
    expect((await app("GET", "/me", user)).status).toBe(200);
    const [firstName, lastName] = name.split(" ");
    const saved = await h.app.inject({
      method: "PUT",
      url: "/v1/app/me/profile",
      headers: user.headers,
      payload: { firstName, lastName, avatar: { kind: "emoji", emoji: "🌻", bg: "#F4E8D2" } },
    });
    expect(saved.statusCode).toBe(200);
  }
  for (const payer of [people.dayo, people.emeka, people.femi]) {
    expect((await app("POST", "/wallet/deposits", payer, { amount: 10 })).status).toBe(201);
  }
});

afterAll(async () => {
  if (process.env.E2E_EVIDENCE_FILE && h) writeFileSync(process.env.E2E_EVIDENCE_FILE, JSON.stringify({ contract: h.chain.poolContractId, ...evidence }, null, 2));
  await h?.close();
});

describe("a pool with a threshold of 2 of 3 approvers", () => {
  let pool: { id: string; code: string };

  it("is created with its approvers and threshold on the contract", async () => {
    expect((await app("GET", "/pool-options")).body).toMatchObject({ poolSettings: true });
    const created = await app("POST", "/pools", people.lifeguard, {
      type: "Group trip",
      emoji: "✈️",
      name: "Obudu trip",
      kind: "fixed",
      amount: 1,
      expectedCount: 2,
      deadline: inDays(3),
      approverIds: [people.ada.id, people.tobi.id, people.zara.id],
      threshold: 2,
      approvalWindowHours: 24,
      members: [],
      pickYourName: false,
      allowNotOnList: true,
      diversCanShare: true,
    });
    expect(created.status).toBe(201);
    pool = { id: created.body.id, code: created.body.code };
    expect(created.body).toMatchObject({ kind: "fixed", threshold: 2, approvalsNeeded: 2, approvalWindowHours: 24, approvalDeadline: null });
    expect(await h.contract.getSettings(await chainId(pool.id))).toMatchObject({
      kind: "fixed",
      threshold: 2,
      approvalWindowSeconds: 86_400,
      shareAmount: 10_000_000n,
    });
    evidence.poolWithApprovers = (await h.db.query<{ create_tx_hash: string }>("select create_tx_hash from pools where id = $1", [pool.id]))[0]?.create_tx_hash ?? "";
  });

  it("records each member's share and paid status on-chain", async () => {
    await pay(pool.code, people.dayo, "Dayo Okeke");
    await pay(pool.code, people.emeka, "Emeka Obi");
    const detail = (await app("GET", `/pools/${pool.id}`, people.lifeguard)).body;
    expect(detail.status).toBe("met");
    expect(detail.divers.map((d: { onChain: unknown }) => d.onChain)).toEqual([
      { expected: 1, contributed: 1, paid: true, refunded: false },
      { expected: 1, contributed: 1, paid: true, refunded: false },
    ]);
    // The approvers' window has started: the goal is met.
    expect(new Date(detail.approvalDeadline).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });

  it("doesn't pay out on one approval, nor take approvals from anyone else", async () => {
    expect((await app("POST", `/pools/${pool.id}/payout`, people.lifeguard, { destination: "wallet" })).status).toBe(200);
    const first = await app("POST", `/pools/${pool.id}/payout/approve`, people.ada);
    expect(first.body).toMatchObject({ status: "approval", payout: { approvals: 1, approvalsNeeded: 2, paidAt: null } });
    expect(await balance(people.lifeguard)).toBe(0);

    // Not an approver: the app doesn't even show them the pool, and the contract refuses them (NotApprover, #113).
    expect((await app("POST", `/pools/${pool.id}/payout/approve`, people.stranger)).body.error.code).toBe("pool_not_found");
    const strangerKeys = await h.services.wallets.keypair(people.stranger.id);
    const refused = await h.contract.approvePayout(strangerKeys, await chainId(pool.id)).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ChainError);
    expect((refused as ChainError).details.code).toBe(113);
    // Nor can the lifeguard approve their own payout.
    const lifeguardKeys = await h.services.wallets.keypair(people.lifeguard.id);
    expect(((await h.contract.approvePayout(lifeguardKeys, await chainId(pool.id)).catch((e: unknown) => e)) as ChainError).details.code).toBe(113);
    // Ada can't count twice (AlreadyApproved, #116).
    const adaKeys = await h.services.wallets.keypair(people.ada.id);
    expect(((await h.contract.approvePayout(adaKeys, await chainId(pool.id)).catch((e: unknown) => e)) as ChainError).details.code).toBe(116);

    const votes = await h.db.query<{ tx_hash: string }>(
      "select v.tx_hash from payout_votes v join payout_requests r on r.id = v.request_id where r.pool_id = $1",
      [pool.id],
    );
    evidence.firstApprovalBlocked = votes.map((v) => v.tx_hash);
    evidence.payoutRequested =
      (await h.db.query<{ request_tx_hash: string }>("select request_tx_hash from payout_requests where pool_id = $1", [pool.id]))[0]?.request_tx_hash ?? "";
  });

  it("pays out on the second approval", async () => {
    const second = await app("POST", `/pools/${pool.id}/payout/approve`, people.tobi);
    expect(second.body).toMatchObject({ status: "paidout", payout: { approvals: 2 } });
    const net = 2 - Math.floor(2e7 * bps / 10_000) / 1e7;
    expect(await balance(people.lifeguard)).toBeCloseTo(net, 7);
    // Paid once: the third approver has nothing left to approve.
    expect((await app("POST", `/pools/${pool.id}/payout/approve`, people.zara)).status).toBe(409);
    evidence.payoutAfterThreshold =
      (await h.db.query<{ paid_tx_hash: string }>("select paid_tx_hash from payout_requests where pool_id = $1", [pool.id]))[0]?.paid_tx_hash ?? "";
  });
});

describe("approvers who run out of time", () => {
  let pool: { id: string; code: string };

  it("let everyone who paid reclaim their USDC, once each", async () => {
    const created = await app("POST", "/pools", people.lifeguard, {
      type: "Wedding gift",
      emoji: "💍",
      name: "Kemi's gift",
      kind: "fixed",
      amount: 1,
      expectedCount: 2,
      deadline: inDays(3),
      approverIds: [people.ada.id, people.tobi.id],
      threshold: 2,
      approvalWindowHours: 1 / 60,
      members: [],
      pickYourName: false,
      allowNotOnList: true,
      diversCanShare: true,
    });
    expect(created.status).toBe(201);
    pool = { id: created.body.id, code: created.body.code };
    const before = { dayo: await balance(people.dayo), emeka: await balance(people.emeka) };
    await pay(pool.code, people.dayo, "Dayo Okeke");
    await pay(pool.code, people.emeka, "Emeka Obi");
    expect((await app("POST", `/pools/${pool.id}/payout`, people.lifeguard, { destination: "wallet" })).status).toBe(200);
    expect((await app("POST", `/pools/${pool.id}/payout/approve`, people.ada)).body.payout).toMatchObject({ approvals: 1, approvalsNeeded: 2 });
    // Too early: the window is still open.
    expect((await app("POST", `/pools/${pool.id}/reclaim`, people.dayo)).body.error.code).toBe("approval_window_open");

    await waitForStatus(pool.id, "refunded");
    expect((await app("POST", `/pools/${pool.id}/payout/approve`, people.tobi)).body.error.code).toBe("approval_window_expired");
    const view = (await app("GET", `/pools/${pool.id}`, people.dayo)).body;
    expect(view).toMatchObject({ approvalWindowExpired: true, canReclaim: true });

    const reclaimed = await app("POST", `/pools/${pool.id}/reclaim`, people.dayo);
    expect(reclaimed.status).toBe(200);
    expect(reclaimed.body.canReclaim).toBe(false);
    expect(await balance(people.dayo)).toBeCloseTo(before.dayo, 7);
    // Once only (NothingToRefund, #109).
    expect((await app("POST", `/pools/${pool.id}/reclaim`, people.dayo)).body.error.code).toBe("nothing_to_refund");
    const dayoKeys = await h.services.wallets.keypair(people.dayo.id);
    const [dayoWallet] = await h.db.query<{ public_key: string }>("select public_key from wallets where user_id = $1", [people.dayo.id]);
    const again = await h.contract.reclaim(dayoKeys, await chainId(pool.id), dayoWallet?.public_key ?? "").catch((e: unknown) => e);
    expect((again as ChainError).details.code).toBe(109);

    expect((await app("POST", `/pools/${pool.id}/reclaim`, people.emeka)).status).toBe(200);
    expect(await balance(people.emeka)).toBeCloseTo(before.emeka, 7);
    evidence.reclaimAfterWindow = (await h.db.query<{ tx_hash: string }>("select tx_hash from refunds where pool_id = $1 order by created_at", [pool.id])).map((r) => r.tx_hash);
  });
});

describe("voluntary pools", () => {
  const amounts: [keyof typeof people, string, number][] = [
    ["dayo", "Dayo Okeke", 1],
    ["emeka", "Emeka Obi", 1.5],
    ["femi", "Femi Ade", 2.25],
  ];

  async function voluntary(name: string, rule: "all_or_nothing" | "keep_raised", goal: number | null) {
    const created = await app("POST", "/pools", people.lifeguard, {
      type: "Something else",
      emoji: "🎁",
      name,
      kind: "voluntary",
      minimum: 1,
      goal,
      resolution: rule,
      deadline: soon(),
      approverIds: [],
      members: [],
      pickYourName: false,
      allowNotOnList: true,
      diversCanShare: true,
    });
    expect(created.status).toBe(201);
    return { id: created.body.id as string, code: created.body.code as string };
  }

  it("refunds exactly what each person paid when an all-or-nothing pool misses its goal", async () => {
    const pool = await voluntary("Team kitty", "all_or_nothing", 20);
    const before = Object.fromEntries(await Promise.all(amounts.map(async ([key]) => [key, await balance(people[key])])));
    // Below the minimum is refused, by the app and the contract alike.
    expect((await app("POST", `/invites/${pool.code}/pay`, people.dayo, { name: "Dayo Okeke", amount: 0.5 })).body.error.code).toBe("below_minimum");
    for (const [key, name, amount] of amounts) expect((await pay(pool.code, people[key], name, amount)).amount).toBe(amount);
    expect((await app("GET", `/pools/${pool.id}`, people.lifeguard)).body).toMatchObject({ kind: "voluntary", resolution: "all_or_nothing", raised: 4.75, status: "active" });
    evidence.voluntaryFunded = (await h.db.query<{ tx_hash: string }>("select tx_hash from contributions where pool_id = $1 order by created_at", [pool.id])).map((r) => r.tx_hash);

    await waitForStatus(pool.id, "refunded");
    await sleep(3_000);
    expect(await h.services.refunds.runOnce()).toMatchObject({ refunds: 3, failures: 0 });
    const refunds = await h.db.query<{ user_id: string; amount: string; tx_hash: string }>("select user_id, amount, tx_hash from refunds where pool_id = $1", [pool.id]);
    for (const [key, , amount] of amounts) {
      expect(refunds.find((r) => r.user_id === people[key].id)?.amount).toBe(String(amount * 1e7));
      expect(await balance(people[key])).toBeCloseTo(before[key] as number, 7);
    }
    evidence.allOrNothingRefund = refunds.map((r) => r.tx_hash);
  });

  it("pays out what was raised at the deadline under keep-what's-raised", async () => {
    const pool = await voluntary("Harvest levy", "keep_raised", null);
    const startBalance = await balance(people.lifeguard);
    for (const [key, name, amount] of amounts) await pay(pool.code, people[key], name, amount);
    // Not before the deadline.
    expect((await app("POST", `/pools/${pool.id}/payout`, people.lifeguard, { destination: "wallet" })).body.error.code).toBe("not_settleable");

    await waitForStatus(pool.id, "funded");
    const paid = await app("POST", `/pools/${pool.id}/payout`, people.lifeguard, { destination: "wallet" });
    expect(paid.body).toMatchObject({ status: "paidout", hasGoal: false });
    const fee = Math.floor(4.75e7 * bps / 10_000) / 1e7;
    expect(await balance(people.lifeguard)).toBeCloseTo(startBalance + 4.75 - fee, 7);
    evidence.keepWhatsRaisedRelease =
      (await h.db.query<{ paid_tx_hash: string }>("select paid_tx_hash from payout_requests where pool_id = $1", [pool.id]))[0]?.paid_tx_hash ?? "";
  });
});
