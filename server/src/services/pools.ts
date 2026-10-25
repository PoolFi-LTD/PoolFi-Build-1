import { z } from "zod";
import type { AuthUser } from "../auth.ts";
import type { Db } from "../db.ts";
import { ApiError } from "../errors.ts";
import { FieldDefinitions, validateFieldValues, type FieldDefinition, type FieldValues } from "../fields.ts";
import { formatUsdc, isUsdcAmount, parseUsdc } from "../money.ts";
import type { Chain } from "../stellar/chain.ts";
import type { PoolContract, PoolStatus } from "../stellar/pool-contract.ts";
import { newPoolCode } from "./app/common.ts";
import { toApiError } from "./chain-errors.ts";
import type { Wallets } from "./wallets.ts";

/** Deadlines closer than this are rejected, so ledger clock drift can't make them already past. */
const MIN_DEADLINE_LEAD_MS = 60_000;

const usdcAmount = z.string().refine(isUsdcAmount, "must be a USDC amount, e.g. 20 or 12.5");

export const CreatePoolInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  goalAmount: usdcAmount,
  deadline: z.iso.datetime({ offset: true }),
  fields: FieldDefinitions.default([]),
});

export const JoinPoolInput = z.object({
  fieldValues: z.record(z.string(), z.unknown()).optional(),
});

export const ContributeInput = z.object({
  amount: usdcAmount,
  fieldValues: z.record(z.string(), z.unknown()).optional(),
});

export interface PoolView {
  id: string;
  name: string;
  description: string | null;
  fields: FieldDefinition[];
  goalAmount: string;
  deadline: string;
  status: PoolStatus;
  totalContributed: string;
  memberCount: number;
  admin: { userId: string; walletAddress: string };
  contractId: string;
  chainPoolId: string;
  createTxHash: string;
  createdAt: string;
  /** The pool admin's withdrawal, once the goal was met and they withdrew. */
  withdrawal: TransferView | null;
  /** The signed-in viewer's membership; null if they haven't joined or aren't signed in. */
  membership: Membership | null;
  viewerIsAdmin: boolean;
}

export interface Membership {
  /** "pending" until the member has contributed; "refunded" once a missed goal paid them back. */
  status: "pending" | "paid" | "refunded";
  contributed: string;
  fieldValues: FieldValues;
  joinedAt: string;
  refund: TransferView | null;
}

/** USDC that left the pool: a withdrawal or a refund. */
export interface TransferView {
  amount: string;
  txHash: string;
  createdAt: string;
}

export interface ContributionView {
  id: string;
  amount: string;
  txHash: string;
  createdAt: string;
}

interface PoolRow {
  id: string;
  contract_id: string;
  chain_pool_id: string;
  admin_user_id: string;
  name: string;
  description: string | null;
  goal_amount: string;
  deadline: Date;
  fields: FieldDefinition[];
  create_tx_hash: string;
  created_at: Date;
}

interface MemberRow {
  field_values: FieldValues;
  joined_at: Date;
}

interface ContributionRow {
  id: string;
  amount: string;
  tx_hash: string;
  created_at: Date;
}

type TransferRow = Omit<ContributionRow, "id">;

const toTransfer = (row: TransferRow): TransferView => ({
  amount: formatUsdc(BigInt(row.amount)),
  txHash: row.tx_hash,
  createdAt: row.created_at.toISOString(),
});

export class Pools {
  private readonly contracts: { pool: string; usdc: string };

  constructor(
    private readonly db: Db,
    private readonly chain: Chain,
    private readonly contract: PoolContract,
    private readonly wallets: Wallets,
  ) {
    this.contracts = { pool: chain.poolContractId, usdc: chain.usdcContractId };
  }

