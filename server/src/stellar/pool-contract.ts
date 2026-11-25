import { Address, nativeToScVal, scValToNative, xdr, type Keypair } from "@stellar/stellar-sdk";
import type { Chain } from "./chain.ts";
import { ChainError } from "./errors.ts";

/**
 * "expired": the deadline passed below the goal, and the pool admin hasn't yet
 * extended it or cancelled. Contracts from before that choice existed report
 * such a pool as "refunded" instead.
 */
export type PoolStatus = "open" | "funded" | "settled" | "refunded" | "expired";

/**
 * The date a pool without a deadline is given here, where a date is needed (the
 * contract stores u64::MAX). The `pools` table stores it too, for such pools.
 */
export const NO_DEADLINE = new Date("9999-12-31T23:59:59Z");
/** The contract's `NO_DEADLINE`. */
const NO_DEADLINE_SECONDS = 2n ** 64n - 1n;

/** A pool as the contract reports it. `status` already accounts for an expired deadline. */
export interface ChainPool {
  chainPoolId: bigint;
  admin: string;
  /** 0 for a voluntary pool without a goal. */
  goalAmount: bigint;
  /** `NO_DEADLINE` for a voluntary pool without one. */
  deadline: Date;
  totalContributed: bigint;
  totalRefunded: bigint;
  memberCount: number;
  status: PoolStatus;
  createdAt: Date;
  /** Wallets that approve the payout; empty when the pool admin is paid out alone. */
  approvers: string[];
  /** Approvals of the open payout request, or null when no payout is waiting. */
  payoutApprovals: string[] | null;
}

export type ChainPoolKind = "fixed" | "voluntary";
/** admin_decides: fixed pools, where the lifeguard extends or refunds at a missed deadline. */
export type ChainResolution = "admin_decides" | "all_or_nothing" | "keep_raised";

/**
 * A pool's settings (contract version 3). Pools made earlier, and every pool on a
 * contract that hasn't been upgraded, have the defaults: `DEFAULT_SETTINGS`.
 */
export interface ChainSettings {
  kind: ChainPoolKind;
  resolution: ChainResolution;
  /** Approvals the payout needs; null: a majority of the approvers. */
  threshold: number | null;
  /** Seconds the approvers have once the pool is payable; null: no limit. */
  approvalWindowSeconds: number | null;
  /** Fixed pools made with terms: what each member owes, on-chain. */
  shareAmount: bigint | null;
  /** Voluntary pools: the smallest contribution. */
  minContribution: bigint | null;
  /** When the pool first became payable (the approval window counts from here). */
  settleableSince: Date | null;
}

export const DEFAULT_SETTINGS: ChainSettings = {
  kind: "fixed",
  resolution: "admin_decides",
  threshold: null,
  approvalWindowSeconds: null,
  shareAmount: null,
  minContribution: null,
  settleableSince: null,
};

/** What `create_pool_with_terms` takes. */
export interface PoolTerms {
  kind: ChainPoolKind;
  /** Voluntary: 0 for no goal. */
  goalAmount: bigint;
  /** null: no deadline (voluntary only). */
  deadline: Date | null;
  shareAmount: bigint | null;
  minContribution: bigint | null;
  resolution: ChainResolution;
  approvers: string[];
  threshold: number | null;
  approvalWindowSeconds: number | null;
}

/** A member's standing, from the contract. */
export interface ChainMemberStatus {
  address: string;
  /** What they owe (fixed pools with a share on-chain), or null. */
  expected: bigint | null;
  contributed: bigint;
  paid: boolean;
  refunded: boolean;
}

/** The platform fee taken from every payout, never from refunds. */
export interface ChainFee {
  bps: number;
  recipient: string;
}

export interface ChainMember {
  joinedAt: Date;
  contributed: bigint;
  refunded: boolean;
}

interface RawPool {
  id: bigint;
  admin: string;
  goal_amount: bigint;
  deadline: bigint;
  total_contributed: bigint;
  total_refunded: bigint;
  member_count: number;
  status: string | string[];
  created_at: bigint;
  approvers?: string[] | null;
  payout_approvals?: string[] | null;
}

interface RawMember {
  joined_at: bigint;
  contributed: bigint;
  refunded: boolean;
}

