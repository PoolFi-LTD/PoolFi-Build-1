import { httpApi } from "./api-http";
import { sampleApi } from "./sample";
import type {
  Achievements,
  ActivityItem,
  Avatar,
  Contact,
  CreatePoolInput,
  HomeSummary,
  InviteView,
  NotificationsView,
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
  // Sign-in: a password, then a 6-digit code PoolFi emails
  getSession(): Promise<User | null>;
  /** Creates the account, then emails a code to confirm the email address. */
  signUp(email: string, password: string): Promise<void>;
  /**
   * Checks the password, then emails a code. A wrong password fails with "wrong_password"
   * (details.attemptsLeft); the fifth in a row locks the account ("account_locked").
   */
  signIn(email: string, password: string): Promise<void>;
  /** Confirms the emailed code; returns whether this is a new account that still needs a profile. */
  verifyCode(code: string): Promise<{ needsProfile: boolean }>;
  resendCode(): Promise<void>;
  /** A locked account: unlocks it with the code emailed when it locked. */
  unlockAccount(email: string, code: string): Promise<void>;
  resendUnlockCode(email: string): Promise<void>;
  /** Emails a link to choose a new password: the only sign-in link PoolFi sends. */
  requestPasswordReset(email: string): Promise<void>;
  /** Whether this page was opened from a reset link that still works. */
  recoveryReady(): Promise<boolean>;
  /** On the page that link opens: sets the new password. Then everyone signs in again. */
  setNewPassword(password: string): Promise<void>;
  saveProfile(profile: { firstName: string; lastName: string; avatar: Avatar }): Promise<User>;
  /** The Me screen: on-time streak, badges and preferences. */
  getAchievements(): Promise<Achievements>;
  savePreferences(preferences: { remindersOn: boolean }): Promise<Achievements>;
  signOut(): Promise<void>;

  // Home and lists
  getHome(): Promise<HomeSummary>;
  listPools(): Promise<PoolSummary[]>;
  listActivity(): Promise<ActivityItem[]>;
  /** The notifications inbox, and how many are new since it was last marked read. */
  getNotifications(): Promise<NotificationsView>;
  markNotificationsRead(): Promise<void>;
  listContacts(): Promise<Contact[]>;

  // Pools
  /** PoolFi's payout fee in basis points (500 = 5%), as the contract takes it. */
  getFeeBps(): Promise<number>;
  createPool(input: CreatePoolInput): Promise<PoolDetail>;
  getPool(id: string): Promise<PoolDetail>;
  addDivers(poolId: string, divers: NewDiver[]): Promise<PoolDetail>;
  /** The lifeguard's switch: whether divers see each other's payments. */
  updatePoolSettings(poolId: string, settings: { diversSeePayments: boolean }): Promise<PoolDetail>;
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
