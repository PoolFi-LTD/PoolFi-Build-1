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
  /** Sends a 6-digit code by SMS or email. */
  sendCode(to: { phone: string } | { email: string }): Promise<void>;
  /** Returns whether this is a new account that still needs a profile. */
  verifyCode(code: string): Promise<{ needsProfile: boolean }>;
  saveProfile(profile: { firstName: string; lastName: string; avatar: Avatar }): Promise<User>;
  signOut(): Promise<void>;

  // Home and lists
  getHome(): Promise<HomeSummary>;
  listPools(): Promise<PoolSummary[]>;
  listActivity(): Promise<ActivityItem[]>;
  listContacts(): Promise<Contact[]>;

  // Pools
  createPool(input: CreatePoolInput): Promise<PoolDetail>;
  getPool(id: string): Promise<PoolDetail>;
  addDivers(poolId: string, divers: NewDiver[]): Promise<PoolDetail>;
  /** Marks who was reminded; returns the message to share with them. */
  remindUnpaid(poolId: string): Promise<{ count: number; message: string }>;
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

/** Sample data until the backend is merged; then this becomes the HTTP client. */
export const api: PoolFiApi = sampleApi;

export { ApiError, messageOf } from "./errors";
