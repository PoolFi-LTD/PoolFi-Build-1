import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc } from "../../src/money.ts";

describe("parseUsdc", () => {
  it("converts USDC to 7-decimal base units", () => {
    expect(parseUsdc("0")).toBe(0n);
    expect(parseUsdc("1")).toBe(10_000_000n);
    expect(parseUsdc("20.5")).toBe(205_000_000n);
    expect(parseUsdc("0.0000001")).toBe(1n);
    expect(parseUsdc("1234567.1234567")).toBe(12_345_671_234_567n);
  });

  it("rejects anything that isn't a plain non-negative amount", () => {
    for (const bad of ["", "-1", "1.", ".5", "1e3", "0x10", " 1", "1,000", "1.12345678", "abc"]) {
      expect(() => parseUsdc(bad), bad).toThrow(RangeError);
    }
  });

  it("rejects amounts the contract can't hold", () => {
    expect(() => parseUsdc("9".repeat(40))).toThrow(RangeError);
  });
});

describe("formatUsdc", () => {
  it("drops trailing zeros", () => {
    expect(formatUsdc(0n)).toBe("0");
    expect(formatUsdc(10_000_000n)).toBe("1");
    expect(formatUsdc(205_000_000n)).toBe("20.5");
    expect(formatUsdc(1n)).toBe("0.0000001");
    expect(formatUsdc(-15_000_000n)).toBe("-1.5");
  });

  it("round-trips with parseUsdc", () => {
    for (const value of ["0", "1", "20.5", "0.0000001", "999999999.9999999"]) {
      expect(formatUsdc(parseUsdc(value))).toBe(value);
    }
  });
});
