import { httpApi } from "./api-http";
import { sampleApi } from "./sample";
import type {
  ActivityItem,
  Avatar,
  Contact,
  CreatePoolInput,
  HomeSummary,
  InviteView,
  NewDiver,
  PaymentResult,
  PoolDetail,
  PoolRecord,
  PoolSummary,
  Receipt,
  User,
  Wallet,
} from "./types";

/** Everything the screens ask of the backend. */
export interface PoolFiApi {
  // Sign-in
  getSession(): Promise<User | null>;
  /** Emails a 6-digit sign-in code. */
  sendCode(email: string): Promise<void>;
  /** Returns whether this is a new account that still needs a profile. */
  verifyCode(code: string, email?: string): Promise<{ needsProfile: boolean }>;
  saveProfile(profile: { firstName: string; lastName: string; avatar: Avatar }): Promise<User>;
  signOut(): Promise<void>;

  // Home and lists
  getHome(): Promise<HomeSummary>;
  listPools(): Promise<PoolSummary[]>;
  listActivity(): Promise<ActivityItem[]>;
  listContacts(): Promise<Contact[]>;

  // Pools
  /** PoolFi's payout fee in basis points (500 = 5%), as the contract takes it. */
  getFeeBps(): Promise<number>;
  createPool(input: CreatePoolInput): Promise<PoolDetail>;
  getPool(id: string): Promise<PoolDetail>;
  addDivers(poolId: string, divers: NewDiver[]): Promise<PoolDetail>;
  /** Marks who was reminded and emails those with an email address; returns the message to share with the rest. */
  remindUnpaid(poolId: string): Promise<{ count: number; emailed: number; message: string }>;
  getRecord(poolId: string): Promise<PoolRecord>;

  // The invite link (public)
  getInvite(code: string): Promise<InviteView>;
  /** Pays the diver's share from their PoolFi wallet, as `diverId` from the list or a new `name`. */
  payShare(code: string, as: { diverId: string } | { name: string }): Promise<PaymentResult>;

  // Payouts
  requestPayout(poolId: string, destination: "wallet" | "bank"): Promise<PoolDetail>;
  approvePayout(poolId: string): Promise<PoolDetail>;
  declinePayout(poolId: string, reason: string): Promise<PoolDetail>;

  // Wallet
  getWallet(): Promise<Wallet>;
  /** Testnet only: adds test USDC to the wallet. */
  depositTestUsdc(amount: number): Promise<Wallet>;

  // Receipts
  getReceipt(ref: string): Promise<Receipt>;
  /** Public check of a receipt reference; null if PoolFi has no such payment. */
  verifyReceipt(ref: string): Promise<Receipt | null>;
}

/**
 * The real backend once Supabase sign-in is set up (NEXT_PUBLIC_SUPABASE_URL);
 * until then, the sample data in sample.ts, which goes once that's done.
 */
export const api: PoolFiApi = process.env.NEXT_PUBLIC_SUPABASE_URL ? httpApi : sampleApi;

export { ApiError, messageOf } from "./errors";