  async create(user: AuthUser, input: z.infer<typeof CreatePoolInput>): Promise<PoolView> {
    const goal = parseUsdc(input.goalAmount);
    if (goal <= 0n) throw new ApiError(400, "invalid_amount", "The goal must be greater than zero.");
    const deadline = new Date(input.deadline);
    if (deadline.getTime() < Date.now() + MIN_DEADLINE_LEAD_MS) {
      throw new ApiError(400, "invalid_deadline", "The deadline must be at least a minute from now.");
    }

    await this.wallets.ensureUser(user);
    const keypair = await this.wallets.keypair(user.id);
    const { chainPoolId, txHash } = await this.onChain(() => this.contract.createPool(keypair, goal, deadline));

    // One share is the whole goal here; the web app's pools (/v1/app) split it per person.
    const insert = () =>
      this.db.query<PoolRow>(
        `insert into pools (contract_id, chain_pool_id, admin_user_id, name, description, goal_amount, deadline, fields,
           create_tx_hash, code, share_amount, expected_count)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $6, 1) returning *`,
        [
          this.contracts.pool,
          chainPoolId.toString(),
          user.id,
          input.name,
          input.description ?? null,
          goal.toString(),
          deadline,
          JSON.stringify(input.fields),
          txHash,
          newPoolCode(),
        ],
      );
    let rows: PoolRow[];
    for (let attempt = 1; ; attempt++) {
      try {
        rows = await insert();
        break;
      } catch (error) {
        const e = error as { code?: string; constraint?: string };
        if (attempt < 5 && e.code === "23505" && e.constraint === "pools_code_key") continue;
        throw error;
      }
    }
    const [row] = rows;
    if (!row) throw new Error(`Pool ${chainPoolId} (tx ${txHash}) was not saved`);
    return this.view(row, user.id);
  }

  /** Anyone with the link can view a pool; `viewer` adds their own membership. */
  async get(poolId: string, viewer: AuthUser | null): Promise<PoolView> {
    return this.view(await this.load(poolId), viewer?.id ?? null);
  }

  /** Joins without paying. Joining again returns the existing membership. */
  async join(user: AuthUser, poolId: string, input: z.infer<typeof JoinPoolInput>): Promise<PoolView> {
    const pool = await this.load(poolId);
    await this.wallets.ensureUser(user);
    if (await this.member(pool.id, user.id)) return this.view(pool, user.id);

    const fieldValues = validateFieldValues(pool.fields, input.fieldValues);
    const keypair = await this.wallets.keypair(user.id);
    const txHash = await this.onChain(() => this.contract.joinPool(keypair, BigInt(pool.chain_pool_id)));
    await this.db.query(
      `insert into pool_members (pool_id, user_id, field_values, join_tx_hash) values ($1, $2, $3, $4)
       on conflict do nothing`,
      [pool.id, user.id, JSON.stringify(fieldValues), txHash],
    );
    return this.view(pool, user.id);
  }

  /** Pays `amount` USDC from the user's wallet into the pool, joining first if needed. */
  async contribute(
    user: AuthUser,
    poolId: string,
    input: z.infer<typeof ContributeInput>,
  ): Promise<{ contribution: ContributionView; pool: PoolView }> {
    const pool = await this.load(poolId);
    const amount = parseUsdc(input.amount);
    if (amount <= 0n) throw new ApiError(400, "invalid_amount", "The amount must be greater than zero.");
    const wallet = await this.wallets.ensureUser(user);
    const joined = (await this.member(pool.id, user.id)) !== null;
    const fieldValues = joined ? null : validateFieldValues(pool.fields, input.fieldValues);

    const balance = (await this.chain.usdcBalance(wallet.address)) ?? 0n;
    if (balance < amount) {
      throw new ApiError(
        400,
        "insufficient_funds",
        `Your wallet has ${formatUsdc(balance)} USDC. Deposit more to contribute ${formatUsdc(amount)} USDC.`,
        { balance: formatUsdc(balance) },
      );
    }

    const keypair = await this.wallets.keypair(user.id);
    const txHash = await this.onChain(() => this.contract.contribute(keypair, BigInt(pool.chain_pool_id), amount));
    const contribution = await this.db.transaction(async (client) => {
      if (fieldValues) {
        await client.query(
          `insert into pool_members (pool_id, user_id, field_values, join_tx_hash) values ($1, $2, $3, $4)
           on conflict do nothing`,
          [pool.id, user.id, JSON.stringify(fieldValues), txHash],
        );
      }
      const { rows } = await client.query<ContributionRow>(
        "insert into contributions (pool_id, user_id, amount, tx_hash) values ($1, $2, $3, $4) returning *",
        [pool.id, user.id, amount.toString(), txHash],
      );
      const row = rows[0];
      if (!row) throw new Error(`Contribution ${txHash} was not saved`);
      return row;
    });

    return {
      contribution: {
        id: contribution.id,
        amount: formatUsdc(BigInt(contribution.amount)),
        txHash: contribution.tx_hash,
        createdAt: contribution.created_at.toISOString(),
      },
      pool: await this.view(pool, user.id),
    };
  }

