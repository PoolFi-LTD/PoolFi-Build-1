/**
 * What the web app's API (/v1/app) returns and accepts: the data the screens work
 * with. Amounts are USDC as plain numbers (shown to 2 decimals); dates are ISO
 * strings. The web app imports these types, so this file is the contract between them.
 */

export type Usdc = number;

export type Avatar = { kind: "emoji"; emoji: string; bg: string } | { kind: "photo"; url: string };

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  /** Null shows initials. */
  avatar: Avatar | null;
}

/** How the signed-in user relates to a pool. */
export type Role = "lifeguard" | "diver" | "approver";

/**
 * active: collecting · met: goal reached, payout not requested · approval:
 * payout waiting for approvers · paidout: paid to the lifeguard · refunded:
 * missed the goal (or cancelled), contributors refunded.
 */
export type PoolStatus = "active" | "met" | "approval" | "paidout" | "refunded";

export type PoolType =
  | "Class dues"
  | "Birthday"
  | "Office welfare"
  | "Cooperative levy"
  | "Group trip"
  | "Wedding gift"
  | "Faith group"
  | "Something else";

export interface PoolSummary {
  id: string;
  code: string;
  emoji: string;
  name: string;
  type: PoolType;
  role: Role;
  status: PoolStatus;
  /** What each diver pays, including the fee share when divers cover the fee. */
  share: Usdc;
  expectedCount: number;
  goal: Usdc;
  raised: Usdc;
  paidCount: number;
  deadline: string;
  lifeguard: { id: string; name: string };
  youPaid: boolean;
}

export interface Diver {
  id: string;
  name: string;
  /** Phone or email, only shown to the lifeguard. */
  contact: string | null;
  paid: boolean;
  paidAt: string | null;
  amount: Usdc;
  lastRemindedAt: string | null;
  /** Added by the lifeguard (the member list) rather than joining by link. */
  onList: boolean;
  userId: string | null;
  receiptRef: string | null;
}

export interface Approver {
  userId: string;
  name: string;
  avatar?: Avatar;
  status: "waiting" | "approved" | "declined";
  at: string | null;
}

export interface Payout {
  requestedAt: string;
  destination: "wallet" | "bank";
  gross: Usdc;
  fee: Usdc;
  net: Usdc;
  approvalsNeeded: number;
  approvals: number;
  paidAt: string | null;
  reference: string | null;
  declinedBy: { name: string; reason: string } | null;
}

export interface ActivityItem {
  id: string;
  kind: "payment" | "reminder" | "goal_met" | "approval" | "payout" | "refund" | "joined" | "created";
  title: string;
  at: string;
  amount: Usdc | null;
  actorName: string | null;
  poolId: string | null;
}

export interface PoolDetail extends PoolSummary {
  description: string | null;
  createdAt: string;
  /** Platform fee in basis points (500 = 5%). */
  feeBps: number;
  feeCoveredByDivers: boolean;
  approvers: Approver[];
  approvalsNeeded: number;
  payout: Payout | null;
  divers: Diver[];
  pickYourName: boolean;
  allowNotOnList: boolean;
  diversCanShare: boolean;
  /** Divers see each other's payments. Off (the default): a diver's `divers` and `activity` hold only their own payment. */
  diversSeePayments: boolean;
  activity: ActivityItem[];
  /** The signed-in diver's own refund, on refunded pools. */
  yourRefund: Usdc | null;
  yourReceiptRef: string | null;
  closedAt: string | null;
  totalRefunded: Usdc;
}

/** A badge on the Me screen, earned by doing something in PoolFi. */
export interface Badge {
  id: "early" | "first_pool" | "full_pool" | "trusted" | "stablecoins" | "ten_pools";
  icon: string;
  name: string;
  detail: string;
  earned: boolean;
}

/** The Me screen: on-time streak, badges and preferences. */
export interface Achievements {
  /** Payments in a row with none missed (a pool joined but not paid before it closed). */
  streak: number;
  badges: Badge[];
  emailVerified: boolean;
  /** Reminder emails from lifeguards for unpaid shares. */
  remindersOn: boolean;
}

/** A line in the notifications inbox. */
export interface AppNotification {
  id: string;
  icon: string;
  title: string;
  at: string;
  /** Newer than the last time the inbox was marked read. */
  unread: boolean;
  /** Where tapping it goes. */
  href: string | null;
}

export interface NotificationsView {
  items: AppNotification[];
  unread: number;
}

export interface HomeSummary {
  balance: Usdc;
  available: Usdc;
  locked: Usdc;
  lockedPools: number;
  activePools: number;
  contributionsIn: number;
  contributionsExpected: number;
  alerts: HomeAlert[];
  pools: PoolSummary[];
  activity: ActivityItem[];
}

export type HomeAlert =
  | { kind: "goal_met"; poolId: string; poolName: string }
  | { kind: "approval_needed"; poolId: string; poolName: string; requester: string };

export interface Transaction {
  id: string;
  kind: "payout" | "refund" | "deposit" | "contribution" | "withdrawal";
  title: string;
  at: string;
  amount: Usdc;
  direction: "in" | "out";
  txHash: string | null;
}

export interface Wallet {
  address: string;
  network: string;
  balance: Usdc;
  transactions: Transaction[];
}

export interface Receipt {
  ref: string;
  amount: Usdc;
  poolName: string;
  poolEmoji: string;
  lifeguardName: string;
  paidBy: string;
  method: string;
  paidAt: string;
  status: "confirmed";
  txHash: string | null;
}

/** What anyone with the invite link sees. */
export interface InviteView {
  pool: {
    id: string;
    code: string;
    emoji: string;
    name: string;
    share: Usdc;
    deadline: string;
    status: PoolStatus;
    paidCount: number;
    expectedCount: number;
    raised: Usdc;
    goal: Usdc;
    approverCount: number;
    pickYourName: boolean;
    allowNotOnList: boolean;
  };
  lifeguard: { name: string; avatar: Avatar | null };
  /** Names only: contacts are never shown on the public page. */
  names: { id: string; name: string; paid: boolean }[];
}

export interface PoolRecord {
  pool: PoolDetail;
  reference: string;
  rows: {
    index: number;
    name: string;
    contact: string | null;
    paidAt: string | null;
    amount: Usdc;
    status: "paid" | "not_paid" | "refunded";
  }[];
}

export interface Contact {
  userId: string;
  name: string;
  detail: string;
}

export interface NewDiver {
  name: string;
  contact: string;
}

export interface CreatePoolInput {
  type: PoolType;
  emoji: string;
  name: string;
  /** What the lifeguard receives per person, before any fee share. */
  amount: Usdc;
  feeCoveredByDivers: boolean;
  expectedCount: number;
  deadline: string;
  approverIds: string[];
  members: NewDiver[];
  pickYourName: boolean;
  allowNotOnList: boolean;
  diversCanShare: boolean;
  /** Divers see each other's payments; off unless the lifeguard turns it on. */
  diversSeePayments: boolean;
}

export interface PaymentResult {
  receiptRef: string;
  amount: Usdc;
  poolId: string;
  badges: string[];
}
