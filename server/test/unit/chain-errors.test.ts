import { StrKey, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.ts";
import { toApiError } from "../../src/services/chain-errors.ts";
import { ChainError, contractFailure, findContractError } from "../../src/stellar/errors.ts";

const POOL = "CCOOBNXMOJTZVGNX7X33ZBQMBEBVITFYVBY4SS67I43UHUW5C2ZY7P2R";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const contracts = { pool: POOL, usdc: USDC };

function errorEvent(contractId: string | null, topics: xdr.ScVal[]): xdr.DiagnosticEvent {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: contractId ? xdr.ContractId.fromXdrObject(StrKey.decodeContract(contractId)) : null,
      type: xdr.ContractEventType.diagnostic,
      body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data: xdr.ScVal.scvVoid() })),
    }),
  });
}

const contractError = (contractId: string | null, code: number) =>
  errorEvent(contractId, [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(code))]);

function apiError(error: ChainError): ApiError {
  const mapped = toApiError(error, contracts);
  expect(mapped).toBeInstanceOf(ApiError);
  return mapped as ApiError;
}

describe("findContractError", () => {
  it("returns the first contract error with the contract that raised it", () => {
    const events = [
      errorEvent(POOL, [xdr.ScVal.scvSymbol("fn_call")]),
      contractError(USDC, 10),
      contractError(null, 10),
    ];
    expect(findContractError(events)).toEqual({ contractId: USDC, code: 10 });
  });

  it("ignores non-contract errors such as failed signatures", () => {
    const auth = errorEvent(null, [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceAuth(xdr.ScErrorCode.scecInvalidAction))]);
    expect(findContractError([auth])).toBeNull();
  });
});

describe("toApiError", () => {
  it("tells the token's code 10 apart from the pool's code 10", () => {
    const fromToken = apiError(contractFailure([contractError(USDC, 10)], "HostError: Error(Contract, #10)"));
    const fromPool = apiError(contractFailure([contractError(POOL, 10)], "HostError: Error(Contract, #10)"));
    expect(fromToken.code).toBe("insufficient_funds");
    expect(fromPool.code).toBe("nothing_to_refund");
  });

  it("maps every pool error, numbered from 100 and, before an upgrade, from 1", () => {
    const expected = [
      "pool_not_found",
      "invalid_amount",
      "invalid_deadline",
      "deadline_passed",
      "pool_closed",
      "already_member",
      "goal_not_reached",
      "not_refundable",
      "not_member",
      "nothing_to_refund",
    ];
    for (const first of [100, 1]) {
      const codes = expected.map((_, i) => apiError(contractFailure([contractError(POOL, first + i)], "")).code);
      expect(codes).toEqual(expected);
    }
  });

  it("maps the payout approval errors added in the second release", () => {
    const expected = [
      "approval_required",
      "no_approvers",
      "invalid_approvers",
      "not_approver",
      "payout_already_requested",
      "no_payout_request",
      "already_approved",
      "payout_pending",
      "invalid_fee",
    ];
    const codes = expected.map((_, i) => apiError(contractFailure([contractError(POOL, 110 + i)], "")).code);
    expect(codes).toEqual(expected);
  });

  it("doesn't guess when it can't tell which contract failed", () => {
    expect(apiError(contractFailure(undefined, "HostError: Error(Contract, #105)")).code).toBe("transaction_failed");
    for (const unknown of [0, 11, 99, 119]) {
      expect(apiError(contractFailure([contractError(POOL, unknown)], "")).code).toBe("transaction_failed");
    }
  });

  it("maps network conditions and keeps the transaction hash", () => {
    expect(apiError(new ChainError("busy", "", { hash: "abc" }))).toMatchObject({
      status: 503,
      code: "network_busy",
      details: { txHash: "abc" },
    });
    expect(apiError(new ChainError("timeout", "")).status).toBe(504);
    expect(apiError(new ChainError("rejected", "")).status).toBe(502);
  });

  it("passes other errors through untouched", () => {
    const error = new Error("database down");
    expect(toApiError(error, contracts)).toBe(error);
  });
});
