import { Address, nativeToScVal, scValToNative, type Keypair } from "@stellar/stellar-sdk";
import type { Chain } from "./chain.js";

export type PoolStatus = "open" | "funded" | "settled" | "refunded";

/** A pool as the contract reports it. `status` already accounts for an expired deadline. */
export interface ChainPool {
  chainPoolId: bigint;
  admin: string;
  goalAmount: bigint;
  deadline: Date;
  totalContributed: bigint;
  totalRefunded: bigint;
  memberCount: number;
  status: PoolStatus;
  createdAt: Date;
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

/** Typed calls to the deployed pool contract (`contracts/pool`). */
export class PoolContract {
  constructor(private readonly chain: Chain) {}

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
      deadline: fromSeconds(BigInt(raw.deadline)),
      totalContributed: BigInt(raw.total_contributed),
      totalRefunded: BigInt(raw.total_refunded),
      memberCount: Number(raw.member_count),
      status: String(status).toLowerCase() as PoolStatus,
      createdAt: fromSeconds(BigInt(raw.created_at)),
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
