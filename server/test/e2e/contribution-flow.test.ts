/**
 * The whole contribution flow on Stellar testnet, through the API only: no
 * CLI, no wallet app. Needs the settings in server/.env and a database server
 * (`npm run db:local`).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.ts";
import { parseUsdc } from "../../src/money.ts";
import { toApiError } from "../../src/services/chain-errors.ts";
import { startHarness, type Harness, type TestUser } from "./harness.ts";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

function apiErrorCode(error: unknown): string {
  const mapped = toApiError(error, { pool: h.chain.poolContractId, usdc: h.chain.usdcContractId });
  return mapped instanceof ApiError ? mapped.code : `unmapped: ${String(error)}`;
}

describe("contribution flow on testnet", () => {
  let classRep: TestUser;
  let student: TestUser;
  let latePayer: TestUser;

  beforeAll(async () => {
    classRep = await h.signIn("class-rep");
    student = await h.signIn("student");
    latePayer = await h.signIn("late-payer");
  });
  let poolId: string;
  let chainPoolId: bigint;

  it("creates a working wallet the first time each user signs in", async () => {
    for (const user of [classRep, student]) {
      const first = await h.call("GET", "/v1/me", user);
      expect(first.status).toBe(200);
      const { address, activated } = first.body.wallet;
      expect(activated).toBe(true);

      // The wallet exists on Stellar, can hold USDC, and has no XLM: PoolFi pays its fees and reserves.
      expect(await h.chain.usdcBalance(address)).toBe(0n);
      expect((await h.chain.rpc.getAccountEntry(address)).balance).toBe(0n);

      const again = await h.call("GET", "/v1/me", user);
      expect(again.body.wallet.address).toBe(address);
    }
  });

  it("deposits test USDC into a wallet, within the limits", async () => {
    const user = student;
    const deposit = await h.call("POST", "/v1/wallet/deposits", user, { amount: "50" });
    expect(deposit.status).toBe(201);
    expect(deposit.body.deposit).toMatchObject({ amount: "50", provider: "testnet-treasury" });
    expect(deposit.body.usdcBalance).toBe("50");
    expect((await h.call("GET", "/v1/wallet", user)).body.usdcBalance).toBe("50");

    expect((await h.call("POST", "/v1/wallet/deposits", user, { amount: "20" })).body.error.code).toBe("deposit_limit_reached");
    expect((await h.call("POST", "/v1/wallet/deposits", user, { amount: "501" })).body.error.code).toBe("deposit_too_large");
    expect((await h.call("POST", "/v1/wallet/deposits", user, { amount: "lots" })).status).toBe(400);
  });

  it("lets the class rep create a pool", async () => {
    const user = classRep;
    const deadline = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const input = {
      name: "300L Class Dues",
      description: "Dues for the 2026/27 session",
      goalAmount: "100",
      deadline,
      fields: [{ key: "matric_number", label: "Matric number", type: "text" }],
    };

    expect((await h.call("POST", "/v1/pools", user, { ...input, goalAmount: "0" })).body.error.code).toBe("invalid_amount");
    expect((await h.call("POST", "/v1/pools", user, { ...input, deadline: new Date().toISOString() })).body.error.code).toBe(
      "invalid_deadline",
    );
    expect((await h.call("POST", "/v1/pools", undefined, input)).status).toBe(401);

    const created = await h.call("POST", "/v1/pools", user, input);
    expect(created.status).toBe(201);
    const { pool } = created.body;
    expect(pool).toMatchObject({
      name: "300L Class Dues",
      goalAmount: "100",
      status: "open",
      totalContributed: "0",
      memberCount: 0,
      viewerIsAdmin: true,
      membership: null,
      contractId: h.chain.poolContractId,
    });
    poolId = pool.id;
    chainPoolId = BigInt(pool.chainPoolId);

    const onChain = await h.contract.getPool(chainPoolId);
    expect(onChain.admin).toBe((await h.call("GET", "/v1/me", user)).body.wallet.address);
    expect(onChain.goalAmount).toBe(parseUsdc("100"));
  });

  it("shows the pool to anyone with the link", async () => {
    const viewed = await h.call("GET", `/v1/pools/${poolId}`);
    expect(viewed.status).toBe(200);
    expect(viewed.body.pool).toMatchObject({ id: poolId, membership: null, viewerIsAdmin: false });
    expect((await h.call("GET", `/v1/pools/${randomUUID()}`)).status).toBe(404);
  });

  it("lets a student join without paying", async () => {
    const user = student;
    const missing = await h.call("POST", `/v1/pools/${poolId}/join`, user, {});
    expect(missing.body.error).toMatchObject({ code: "invalid_field_values", details: { matric_number: expect.any(String) } });

    const joined = await h.call("POST", `/v1/pools/${poolId}/join`, user, { fieldValues: { matric_number: "2023/0042" } });
    expect(joined.status).toBe(200);
    expect(joined.body.pool.membership).toMatchObject({
      status: "pending",
      contributed: "0",
      fieldValues: { matric_number: "2023/0042" },
    });
    expect(joined.body.pool.memberCount).toBe(1);

    const again = await h.call("POST", `/v1/pools/${poolId}/join`, user, { fieldValues: { matric_number: "2023/0042" } });
    expect(again.status).toBe(200);
    expect(again.body.pool.memberCount).toBe(1);
  });

  it("records the student's USDC contribution on-chain", async () => {
    const user = student;
    const paid = await h.call("POST", `/v1/pools/${poolId}/contributions`, user, { amount: "20" });
    expect(paid.status).toBe(201);
    expect(paid.body.contribution).toMatchObject({ amount: "20", txHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(paid.body.pool).toMatchObject({ totalContributed: "20", memberCount: 1 });
    expect(paid.body.pool.membership).toMatchObject({ status: "paid", contributed: "20" });

    expect((await h.call("GET", "/v1/wallet", user)).body.usdcBalance).toBe("30");
    const onChain = await h.contract.getPool(chainPoolId);
    expect(onChain.totalContributed).toBe(parseUsdc("20"));
    const address = (await h.call("GET", "/v1/me", user)).body.wallet.address;
    expect((await h.contract.getMember(chainPoolId, address))?.contributed).toBe(parseUsdc("20"));
  });

  it("refuses contributions the wallet can't cover", async () => {
    const user = student;
    const tooMuch = await h.call("POST", `/v1/pools/${poolId}/contributions`, user, { amount: "1000" });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatchObject({ code: "insufficient_funds", details: { balance: "30" } });
    expect((await h.call("POST", `/v1/pools/${poolId}/contributions`, user, { amount: "0" })).body.error.code).toBe(
      "invalid_amount",
    );
    expect((await h.call("POST", `/v1/pools/${randomUUID()}/contributions`, user, { amount: "1" })).status).toBe(404);
  });

  it("lets someone pay without joining first", async () => {
    const user = latePayer;
    await h.call("POST", "/v1/wallet/deposits", user, { amount: "15" });
    const paid = await h.call("POST", `/v1/pools/${poolId}/contributions`, user, {
      amount: "15",
      fieldValues: { matric_number: "2023/0099" },
    });
    expect(paid.status).toBe(201);
    expect(paid.body.pool).toMatchObject({ totalContributed: "35", memberCount: 2 });
    expect(paid.body.pool.membership).toMatchObject({ status: "paid", fieldValues: { matric_number: "2023/0099" } });
  });

  it("reads contract and token failures from real testnet errors", async () => {
    const keypair = await h.services.wallets.keypair(student.id);

    // The pool contract's own error (code 6).
    await expect(h.contract.joinPool(keypair, chainPoolId).catch(apiErrorCode)).resolves.toBe("already_member");
    // The USDC token's error inside a pool call (also a low code, 10), not mistaken for a pool error.
    await expect(h.contract.contribute(keypair, chainPoolId, parseUsdc("1000")).catch(apiErrorCode)).resolves.toBe(
      "insufficient_funds",
    );
  });
});
