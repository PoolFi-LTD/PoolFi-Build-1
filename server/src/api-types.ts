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
 * payout waiting for approvers · paidout: paid to the lifeguard · missed: the
 * deadline passed below the goal, waiting for the lifeguard to extend it or
 * refund · refunded: the lifeguard refunded everyone who paid.
 */
export type PoolStatus = "active" | "met" | "approval" | "paidout" | "missed" | "refunded";

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
  /** How full the pool is, 0 to 100. Everyone in the pool sees this. */
  progress: number;
  /** The money totals: only for the lifeguard and approvers, null for divers. */
  goal: Usdc | null;
  raised: Usdc | null;
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
  /** The amounts: only for the lifeguard and approvers, null for divers. */
  gross: Usdc | null;
  fee: Usdc | null;
  net: Usdc | null;
  approvalsNeeded: number;
  approvals: number;
  paidAt: string | null;
  reference: string | null;
  declinedBy: { name: string; reason: string } | null;
}

export interface ActivityItem {
  id: string;
  kind: "payment" | "reminder" | "goal_met" | "approval" | "payout" | "refund" | "joined" | "created" | "missed" | "extended";
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
  /** Only for the lifeguard and approvers, null for divers. */
  totalRefunded: Usdc | null;
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
  /** The lifeguard's pool missed its deadline: extend it or refund the divers. */
  | { kind: "goal_missed"; poolId: string; poolName: string }
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
    /** How full the pool is, 0 to 100. The money totals are only for the lifeguard. */
    progress: number;
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

/** The lifeguard's new deadline for a pool that missed (or is about to miss) its goal. */
export interface ExtendDeadlineInput {
  deadline: string;
}

export interface PaymentResult {
  receiptRef: string;
  amount: Usdc;
  poolId: string;
  badges: string[];
}

// The admin dashboard (/v1/admin): for the PoolFi team only (ADMIN_EMAILS).

/** The signed-in user, with whether they can open the admin dashboard. */
export interface Me extends User {
  admin: boolean;
}

export interface AdminPerson {
  id: string;
  name: string;
  email: string | null;
}

/**
 * How a user is doing. active: used PoolFi in the last 7 days · quiet: not lately ·
 * new: signed up but hasn't created, joined or paid into a pool yet.
 */
export type AdminUserState = "active" | "quiet" | "new";

/** Where the money is held, and where to look its transactions up (null: a local network). */
export interface AdminChain {
  network: string;
  poolContractId: string;
  explorer: string | null;
}

/** Everything the dashboard's front page shows. */
export interface AdminOverview {
  generatedAt: string;
  chain: AdminChain;
  kpis: {
    users: number;
    usersNew7d: number;
    activeUsers7d: number;
    pools: number;
    poolsOpen: number;
    /** Every share paid into a pool, ever. */
    collected: Usdc;
    payments: number;
    /** USDC added to wallets. */
    deposited: Usdc;
    deposits: number;
    /** In pools that haven't paid out or been refunded yet. */
    inPools: Usdc;
    /** What lifeguards were paid, after PoolFi's fee. */
    paidOut: Usdc;
    payouts: number;
    fees: Usdc;
    refunded: Usdc;
    /** Still to go back to people in pools being refunded. */
    owed: Usdc;
  };
  /** Things the team should look at; each is a count of items on the Money, Pools or People page. */
  attention: {
    refunds: number;
    wallets: number;
    poolsMissed: number;
    payoutsAwaitingApproval: number;
    lockedAccounts: number;
  };
  /** Where people get stuck, over the last 7 days unless said otherwise. */
  friction: {
    signInFailures: number;
    codesSent: number;
    codesUsed: number;
    /** All time: signed up, never created, joined or paid into a pool. */
    signedUpOnly: number;
    /** All time: a wallet that never had USDC added. */
    walletsNeverFunded: number;
    pushOn: number;
  };
  /** Day by day for the last 30 days, in Lagos time. */
  growth: { day: string; signups: number; users: number; collected: Usdc }[];
  events: AdminEvent[];
}

/** One line in the dashboard's activity feed. */
export interface AdminEvent {
  id: string;
  kind: ActivityItem["kind"] | "signup" | "deposit" | "admin";
  title: string;
  at: string;
  amount: Usdc | null;
  poolId: string | null;
  userId: string | null;
}

export interface AdminWalletInfo {
  address: string;
  /** On Stellar with a USDC trustline. */
  activated: boolean;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatar: Avatar | null;
  joinedAt: string;
  lastSeenAt: string | null;
  state: AdminUserState;
  /** Pools they're in, as lifeguard, approver or diver. */
  pools: number;
  /** Pools they started. */
  created: number;
  paid: Usdc;
  payments: number;
  deposited: Usdc;
  wallet: AdminWalletInfo | null;
  suspended: boolean;
  /** Locked after too many wrong passwords. */
  locked: boolean;
  admin: boolean;
  pushOn: boolean;
}

export interface AdminUserList {
  users: AdminUserRow[];
  /** All users matching the search, before the page limit. */
  total: number;
}

export type AdminUserFilter = "all" | AdminUserState | "suspended" | "locked";

export interface AdminUserDetail extends AdminUserRow {
  chain: AdminChain;
  suspendedAt: string | null;
  suspendedReason: string | null;
  /** Wrong passwords in a row. */
  signInFailures: number;
  /** Signed-in devices that are still open. */
  sessions: number;
  /** The wallet's USDC on Stellar right now; null when it can't hold USDC yet or Stellar didn't answer. */
  balance: Usdc | null;
  activationTx: string | null;
  poolList: AdminPoolRow[];
  contributionList: AdminContribution[];
  depositList: AdminDeposit[];
  refundList: AdminRefund[];
  payoutList: AdminPayout[];
  log: AdminAction[];
}

/**
 * A pool as the team sees it. The status is worked out from the database, so a list of
 * every pool needs no contract reads; a pool's own page also shows the contract's.
 */
export interface AdminPoolRow {
  id: string;
  code: string;
  emoji: string;
  name: string;
  type: PoolType;
  status: PoolStatus;
  lifeguard: AdminPerson;
  goal: Usdc;
  raised: Usdc;
  refunded: Usdc;
  share: Usdc;
  paidCount: number;
  expectedCount: number;
  approvers: number;
  deadline: string;
  createdAt: string;
  /** The latest payout request that wasn't declined. */
  payout: { approvals: number; needed: number; paidAt: string | null } | null;
}

export type AdminPoolFilter = "all" | PoolStatus;

export interface AdminPoolList {
  pools: AdminPoolRow[];
  /** All pools matching the search, before the page limit. */
  total: number;
}

export interface AdminPoolDetail extends AdminPoolRow {
  chain: AdminChain;
  description: string | null;
  chainPoolId: string;
  /** What the contract holding the money says right now. */
  ledger: {
    status: "open" | "funded" | "settled" | "refunded" | "expired";
    goal: Usdc;
    contributed: Usdc;
    refunded: Usdc;
    members: number;
    deadline: string;
  };
  feeBps: number;
  feeCovered: boolean;
  settings: { pickYourName: boolean; allowNotOnList: boolean; diversCanShare: boolean; diversSeePayments: boolean };
  missedNotifiedAt: string | null;
  refundChosenAt: string | null;
  refundsFinishedAt: string | null;
  divers: Diver[];
  approverList: { user: AdminPerson; vote: "approved" | "declined" | null }[];
  contributionList: AdminContribution[];
  payoutList: AdminPayout[];
  refundList: AdminRefund[];
  activity: ActivityItem[];
  /** Every transaction PoolFi sent the contract for this pool, oldest first. */
  transactions: { hash: string; kind: "created" | "joined" | "contributed" | "extended" | "payout_requested" | "voted" | "paid_out" | "refunded"; user: AdminPerson | null; amount: Usdc | null; at: string }[];
  log: AdminAction[];
}

/** A paid-out pool: what the lifeguard got. */
export interface AdminPayout {
  id: string;
  pool: { id: string; name: string; emoji: string };
  lifeguard: AdminPerson;
  gross: Usdc;
  fee: Usdc;
  net: Usdc;
  reference: string | null;
  destination: "wallet" | "bank";
  paidAt: string;
  txHash: string | null;
}

/** USDC sent back from a cancelled pool. `user` is null for a wallet that isn't a PoolFi wallet. */
export interface AdminRefund {
  id: string;
  pool: { id: string; name: string; emoji: string };
  user: AdminPerson | null;
  wallet: string;
  amount: Usdc;
  txHash: string;
  at: string;
}

export interface AdminContribution {
  id: string;
  pool: { id: string; name: string; emoji: string };
  user: AdminPerson;
  amount: Usdc;
  receiptRef: string | null;
  txHash: string;
  at: string;
}

export interface AdminDeposit {
  id: string;
  user: AdminPerson;
  amount: Usdc;
  /** Where it came from, e.g. the testnet treasury. */
  provider: string;
  txHash: string;
  at: string;
}

/** A pool being refunded: who still has to get their USDC back. */
export interface AdminRefundingPool {
  pool: AdminPoolRow;
  startedAt: string;
  /** Contributed but not yet sent back. */
  owed: Usdc;
  /** Still unfinished well after it started: the refund job keeps failing. */
  needsAttention: boolean;
}

/** A wallet the backend couldn't put on Stellar yet: its owner can't pay or be paid. */
export interface AdminWalletIssue {
  user: AdminPerson;
  address: string;
  createdAt: string;
}

export interface AdminMoney {
  chain: AdminChain;
  refunding: AdminRefundingPool[];
  wallets: AdminWalletIssue[];
  payouts: AdminPayout[];
  refunds: AdminRefund[];
  contributions: AdminContribution[];
  deposits: AdminDeposit[];
}

export interface AdminAction {
  id: string;
  admin: { id: string; email: string };
  action:
    | "suspend_user"
    | "unsuspend_user"
    | "unlock_user"
    | "sign_out_user"
    | "activate_wallet"
    | "extend_pool"
    | "close_pool"
    | "retry_refunds"
    | "run_refund_job";
  target: { kind: "user" | "pool" | "job"; id: string | null; label: string | null };
  reason: string | null;
  details: Record<string, unknown>;
  at: string;
}

/** What one run of the refund job did. */
export interface AdminJobRun {
  poolsChecked: number;
  lifeguardsAsked: number;
  refunds: number;
  failures: number;
  poolsFinished: number;
}
