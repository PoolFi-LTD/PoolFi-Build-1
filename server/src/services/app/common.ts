import { randomInt } from "node:crypto";
import { z } from "zod";
import type { Avatar, PoolStatus, PoolType, User } from "../../api-types.ts";
import { ApiError } from "../../errors.ts";
import type { ChainPool } from "../../stellar/pool-contract.ts";

/** USDC base units per cent: the screens work in cents, the contract in 7 decimals. */
const BASE_PER_CENT = 100_000n;

/** Base units as the plain USDC number the screens show. */
export function toUsdc(base: bigint | string | null | undefined): number {
  return base === null || base === undefined ? 0 : Number(BigInt(base)) / 1e7;
}

export function centsOf(usdc: number): bigint {
  return BigInt(Math.round(usdc * 100));
}

export function centsToBase(cents: bigint): bigint {
  return cents * BASE_PER_CENT;
}

/** A USDC amount from a screen: more than zero, whole cents, at most a million. */
export const UsdcInput = z
  .number()
  .positive()
  .max(1_000_000)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "use at most 2 decimals");

/** The fee as the contract takes it: rounded down to the base unit. */
export function feeOn(gross: bigint, bps: number): bigint {
  return (gross * BigInt(bps)) / 10_000n;
}

/** What each diver pays so the lifeguard still gets `cents` after the fee, rounded up to the cent. */
export function shareCents(cents: bigint, bps: number, feeCovered: boolean): bigint {
  if (!feeCovered || bps <= 0) return cents;
  const denominator = 10_000n - BigInt(bps);
  return (cents * 10_000n + denominator - 1n) / denominator;
}

/** A user row's profile, as stored. */
export interface PersonRow {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar: Avatar | null;
}

export function nameOf(person: Pick<PersonRow, "first_name" | "last_name"> | undefined | null): string {
  const name = `${person?.first_name ?? ""} ${person?.last_name ?? ""}`.trim();
  return name || "PoolFi user";
}

export function toUser(row: PersonRow): User {
  return {
    id: row.id,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    email: row.email,
    phone: row.phone,
    avatar: row.avatar,
  };
}

/** Pool codes skip letters and digits people mix up (0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newPoolCode(): string {
  let code = "PF-";
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** "PF-7K2Q" → "7K2Q", for receipt and statement references. */
export function codeSuffix(code: string): string {
  return code.replace(/^PF-/, "");
}

export const POOL_TYPES = [
  "Class dues",
  "Birthday",
  "Office welfare",
  "Cooperative levy",
  "Group trip",
  "Wedding gift",
  "Faith group",
  "Something else",
] as const satisfies readonly PoolType[];

/** The screens' status, from the contract's. */
export function statusOf(state: ChainPool): PoolStatus {
  switch (state.status) {
    case "open":
      return "active";
    case "funded":
      return state.payoutApprovals ? "approval" : "met";
    case "settled":
      return "paidout";
    case "refunded":
      return "refunded";
  }
}

/** A majority of approvers: 1 of 1, 2 of 2, 2 of 3, 3 of 4… as the contract counts. */
export function approvalsNeeded(approvers: number): number {
  return approvers > 0 ? Math.floor(approvers / 2) + 1 : 0;
}

export const notFound = () => new ApiError(404, "pool_not_found", "Pool not found.");

export const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** Runs `fn` over `items`, at most `limit` at a time, keeping their order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
