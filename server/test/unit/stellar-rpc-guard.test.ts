import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * These Stellar RPC helpers decode whole ledger headers or close metadata, whose XDR
 * changes with almost every protocol upgrade. When the network upgrades before
 * @stellar/stellar-sdk does, they throw ("unknown enum value") and every screen that
 * shows a balance fails. Read only the entry needed instead: `getLedgerEntries` for
 * accounts and trustlines, `getHealth` for the latest ledger number.
 */
const FRAGILE = ["getLatestLedger", "getAssetBalance", "getTrustline", "getLedgers", "getSACBalance"];

const SRC = new URL("../../src/", import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("Stellar RPC calls", () => {
  it("avoid helpers that decode whole ledger headers", () => {
    const found: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const name of FRAGILE) {
        if (new RegExp(`\\.${name}\\s*\\(`).test(text)) found.push(`${file.slice(SRC.length)}: ${name}`);
      }
    }
    expect(found).toEqual([]);
  });
});
