import { StrKey, type xdr } from "@stellar/stellar-sdk";

/** Why a Stellar call failed, before it's turned into an API response. */
export class ChainError extends Error {
  constructor(
    readonly kind: "contract" | "rejected" | "busy" | "timeout",
    message: string,
    readonly details: {
      /** The contract whose error code this is. Pool and token codes overlap, so this matters. */
      contractId?: string | null;
      code?: number;
      result?: unknown;
      hash?: string;
    } = {},
  ) {
    super(message);
  }
}

const text = new TextDecoder();

/**
 * Finds the first contract error in a call's diagnostic events, with the
 * contract that raised it. The first one is where the failure started: when
 * the USDC token fails inside a pool call, its event comes before the pool's.
 */
export function findContractError(
  events: readonly xdr.DiagnosticEvent[] | undefined,
): { contractId: string | null; code: number } | null {
  for (const event of events ?? []) {
    const { contractId, body } = event.toXdrObject().event;
    const [first, second] = body.v0.topics;
    if (first?.type !== 15 || second?.type !== 2) continue;
    if (text.decode(first.sym.bytes) !== "error" || second.error.type !== 0) continue;
    return {
      contractId: contractId ? StrKey.encodeContract(Buffer.from(contractId)) : null,
      code: second.error.contractCode,
    };
  }
  return null;
}

/** A failed contract call, from its diagnostic events or, failing that, the error text. */
export function contractFailure(
  events: readonly xdr.DiagnosticEvent[] | undefined,
  message: string,
  hash?: string,
): ChainError {
  const found = findContractError(events);
  if (found) return new ChainError("contract", message, { ...found, hash });
  const code = message.match(/Error\(Contract, #(\d+)\)/)?.[1];
  return code
    ? new ChainError("contract", message, { contractId: null, code: Number(code), hash })
    : new ChainError("rejected", message, { hash });
}

/** A transaction the network rejected or that failed when applied. */
export function transactionFailure(
  result: xdr.TransactionResult | undefined,
  events: readonly xdr.DiagnosticEvent[] | undefined,
  hash: string,
): ChainError {
  const summary = result?.toJson();
  if (findContractError(events)) return contractFailure(events, `Transaction ${hash} failed`, hash);
  return new ChainError("rejected", `Transaction ${hash} was rejected: ${JSON.stringify(summary)}`, {
    result: summary,
    hash,
  });
}