const u32 = (value: number) => nativeToScVal(value, { type: "u32" });
const u64 = (value: bigint) => nativeToScVal(value, { type: "u64" });
const i128 = (value: bigint) => nativeToScVal(value, { type: "i128" });
const address = (value: string) => new Address(value).toScVal();
const fromSeconds = (value: bigint) => new Date(Number(value) * 1000);
const optional = (value: xdr.ScVal | null) => value ?? xdr.ScVal.scvVoid();
const symbolEnum = (name: string) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
const KINDS: Record<ChainPoolKind, string> = { fixed: "Fixed", voluntary: "Voluntary" };
const RESOLUTIONS: Record<ChainResolution, string> = {
  admin_decides: "AdminDecides",
  all_or_nothing: "AllOrNothing",
  keep_raised: "KeepWhatsRaised",
};
const enumName = (raw: string | string[]) => String(Array.isArray(raw) ? raw[0] : raw);
const fromEnum = <T extends string>(table: Record<T, string>, raw: string | string[]): T =>
  (Object.keys(table) as T[]).find((key) => table[key] === enumName(raw)) ?? (Object.keys(table)[0] as T);

/** How long the contract's version is remembered: an upgrade shows up within this. */
const VERSION_CACHE_MS = 5 * 60_000;

/** Typed calls to the deployed pool contract (`contracts/pool`). */
export class PoolContract {
  private versionRead: { version: number; until: number } | null = null;

  constructor(private readonly chain: Chain) {}

  /**
   * The contract code's version: 3 and up has pool types, thresholds and approval
   * windows. Older code has no `version` function, so it reads as 2 here.
   */
  async version(): Promise<number> {
    if (this.versionRead && this.versionRead.until > Date.now()) return this.versionRead.version;
    let version: number;
    try {
      version = Number(scValToNative(await this.chain.read("version")));
    } catch (error) {
      // A missing function is a refused simulation; anything else (the network) isn't an answer.
      if (!(error instanceof ChainError) || error.kind === "busy" || error.kind === "timeout") throw error;
      version = 2;
    }
    this.versionRead = { version, until: Date.now() + VERSION_CACHE_MS };
    return version;
  }

  /** Whether this contract takes pool types, thresholds and approval windows. */
  async hasSettings(): Promise<boolean> {
    return (await this.version()) >= 3;
  }

  async token(): Promise<string> {
    return String(scValToNative(await this.chain.read("token")));
  }

  async createPool(admin: Keypair, goalAmount: bigint, deadline: Date): Promise<{ chainPoolId: bigint; txHash: string }> {
    const deadlineSeconds = BigInt(Math.floor(deadline.getTime() / 1000));
    const { hash, returnValue } = await this.chain.invoke(admin, "create_pool", [
      address(admin.publicKey()),
      i128(goalAmount),
      u64(deadlineSeconds),
    ]);
    if (!returnValue) throw new Error(`create_pool transaction ${hash} returned no pool id`);
    return { chainPoolId: BigInt(scValToNative(returnValue)), txHash: hash };
  }

  /** A pool whose payout needs a majority of `approvers` (wallet addresses) to agree. */
  async createPoolWithApprovers(
    admin: Keypair,
    goalAmount: bigint,
    deadline: Date,
    approvers: string[],
  ): Promise<{ chainPoolId: bigint; txHash: string }> {
    const deadlineSeconds = BigInt(Math.floor(deadline.getTime() / 1000));
    const { hash, returnValue } = await this.chain.invoke(admin, "create_pool_with_approvers", [
      address(admin.publicKey()),
      i128(goalAmount),
      u64(deadlineSeconds),
      xdr.ScVal.scvVec(approvers.map(address)),
    ]);
    if (!returnValue) throw new Error(`create_pool_with_approvers transaction ${hash} returned no pool id`);
    return { chainPoolId: BigInt(scValToNative(returnValue)), txHash: hash };
  }

  /** A fixed or voluntary pool with its settings (contract version 3). */
  async createPoolWithTerms(admin: Keypair, terms: PoolTerms): Promise<{ chainPoolId: bigint; txHash: string }> {
    const seconds = (date: Date) => BigInt(Math.floor(date.getTime() / 1000));
    const entry = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
    // A contract struct: a map with its field names in sorted order.
    const scTerms = xdr.ScVal.scvMap([
      entry("approval_window", optional(terms.approvalWindowSeconds === null ? null : u64(BigInt(terms.approvalWindowSeconds)))),
      entry("approvers", xdr.ScVal.scvVec(terms.approvers.map(address))),
      entry("deadline", optional(terms.deadline ? u64(seconds(terms.deadline)) : null)),
      entry("goal_amount", i128(terms.goalAmount)),
      entry("kind", symbolEnum(KINDS[terms.kind])),
      entry("min_contribution", optional(terms.minContribution === null ? null : i128(terms.minContribution))),
      entry("resolution", symbolEnum(RESOLUTIONS[terms.resolution])),
      entry("share_amount", optional(terms.shareAmount === null ? null : i128(terms.shareAmount))),
      entry("threshold", optional(terms.threshold === null ? null : u32(terms.threshold))),
    ]);
    const { hash, returnValue } = await this.chain.invoke(admin, "create_pool_with_terms", [address(admin.publicKey()), scTerms]);
    if (!returnValue) throw new Error(`create_pool_with_terms transaction ${hash} returned no pool id`);
    return { chainPoolId: BigInt(scValToNative(returnValue)), txHash: hash };
  }