  /**
   * The pool admin takes a pool's USDC into their wallet. Only possible once the
   * goal was met, which can only happen before the deadline, and only once.
   */
  async withdraw(user: AuthUser, poolId: string): Promise<{ withdrawal: TransferView; pool: PoolView }> {
    const pool = await this.load(poolId);
    if (pool.admin_user_id !== user.id) {
      throw new ApiError(403, "not_pool_admin", "Only this pool's admin can withdraw.");
    }
    const chainPoolId = BigInt(pool.chain_pool_id);
    const state = await this.onChain(() => this.contract.getPool(chainPoolId));
    if (state.status === "open" || state.status === "expired") {
      throw new ApiError(409, "goal_not_reached", "This pool hasn't reached its goal yet.");
    }
    if (state.status === "settled") {
      throw new ApiError(409, "already_withdrawn", "This pool's USDC has already been withdrawn.");
    }
    if (state.status === "refunded") {
      throw new ApiError(409, "pool_refunded", "This pool missed its goal, so its USDC goes back to the contributors.");
    }

    await this.wallets.ensureUser(user);
    const keypair = await this.wallets.keypair(user.id);
    const { amount, txHash } = await this.onChain(() => this.contract.settle(keypair, chainPoolId));
    const [row] = await this.db.query<TransferRow>(
      "insert into withdrawals (pool_id, user_id, amount, tx_hash) values ($1, $2, $3, $4) returning *",
      [pool.id, user.id, amount.toString(), txHash],
    );
    if (!row) throw new Error(`Withdrawal ${txHash} was not saved`);
    return { withdrawal: toTransfer(row), pool: await this.view(pool, user.id) };
  }

  private async load(poolId: string): Promise<PoolRow> {
    if (!z.uuid().safeParse(poolId).success) throw new ApiError(404, "pool_not_found", "Pool not found.");
    const [row] = await this.db.query<PoolRow>("select * from pools where id = $1 and contract_id = $2", [
      poolId,
      this.contracts.pool,
    ]);
    if (!row) throw new ApiError(404, "pool_not_found", "Pool not found.");
    return row;
  }

  private async member(poolId: string, userId: string): Promise<MemberRow | null> {
    const [row] = await this.db.query<MemberRow>(
      "select field_values, joined_at from pool_members where pool_id = $1 and user_id = $2",
      [poolId, userId],
    );
    return row ?? null;
  }

  /** Combines the pool's details from the database with its live state from the contract. */
  private async view(row: PoolRow, viewerId: string | null): Promise<PoolView> {
    const chainPoolId = BigInt(row.chain_pool_id);
    const [state, adminAddress, member, [withdrawal]] = await Promise.all([
      this.onChain(() => this.contract.getPool(chainPoolId)),
      this.wallets.address(row.admin_user_id),
      viewerId ? this.member(row.id, viewerId) : null,
      this.db.query<TransferRow>("select amount, tx_hash, created_at from withdrawals where pool_id = $1", [row.id]),
    ]);

    let membership: Membership | null = null;
    if (member && viewerId) {
      const address = await this.wallets.address(viewerId);
      const onChain = address ? await this.onChain(() => this.contract.getMember(chainPoolId, address)) : null;
      const [refund] = await this.db.query<TransferRow>(
        "select amount, tx_hash, created_at from refunds where pool_id = $1 and wallet_address = $2",
        [row.id, address],
      );
      const contributed = onChain?.contributed ?? 0n;
      membership = {
        status: onChain?.refunded ? "refunded" : contributed > 0n ? "paid" : "pending",
        contributed: formatUsdc(contributed),
        fieldValues: member.field_values,
        joinedAt: member.joined_at.toISOString(),
        refund: refund ? toTransfer(refund) : null,
      };
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      fields: row.fields,
      goalAmount: formatUsdc(BigInt(row.goal_amount)),
      deadline: row.deadline.toISOString(),
      status: state.status,
      totalContributed: formatUsdc(state.totalContributed),
      memberCount: state.memberCount,
      admin: { userId: row.admin_user_id, walletAddress: adminAddress ?? state.admin },
      contractId: row.contract_id,
      chainPoolId: row.chain_pool_id,
      createTxHash: row.create_tx_hash,
      createdAt: row.created_at.toISOString(),
      withdrawal: withdrawal ? toTransfer(withdrawal) : null,
      membership,
      viewerIsAdmin: viewerId === row.admin_user_id,
    };
  }

  private async onChain<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw toApiError(error, this.contracts);
    }
  }
}
