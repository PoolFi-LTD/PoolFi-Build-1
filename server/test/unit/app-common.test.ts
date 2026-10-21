import { describe, expect, it } from "vitest";
import {
  approvalsNeeded,
  centsOf,
  centsToBase,
  codeSuffix,
  feeOn,
  newPoolCode,
  shareCents,
  statusOf,
  toUsdc,
  UsdcInput,
} from "../../src/services/app/common.ts";
import type { ChainPool } from "../../src/stellar/pool-contract.ts";

describe("amounts", () => {
  it("turns screen amounts into base units and back", () => {
    expect(centsToBase(centsOf(1.43))).toBe(14_300_000n);
    expect(centsToBase(centsOf(0.1 + 0.2))).toBe(3_000_000n);
    expect(toUsdc(14_300_000n)).toBe(1.43);
    expect(toUsdc("85800000")).toBe(8.58);
    expect(toUsdc(null)).toBe(0);
  });

  it("accepts whole cents only", () => {
    expect(UsdcInput.safeParse(12.5).success).toBe(true);
    expect(UsdcInput.safeParse(1.43).success).toBe(true);
    expect(UsdcInput.safeParse(1.435).success).toBe(false);
    expect(UsdcInput.safeParse(0).success).toBe(false);
    expect(UsdcInput.safeParse(-5).success).toBe(false);
  });

  it("grosses up the share so the lifeguard still gets the amount after the fee", () => {
    // 1.43 at 5% → 1.43 / 0.95 = 1.5052… → 1.51, as the create screen shows.
    expect(shareCents(143n, 500, true)).toBe(151n);
    expect(shareCents(100n, 500, true)).toBe(106n);
    expect(shareCents(143n, 500, false)).toBe(143n);
    expect(shareCents(143n, 0, true)).toBe(143n);
    // What the lifeguard gets from a full pool is never less than they asked for.
    for (const cents of [1n, 99n, 143n, 357n, 1000n, 71_429n]) {
      const share = shareCents(cents, 500, true) * 100_000n;
      expect(share - feeOn(share, 500)).toBeGreaterThanOrEqual(cents * 100_000n);
    }
  });

  it("takes the fee like the contract: rounded down", () => {
    expect(feeOn(10_000_000n, 500)).toBe(500_000n);
    expect(feeOn(19n, 500)).toBe(0n);
    expect(feeOn(10_000_000n, 0)).toBe(0n);
  });
});

describe("pools", () => {
  const state = (status: ChainPool["status"], payoutApprovals: string[] | null = null) =>
    ({ status, payoutApprovals }) as ChainPool;

  it("shows the contract's status the way the screens name it", () => {
    expect(statusOf(state("open"))).toBe("active");
    expect(statusOf(state("funded"))).toBe("met");
    expect(statusOf(state("funded", []))).toBe("approval");
    expect(statusOf(state("settled"))).toBe("paidout");
    expect(statusOf(state("refunded"))).toBe("refunded");
  });

  it("needs a majority of approvers, as the contract does", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(approvalsNeeded)).toEqual([0, 1, 2, 2, 3, 3, 6]);
  });

  it("makes short codes without look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = newPoolCode();
      expect(code).toMatch(/^PF-[A-HJKMNP-Z2-9]{4}$/);
    }
    expect(codeSuffix("PF-7K2Q")).toBe("7K2Q");
  });
});