  /** The pool's settings; the defaults on a contract older than version 3. */
  async getSettings(chainPoolId: bigint): Promise<ChainSettings> {
    if (!(await this.hasSettings())) return DEFAULT_SETTINGS;
    const raw = scValToNative(await this.chain.read("get_pool_settings", [u64(chainPoolId)])) as {
      kind: string | string[];
      resolution: string | string[];
      threshold?: number | null;
      approval_window?: bigint | null;
      share_amount?: bigint | null;
      min_contribution?: bigint | null;
      settleable_since?: bigint | null;
    };
    return {
      kind: fromEnum(KINDS, raw.kind),
      resolution: fromEnum(RESOLUTIONS, raw.resolution),
      threshold: raw.threshold === null || raw.threshold === undefined ? null : Number(raw.threshold),
      approvalWindowSeconds: raw.approval_window === null || raw.approval_window === undefined ? null : Number(raw.approval_window),
      shareAmount: raw.share_amount === null || raw.share_amount === undefined ? null : BigInt(raw.share_amount),
      minContribution: raw.min_contribution === null || raw.min_contribution === undefined ? null : BigInt(raw.min_contribution),
      settleableSince: raw.settleable_since === null || raw.settleable_since === undefined ? null : fromSeconds(BigInt(raw.settleable_since)),
    };
  }

  /** Every member's standing, in join order: what they owe and paid (contract version 3). */
  async getMemberStatuses(chainPoolId: bigint, memberCount: number): Promise<ChainMemberStatus[]> {
    const pageSize = 50;
    const statuses: ChainMemberStatus[] = [];
    for (let start = 0; start < memberCount; start += pageSize) {
      const page = scValToNative(
        await this.chain.read("get_member_statuses", [u64(chainPoolId), u32(start), u32(pageSize)]),
      ) as { member: string; expected?: bigint | null; contributed: bigint; paid: boolean; refunded: boolean }[];
      statuses.push(
        ...page.map((m) => ({
          address: String(m.member),
          expected: m.expected === null || m.expected === undefined ? null : BigInt(m.expected),
          contributed: BigInt(m.contributed),
          paid: Boolean(m.paid),
          refunded: Boolean(m.refunded),
        })),
      );
    }
    return statuses;
  }

  /** A contributor takes their USDC back after the approval window ran out. `caller` pays for the transaction. */
  async reclaim(caller: Keypair, chainPoolId: bigint, member: string): Promise<{ amount: bigint; txHash: string }> {
    const { hash, returnValue } = await this.chain.invoke(caller, "reclaim", [u64(chainPoolId), address(member)]);
    if (!returnValue) throw new Error(`reclaim transaction ${hash} returned no amount`);
    return { amount: BigInt(scValToNative(returnValue)), txHash: hash };
  }

  /** The pool admin asks the approvers to release a funded pool's payout. */
  async requestPayout(admin: Keypair, chainPoolId: bigint): Promise<string> {
    const { hash } = await this.chain.invoke(admin, "request_payout", [u64(chainPoolId)]);
    return hash;
  }

  /** An approver agrees. Once a majority has, the pool admin is paid in the same call. */
  async approvePayout(approver: Keypair, chainPoolId: bigint): Promise<{ paid: boolean; txHash: string }> {
    const { hash, returnValue } = await this.chain.invoke(approver, "approve_payout", [
      u64(chainPoolId),
      address(approver.publicKey()),
    ]);
    return { paid: returnValue ? Boolean(scValToNative(returnValue)) : false, txHash: hash };
  }

  /** An approver turns the request down; the money stays in the pool. */
  async declinePayout(approver: Keypair, chainPoolId: bigint): Promise<string> {
    const { hash } = await this.chain.invoke(approver, "decline_payout", [u64(chainPoolId), address(approver.publicKey())]);
    return hash;
  }

