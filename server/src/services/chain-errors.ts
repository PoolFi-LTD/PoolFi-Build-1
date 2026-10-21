import { ApiError } from "../errors.ts";
import { ChainError } from "../stellar/errors.ts";

interface Mapped {
  status: number;
  code: string;
  message: string;
}

/** The pool contract's `Error` enum (contracts/pool/src/lib.rs), in order. */
const POOL_ERROR_LIST: Mapped[] = [
  { status: 404, code: "pool_not_found", message: "Pool not found." },
  { status: 400, code: "invalid_amount", message: "The amount must be greater than zero." },
  { status: 400, code: "invalid_deadline", message: "The deadline must be in the future." },
  { status: 409, code: "deadline_passed", message: "This pool's deadline has passed." },
  { status: 409, code: "pool_closed", message: "This pool is closed." },
  { status: 409, code: "already_member", message: "You have already joined this pool." },
  { status: 409, code: "goal_not_reached", message: "This pool hasn't reached its goal yet." },
  { status: 409, code: "not_refundable", message: "This pool can't be refunded." },
  { status: 403, code: "not_member", message: "You haven't joined this pool." },
  { status: 409, code: "nothing_to_refund", message: "There is nothing to refund." },
  { status: 409, code: "approval_required", message: "This pool's payout needs its approvers." },
  { status: 409, code: "no_approvers", message: "This pool has no approvers." },
  { status: 400, code: "invalid_approvers", message: "Pick up to 10 different approvers, not including yourself." },
  { status: 403, code: "not_approver", message: "You're not an approver for this pool." },
  { status: 409, code: "payout_already_requested", message: "The payout is already waiting for approvers." },
  { status: 409, code: "no_payout_request", message: "There's no payout waiting for approval." },
  { status: 409, code: "already_approved", message: "You've already approved this payout." },
  { status: 409, code: "payout_pending", message: "Payments are paused while the payout waits for approvers." },
  { status: 400, code: "invalid_fee", message: "That fee isn't allowed." },
];

/**
 * Current contract code numbers these errors from 100. Deployments not yet
 * upgraded number them from 1 (and only have the first ten), so both are understood.
 */
const POOL_ERRORS: Record<number, Mapped> = Object.fromEntries(
  POOL_ERROR_LIST.flatMap((mapped, i) => [
    [100 + i, mapped],
    [1 + i, mapped],
  ]),
);

/** Errors from the USDC token (Stellar Asset Contract) that a pool call can run into. */
const TOKEN_ERRORS: Record<number, Mapped> = {
  10: { status: 400, code: "insufficient_funds", message: "Your wallet doesn't have enough USDC." },
  11: { status: 403, code: "wallet_frozen", message: "Your wallet isn't allowed to hold USDC right now." },
  13: { status: 409, code: "wallet_not_ready", message: "Your wallet isn't set up for USDC yet." },
};

/**
 * Turns a Stellar failure into the API error users see. Pool and token error
 * codes overlap (both use 10, for example), so the contract that raised the
 * error decides which table applies.
 */
export function toApiError(error: unknown, contracts: { pool: string; usdc: string }): unknown {
  if (!(error instanceof ChainError)) return error;
  const { contractId, code, hash } = error.details;
  const details = hash ? { txHash: hash } : undefined;

  if (error.kind === "contract" && code !== undefined) {
    const table = contractId === contracts.pool ? POOL_ERRORS : contractId === contracts.usdc ? TOKEN_ERRORS : {};
    const mapped = table[code];
    if (mapped) return new ApiError(mapped.status, mapped.code, mapped.message, details);
  }
  if (error.kind === "busy") {
    return new ApiError(503, "network_busy", "The Stellar network is busy. Try again in a moment.", details);
  }
  if (error.kind === "timeout") {
    return new ApiError(504, "network_timeout", "Stellar didn't confirm the transaction in time. Check again shortly.", details);
  }
  return new ApiError(502, "transaction_failed", "The transaction couldn't be completed.", details);
}