  /** The fee taken from payouts; null on a contract upgraded from the first release until its admin sets one. */
  async fee(): Promise<ChainFee | null> {
    const raw = scValToNative(await this.chain.read("fee")) as { bps: number; recipient: string } | null | undefined;
    return raw ? { bps: Number(raw.bps), recipient: String(raw.recipient) } : null;
  }

  async joinPool(member: Keypair, chainPoolId: bigint): Promise<string> {
    const { hash } = await this.chain.invoke(member, "join_pool", [u64(chainPoolId), address(member.publicKey())]);
    return hash;
  }

  async contribute(member: Keypair, chainPoolId: bigint, amount: bigint): Promise<string> {
    const { hash } = await this.chain.invoke(member, "contribute", [
      u64(chainPoolId),
      address(member.publicKey()),
      i128(amount),
    ]);
    return hash;
  }

  /** The pool admin takes a funded pool's whole balance. */
  async settle(admin: Keypair, chainPoolId: bigint): Promise<{ amount: bigint; txHash: string }> {
    const { hash, returnValue } = await this.chain.invoke(admin, "settle", [u64(chainPoolId)]);
    if (!returnValue) throw new Error(`settle transaction ${hash} returned no amount`);
    return { amount: BigInt(scValToNative(returnValue)), txHash: hash };
  }

  /** The pool admin moves the deadline later; an expired pool takes payments again until then. */
  async extendDeadline(admin: Keypair, chainPoolId: bigint, deadline: Date): Promise<string> {
    const deadlineSeconds = BigInt(Math.floor(deadline.getTime() / 1000));
    const { hash } = await this.chain.invoke(admin, "extend_deadline", [u64(chainPoolId), u64(deadlineSeconds)]);
    return hash;
  }

  /** The pool admin closes the pool so everyone who paid can be refunded. */
  async cancelPool(admin: Keypair, chainPoolId: bigint): Promise<string> {
    const { hash } = await this.chain.invoke(admin, "cancel_pool", [u64(chainPoolId)]);
    return hash;
  }

  /** Returns `member`'s contribution to them. Anyone can send it; `caller` pays for the transaction. */
  async claimRefund(caller: Keypair, chainPoolId: bigint, member: string): Promise<{ amount: bigint; txHash: string }> {
    const { hash, returnValue } = await this.chain.invoke(caller, "claim_refund", [u64(chainPoolId), address(member)]);
    if (!returnValue) throw new Error(`claim_refund transaction ${hash} returned no amount`);
    return { amount: BigInt(scValToNative(returnValue)), txHash: hash };
  }

  /** Every member address, in join order. */
  async getMembers(chainPoolId: bigint, memberCount: number): Promise<string[]> {
    const pageSize = 50;
    const members: string[] = [];
    for (let start = 0; start < memberCount; start += pageSize) {
      const page = scValToNative(
        await this.chain.read("get_members", [u64(chainPoolId), u32(start), u32(pageSize)]),
      ) as string[];
      members.push(...page);
    }
    return members;
  }

  async getPool(chainPoolId: bigint): Promise<ChainPool> {
    const raw = scValToNative(await this.chain.read("get_pool", [u64(chainPoolId)])) as RawPool;
    const status = Array.isArray(raw.status) ? raw.status[0] : raw.status;
    return {
      chainPoolId: BigInt(raw.id),
      admin: raw.admin,
      goalAmount: BigInt(raw.goal_amount),
      deadline: BigInt(raw.deadline) === NO_DEADLINE_SECONDS ? NO_DEADLINE : fromSeconds(BigInt(raw.deadline)),
      totalContributed: BigInt(raw.total_contributed),
      totalRefunded: BigInt(raw.total_refunded),
      memberCount: Number(raw.member_count),
      status: String(status).toLowerCase() as PoolStatus,
      createdAt: fromSeconds(BigInt(raw.created_at)),
      approvers: (raw.approvers ?? []).map(String),
      payoutApprovals: raw.payout_approvals ? raw.payout_approvals.map(String) : null,
    };
  }

  async getMember(chainPoolId: bigint, member: string): Promise<ChainMember | null> {
    const raw = scValToNative(await this.chain.read("get_member", [u64(chainPoolId), address(member)])) as
      | RawMember
      | null
      | undefined;
    if (!raw) return null;
    return { joinedAt: fromSeconds(BigInt(raw.joined_at)), contributed: BigInt(raw.contributed), refunded: raw.refunded };
  }
}
