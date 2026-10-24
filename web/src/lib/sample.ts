/**
 * SAMPLE DATA — delete this file when the backend is merged.
 *
 * Stands in for the PoolFi API so every screen can be reviewed before the
 * backend is connected: the people, pools and amounts from the design (Naira
 * figures converted at ₦1,400 = 1 USDC), answered the way the API will answer.
 * State is kept in the browser so a refresh doesn't lose your place.
 */
import type { PoolFiApi } from "./api";
import { ApiError } from "./errors";
import { feeOf, fromNaira, grossShare, roundUsdc } from "./money";
import { CODE_LENGTH } from "./signin";
import type {
  Achievements,
  ActivityItem,
  Approver,
  CreatePoolInput,
  Diver,
  HomeAlert,
  NewDiver,
  PoolDetail,
  PoolStatus,
  PoolSummary,
  PoolType,
  Receipt,
  Transaction,
  User,
} from "./types";

const STORAGE_KEY = "poolfi-sample-v2";
/** The password of every seeded sample account. */
export const SAMPLE_PASSWORD = "poolfi123";
const MAX_TRIES = 5;
const FEE_BPS = 500;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NETWORK = "Stellar testnet";

interface SampleUser extends User {
  walletAddress: string;
  transactions: Transaction[];
  balance: number;
}

interface SampleApproval {
  userId: string;
  status: "waiting" | "approved" | "declined";
  /** A future time means the approver will act then (other people act on their own in the sample). */
  at: number | null;
}

interface SamplePayout {
  requestedAt: number;
  destination: "wallet" | "bank";
  paidAt: number | null;
  reference: string | null;
  declinedBy: { name: string; reason: string } | null;
  approvals: SampleApproval[];
}

interface SamplePool {
  id: string;
  code: string;
  emoji: string;
  name: string;
  type: PoolType;
  description: string | null;
  lifeguardId: string;
  amount: number;
  feeCovered: boolean;
  expectedCount: number;
  deadline: number;
  createdAt: number;
  approverIds: string[];
  payout: SamplePayout | null;
  cancelled: boolean;
  divers: Diver[];
  activity: ActivityItem[];
  pickYourName: boolean;
  allowNotOnList: boolean;
  diversCanShare: boolean;
  diversSeePayments?: boolean;
}

interface SampleState {
  session: string | null;
  /** Signed in with the password, waiting for the emailed code. */
  pending: { userId: string } | null;
  /** Passwords by user id; seeded accounts use SAMPLE_PASSWORD. */
  passwords: Record<string, string>;
  /** Wrong passwords in a row, by email; MAX_TRIES locks the account. */
  failures: Record<string, number>;
  resetFor: string | null;
  notificationsSeenAt?: number;
  remindersOff?: Record<string, boolean>;
  users: Record<string, SampleUser>;
  pools: SamplePool[];
  nextId: number;
}

// Seed

const FIRST = ["Ada", "Tobi", "Zainab", "Emeka", "Kelechi", "Ngozi", "Chinedu", "Amaka", "Funke", "Ike", "Musa", "Halima", "Segun", "Bayo", "Chioma", "Dayo", "Kemi", "Uche", "Bisi", "Femi", "Nneka", "Obinna", "Sade", "Tunde", "Yemi", "Zara", "Kunle", "Lola", "Nonso", "Ebuka", "Fatima", "Gbenga", "Hauwa", "Jide", "Mide", "Nkem", "Ope", "Peace", "Rotimi", "Somto", "Temi", "Uju", "Victor", "Wale"];
const LAST = ["Eze", "Bello", "Musa", "Okeke", "Obi", "Nwosu", "Balogun", "Ibrahim", "Chukwu", "Danjuma", "Lawal", "Ogbu", "Ajayi", "Okoro", "Afolabi", "Umeh", "Yakubu", "Oladipo"];
const AGO = [4 * MINUTE, 12 * MINUTE, 38 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, DAY, 2 * DAY];

function phone(n: number): string {
  return `+234 8${String(3 + (n % 7))}${n % 10} 555 ${String(100 + ((n * 37) % 900)).padStart(4, "0")}`;
}

function user(id: string, first: string, last: string, extra: Partial<SampleUser> = {}): SampleUser {
  return {
    id,
    firstName: first,
    lastName: last,
    email: `${first}.${last}@gmail.com`.toLowerCase(),
    phone: null,
    avatar: null,
    walletAddress: address(id),
    transactions: [],
    balance: 0,
    ...extra,
  };
}

/** A well-formed but made-up Stellar address. */
function address(seed: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let h = 2166136261;
  let out = "G";
  for (let i = 0; i < 55; i++) {
    h = Math.imul(h ^ (seed.charCodeAt(i % seed.length) + i), 16777619) >>> 0;
    out += alphabet[h % 32];
  }
  return out;
}

function divers(now: number, code: string, share: number, count: number, paid: number, first: string[] = []): Diver[] {
  const names: string[] = [...first];
  for (let i = 0; names.length < count; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`;
    if (!names.includes(name)) names.push(name);
  }
  return names.map((name, k) => ({
    id: `${code}-d${k + 1}`,
    name,
    contact: phone(k + code.length),
    paid: k < paid,
    paidAt: k < paid ? new Date(now - AGO[k % AGO.length] - k * MINUTE).toISOString() : null,
    amount: k < paid ? share : 0,
    lastRemindedAt: k >= paid && k % 3 === 0 ? new Date(now - DAY).toISOString() : null,
    onList: true,
    userId: null,
    receiptRef: k < paid ? `PF-R-${code.slice(3)}-${String(400 + k).padStart(4, "0")}` : null,
  }));
}

function activity(poolId: string, kind: ActivityItem["kind"], title: string, at: number, amount: number | null = null, actorName: string | null = null): ActivityItem {
  return { id: `${poolId}-${kind}-${at}`, kind, title, at: new Date(at).toISOString(), amount, actorName, poolId };
}

function seed(): SampleState {
  const now = Date.now();
  const users: Record<string, SampleUser> = {
    judith: user("judith", "Judith", "Okafor", { phone: "+234 803 555 0142" }),
    tayo: user("tayo", "Tayo", "Adeyemi", { phone: "+234 816 555 0199", avatar: { kind: "emoji", emoji: "⚽", bg: "#FEF0C7" } }),
    ngozi: user("ngozi", "Ngozi", "Obi"),
    chidi: user("chidi", "Chidi", "Okeke"),
    musa: user("musa", "Musa", "Ibrahim"),
    ada: user("ada", "Ada", "Eze"),
    tobi: user("tobi", "Tobi", "Bello"),
    zainab: user("zainab", "Zainab", "Musa"),
    kelechi: user("kelechi", "Kelechi", "Obi"),
    ngoziOkoro: user("ngoziOkoro", "Ngozi", "Okoro"),
    tola: user("tola", "Tola", "Ajayi"),
    kunle: user("kunle", "Kunle", "Bello"),
  };

  const dues = fromNaira(2000);
  const duesDivers = divers(now, "PF-7K2Q", dues, 60, 41, ["Ada Eze", "Ngozi Musa", "Tobi Bello", "Zainab Musa"]);
  duesDivers[41] = { ...duesDivers[41], name: "Tayo Adeyemi", userId: "tayo", lastRemindedAt: new Date(now - DAY).toISOString() };
  duesDivers[42] = { ...duesDivers[42], name: "Kelechi Obi", lastRemindedAt: null };

  const tees = fromNaira(4500);
  const bday = fromNaira(5000);
  const bdayDivers = divers(now, "PF-9BD4", bday, 20, 14, ["Judith Okafor"]);
  bdayDivers[0] = { ...bdayDivers[0], userId: "judith", paidAt: new Date(now - 3 * DAY).toISOString() };
  const gift = fromNaira(10000);
  const sendforth = fromNaira(2000);
  const fuel = fromNaira(3000);
  const fuelDivers = divers(now - 13 * DAY, "PF-FU17", fuel, 20, 9, ["Judith Okafor", "Tayo Adeyemi"]);
  fuelDivers[0] = { ...fuelDivers[0], userId: "judith" };
  fuelDivers[1] = { ...fuelDivers[1], userId: "tayo" };

  const pools: SamplePool[] = [
    {
      id: "dues", code: "PF-7K2Q", emoji: "🎓", name: "300L Class Dues", type: "Class dues", description: "Dues for the 2026/27 session.",
      lifeguardId: "judith", amount: dues, feeCovered: false, expectedCount: 60, deadline: now + 2 * DAY + 14 * HOUR, createdAt: now - 5 * DAY,
      approverIds: ["ada", "tobi", "zainab"], payout: null, cancelled: false, divers: duesDivers,
      activity: [
        activity("dues", "payment", "Ada Eze paid into 300L Class Dues", now - 4 * MINUTE, dues, "Ada Eze"),
        activity("dues", "payment", "Tobi Bello paid into 300L Class Dues", now - 12 * MINUTE, dues, "Tobi Bello"),
        activity("dues", "reminder", "You reminded 19 divers in 300L Class Dues", now - 3 * HOUR, null, "Judith Okafor"),
      ],
      pickYourName: true, allowNotOnList: true, diversCanShare: true,
    },
    {
      id: "tees", code: "PF-3TQ8", emoji: "👕", name: "Department week T-shirts", type: "Something else", description: null,
      lifeguardId: "judith", amount: tees, feeCovered: false, expectedCount: 40, deadline: now + DAY, createdAt: now - 9 * DAY,
      approverIds: ["ada", "kelechi", "ngoziOkoro"], payout: null, cancelled: false, divers: divers(now, "PF-3TQ8", tees, 40, 40),
      activity: [activity("tees", "goal_met", "Department week T-shirts reached its goal", now - DAY, roundUsdc(tees * 40))],
      pickYourName: true, allowNotOnList: true, diversCanShare: true,
    },
    {
      id: "bday", code: "PF-9BD4", emoji: "🎂", name: "Ada's surprise birthday", type: "Birthday", description: null,
      lifeguardId: "ngozi", amount: bday, feeCovered: false, expectedCount: 20, deadline: now + 4 * DAY, createdAt: now - 3 * DAY,
      approverIds: ["tobi", "zainab", "kunle"], payout: null, cancelled: false, divers: bdayDivers, activity: [],
      pickYourName: true, allowNotOnList: true, diversCanShare: true,
    },
    {
      id: "gift", code: "PF-WD21", emoji: "💍", name: "Kemi & Dayo's wedding gift", type: "Wedding gift", description: null,
      lifeguardId: "chidi", amount: gift, feeCovered: false, expectedCount: 30, deadline: now - DAY, createdAt: now - 14 * DAY,
      approverIds: ["judith", "tola", "kunle"],
      payout: {
        requestedAt: now - 3 * HOUR, destination: "wallet", paidAt: null, reference: null, declinedBy: null,
        approvals: [
          { userId: "tola", status: "approved", at: now - 2 * HOUR },
          { userId: "judith", status: "waiting", at: null },
          { userId: "kunle", status: "waiting", at: null },
        ],
      },
      cancelled: false, divers: divers(now - DAY, "PF-WD21", gift, 30, 30), activity: [],
      pickYourName: true, allowNotOnList: true, diversCanShare: true,
    },
    {
      id: "sendforth", code: "PF-SF40", emoji: "💐", name: "Dr. Obi's send-forth", type: "Something else", description: null,
      lifeguardId: "judith", amount: sendforth, feeCovered: false, expectedCount: 40, deadline: now - 19 * DAY, createdAt: now - 30 * DAY,
      approverIds: [],
      payout: { requestedAt: now - 19 * DAY, destination: "wallet", paidAt: now - 19 * DAY, reference: "PF-ST-48213", declinedBy: null, approvals: [] },
      cancelled: false, divers: divers(now - 20 * DAY, "PF-SF40", sendforth, 40, 40), activity: [],
      pickYourName: true, allowNotOnList: true, diversCanShare: true,
    },
    {
      id: "fuel", code: "PF-FU17", emoji: "⛽", name: "Hostel generator fuel", type: "Something else", description: null,
      lifeguardId: "musa", amount: fuel, feeCovered: false, expectedCount: 20, deadline: now - 13 * DAY, createdAt: now - 20 * DAY,
      approverIds: [], payout: null, cancelled: false, divers: fuelDivers, activity: [],
      pickYourName: true, allowNotOnList: true, diversCanShare: true,
    },
  ];

  const payoutNet = roundUsdc(sendforth * 40 - feeOf(sendforth * 40, FEE_BPS));
  users.judith.transactions = [
    tx("j1", "deposit", "USDC deposit", now - 15 * DAY, 12.5, "in"),
    tx("j2", "contribution", "Paid into Ada's surprise birthday", now - 3 * DAY, bday, "out"),
    tx("j3", "refund", "Refund from Hostel generator fuel", now - 13 * DAY, fuel, "in"),
    tx("j4", "contribution", "Paid into Hostel generator fuel", now - 19 * DAY, fuel, "out"),
    tx("j5", "payout", "Payout from Dr. Obi's send-forth", now - 19 * DAY, payoutNet, "in"),
  ].sort((a, b) => b.at.localeCompare(a.at));
  users.judith.balance = roundUsdc(users.judith.transactions.reduce((s, t) => s + (t.direction === "in" ? t.amount : -t.amount), 0));

  return { session: null, pending: null, passwords: {}, failures: {}, resetFor: null, users, pools, nextId: 1 };
}

function tx(id: string, kind: Transaction["kind"], title: string, at: number, amount: number, direction: "in" | "out"): Transaction {
  return { id, kind, title, at: new Date(at).toISOString(), amount: roundUsdc(amount), direction, txHash: null };
}

// State, kept in the browser

let state: SampleState | null = null;

function load(): SampleState {
  if (state) return state;
  try {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    state = saved ? (JSON.parse(saved) as SampleState) : seed();
  } catch {
    state = seed();
  }
  return state;
}

function save() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private windows can refuse storage; the sample still works until reload.
  }
}

/** Like a network call: a short wait so loading states show. */
function respond<T>(value: () => T, ms = 350): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const result = value();
        save();
        resolve(structuredClone(result));
      } catch (error) {
        reject(error);
      }
    }, ms);
  });
}

function me(s: SampleState): SampleUser {
  const u = s.session ? s.users[s.session] : null;
  if (!u) throw new ApiError("unauthenticated", "Sign in to continue.");
  return u;
}

function fullName(u: User): string {
  return `${u.firstName} ${u.lastName}`.trim();
}

function findPool(s: SampleState, id: string): SamplePool {
  const p = s.pools.find((x) => x.id === id);
  if (!p) throw new ApiError("pool_not_found", "Pool not found.");
  return p;
}

// Derived pool state

function shareOf(p: SamplePool): number {
  return grossShare(p.amount, FEE_BPS, p.feeCovered);
}

function raisedOf(p: SamplePool): number {
  return roundUsdc(p.divers.reduce((sum, d) => sum + (d.paid ? d.amount : 0), 0));
}

function goalOf(p: SamplePool): number {
  return roundUsdc(shareOf(p) * p.expectedCount);
}

function neededOf(p: SamplePool): number {
  return p.approverIds.length ? Math.floor(p.approverIds.length / 2) + 1 : 0;
}

/** Lets other approvers act when their time comes, and pays out once enough have approved. */
function settleApprovals(s: SampleState, p: SamplePool, now: number) {
  const payout = p.payout;
  if (!payout || payout.paidAt || payout.declinedBy) return;
  const approved = payout.approvals.filter((a) => a.status === "approved" && a.at !== null && a.at <= now);
  if (approved.length >= neededOf(p)) {
    const at = Math.max(...approved.map((a) => a.at ?? 0));
    payOut(s, p, at);
  }
}

function payOut(s: SampleState, p: SamplePool, at: number) {
  const payout = p.payout;
  if (!payout) return;
  const gross = raisedOf(p);
  const net = roundUsdc(gross - feeOf(gross, FEE_BPS));
  payout.paidAt = at;
  payout.reference = `PF-ST-${String(10000 + ((at / 1000) % 90000)).slice(0, 5)}`;
  const lifeguard = s.users[p.lifeguardId];
  lifeguard.balance = roundUsdc(lifeguard.balance + net);
  lifeguard.transactions.unshift(tx(`payout-${p.id}`, "payout", `Payout from ${p.name}`, at, net, "in"));
  p.activity.unshift(activity(p.id, "payout", `${p.name} paid out to ${fullName(lifeguard)}`, at, net, fullName(lifeguard)));
}

function statusOf(p: SamplePool, now: number): PoolStatus {
  if (p.payout?.paidAt) return "paidout";
  if (p.cancelled) return "refunded";
  const met = raisedOf(p) >= goalOf(p);
  if (!met && now >= p.deadline) return "refunded";
  if (p.payout && !p.payout.declinedBy) return "approval";
  return met ? "met" : "active";
}

/** Refunds everyone in a pool that missed its goal, as the backend's refund job does. */
function refundIfNeeded(s: SampleState, p: SamplePool, now: number) {
  if (statusOf(p, now) !== "refunded") return;
  for (const d of p.divers) {
    if (!d.paid || !d.userId) continue;
    const u = s.users[d.userId];
    if (u.transactions.some((t) => t.id === `refund-${p.id}`)) continue;
    if (u.id === "judith" && p.id === "fuel") continue; // seeded already
    u.balance = roundUsdc(u.balance + d.amount);
    u.transactions.unshift(tx(`refund-${p.id}`, "refund", `Refund from ${p.name}`, Math.max(p.deadline, now), d.amount, "in"));
  }
}

function tick(s: SampleState) {
  const now = Date.now();
  for (const p of s.pools) {
    settleApprovals(s, p, now);
    refundIfNeeded(s, p, now);
  }
}

function roleOf(p: SamplePool, userId: string): PoolSummary["role"] | null {
  if (p.lifeguardId === userId) return "lifeguard";
  if (p.approverIds.includes(userId)) return "approver";
  if (p.divers.some((d) => d.userId === userId)) return "diver";
  return null;
}

function summary(s: SampleState, p: SamplePool, userId: string): PoolSummary {
  const now = Date.now();
  const lifeguard = s.users[p.lifeguardId];
  const role = roleOf(p, userId) ?? "diver";
  // Only the lifeguard and approvers are sent the money totals.
  const totals = role !== "diver";
  return {
    id: p.id,
    code: p.code,
    emoji: p.emoji,
    name: p.name,
    type: p.type,
    role,
    status: statusOf(p, now),
    share: shareOf(p),
    expectedCount: p.expectedCount,
    progress: goalOf(p) > 0 ? Math.min(100, Math.floor((raisedOf(p) / goalOf(p)) * 100)) : 0,
    goal: totals ? goalOf(p) : null,
    raised: totals ? raisedOf(p) : null,
    paidCount: p.divers.filter((d) => d.paid).length,
    deadline: new Date(p.deadline).toISOString(),
    lifeguard: { id: lifeguard.id, name: fullName(lifeguard) },
    youPaid: p.divers.some((d) => d.userId === userId && d.paid),
  };
}

function detail(s: SampleState, p: SamplePool, userId: string): PoolDetail {
  const now = Date.now();
  const base = summary(s, p, userId);
  const gross = raisedOf(p);
  const fee = feeOf(gross, FEE_BPS);
  const approvers: Approver[] = p.approverIds.map((id) => {
    const a = p.payout?.approvals.find((x) => x.userId === id);
    const acted = a && a.at !== null && a.at <= now;
    return {
      userId: id,
      name: fullName(s.users[id]),
      avatar: s.users[id].avatar ?? undefined,
      status: acted ? (a.status as Approver["status"]) : "waiting",
      at: acted ? new Date(a.at as number).toISOString() : null,
    };
  });
  const mine = p.divers.find((d) => d.userId === userId);
  return {
    ...base,
    description: p.description,
    createdAt: new Date(p.createdAt).toISOString(),
    feeBps: FEE_BPS,
    feeCoveredByDivers: p.feeCovered,
    approvers,
    approvalsNeeded: neededOf(p),
    payout: p.payout && {
      requestedAt: new Date(p.payout.requestedAt).toISOString(),
      destination: p.payout.destination,
      gross: base.raised === null ? null : gross,
      fee: base.raised === null ? null : fee,
      net: base.raised === null ? null : roundUsdc(gross - fee),
      approvalsNeeded: neededOf(p),
      approvals: approvers.filter((a) => a.status === "approved").length,
      paidAt: p.payout.paidAt ? new Date(p.payout.paidAt).toISOString() : null,
      reference: p.payout.reference,
      declinedBy: p.payout.declinedBy,
    },
    // Phone numbers and emails are only for the lifeguard; unless allowed, a diver sees only their own payment.
    divers:
      base.role === "lifeguard"
        ? p.divers
        : p.divers
            .filter((d) => p.diversSeePayments || base.role === "approver" || d.userId === userId)
            .map((d) => ({ ...d, contact: null })),
    pickYourName: p.pickYourName,
    allowNotOnList: p.allowNotOnList,
    diversCanShare: p.diversCanShare,
    diversSeePayments: Boolean(p.diversSeePayments),
    activity: [...p.activity]
      .filter((a) => a.kind !== "payment" || p.diversSeePayments || base.role !== "diver" || a.actorName === fullName(s.users[userId]))
      .sort((a, b) => b.at.localeCompare(a.at)),
    yourRefund: base.status === "refunded" && mine?.paid ? mine.amount : null,
    yourReceiptRef: mine?.receiptRef ?? null,
    closedAt: p.payout?.paidAt ? new Date(p.payout.paidAt).toISOString() : base.status === "refunded" ? new Date(p.deadline).toISOString() : null,
    totalRefunded: base.raised === null ? null : base.status === "refunded" ? raisedOf(p) : 0,
  };
}

function visiblePools(s: SampleState, userId: string): SamplePool[] {
  return s.pools.filter((p) => roleOf(p, userId) !== null);
}

function receiptFor(s: SampleState, ref: string): Receipt | null {
  for (const p of s.pools) {
    const d = p.divers.find((x) => x.receiptRef === ref);
    if (d && d.paidAt) {
      return {
        ref,
        amount: d.amount,
        poolName: p.name,
        poolEmoji: p.emoji,
        lifeguardName: fullName(s.users[p.lifeguardId]),
        paidBy: d.name,
        method: "USDC from PoolFi wallet",
        paidAt: d.paidAt,
        status: "confirmed",
        txHash: null,
      };
    }
  }
  return null;
}

function newCode(s: SampleState): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let code = "PF-";
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
    if (!s.pools.some((p) => p.code === code)) return code;
  }
}

/** The Me screen's streak and badges, from what the signed-in sample user has done. */
function sampleAchievements(s: SampleState): Achievements {
  const u = me(s);
  const mine = s.pools.filter((p) => roleOf(p, u.id));
  const paid = s.pools.filter((p) => p.divers.some((d) => d.userId === u.id && d.paid));
  const early = paid.some((p) => p.divers.some((d) => d.userId === u.id && d.paidAt && new Date(d.paidAt).getTime() - p.createdAt < DAY));
  return {
    streak: paid.length,
    emailVerified: true,
    remindersOn: !s.remindersOff?.[u.id],
    badges: [
      { id: "early", icon: "⚡", name: "Early diver", detail: "Paid within a day", earned: early },
      { id: "first_pool", icon: "🛟", name: "First pool", detail: "Started a pool", earned: s.pools.some((p) => p.lifeguardId === u.id) },
      { id: "full_pool", icon: "🎉", name: "Full pool", detail: "A pool hit its goal", earned: s.pools.some((p) => p.lifeguardId === u.id && raisedOf(p) >= goalOf(p)) },
      { id: "trusted", icon: "🔑", name: "Trusted", detail: "Approved a payout", earned: s.pools.some((p) => p.payout?.approvals.some((a) => a.userId === u.id && a.status === "approved")) },
      { id: "stablecoins", icon: "🌍", name: "Diaspora diver", detail: "Paid in stablecoins", earned: paid.length > 0 },
      { id: "ten_pools", icon: "💯", name: "10 pools", detail: "Be in 10 pools", earned: mine.length >= 10 },
    ],
  };
}

// The API

export const sampleApi: PoolFiApi = {
  getSession: () =>
    respond(() => {
      const s = load();
      return s.session ? s.users[s.session] : null;
    }, 60),

  signUp: (email, password) =>
    respond(() => {
      const s = load();
      const value = email.trim().toLowerCase();
      if (Object.values(s.users).some((u) => u.email === value)) {
        throw new ApiError("account_exists", "This email already has a PoolFi account. Try signing in instead.");
      }
      const id = `user${s.nextId++}`;
      s.users[id] = { ...user(id, "", ""), email: value, phone: null };
      s.passwords[id] = password;
      s.pending = { userId: id };
    }, 600),

  signIn: (email, password) =>
    respond(() => {
      const s = load();
      const value = email.trim().toLowerCase();
      const locked = () => new ApiError("account_locked", "Your account is locked after too many wrong passwords. We emailed you a code to unlock it.");
      if ((s.failures[value] ?? 0) >= MAX_TRIES) throw locked();
      const found = Object.values(s.users).find((u) => u.email === value);
      if (!found || (s.passwords[found.id] ?? SAMPLE_PASSWORD) !== password) {
        const failures = (s.failures[value] = (s.failures[value] ?? 0) + 1);
        if (failures >= MAX_TRIES) throw locked();
        const left = MAX_TRIES - failures;
        throw new ApiError("wrong_password", `Wrong email or password. ${left} ${left === 1 ? "try" : "tries"} left before we lock the account to keep it safe.`, { attemptsLeft: left });
      }
      s.pending = { userId: found.id };
    }, 600),

  verifyCode: (code) =>
    respond(() => {
      const s = load();
      if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)) throw new ApiError("invalid_code", "That code isn't right. Check it and try again.");
      const pending = s.pending;
      if (!pending) throw new ApiError("password_required", "Sign in with your email and password first.");
      s.pending = null;
      s.session = pending.userId;
      const u = s.users[pending.userId];
      s.failures[u.email ?? ""] = 0;
      return { needsProfile: !u.firstName };
    }, 600),

  resendCode: () => respond(() => undefined, 400),

  unlockAccount: (email, code) =>
    respond(() => {
      if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)) throw new ApiError("invalid_code", "That code isn't right. Check it and try again.");
      load().failures[email.trim().toLowerCase()] = 0;
    }, 600),

  resendUnlockCode: () => respond(() => undefined, 400),

  requestPasswordReset: (email) =>
    respond(() => {
      load().resetFor = email.trim().toLowerCase();
    }, 500),

  recoveryReady: () => respond(() => Boolean(load().resetFor), 100),

  setNewPassword: (password) =>
    respond(() => {
      const s = load();
      const found = Object.values(s.users).find((u) => u.email === s.resetFor);
      if (!found) throw new ApiError("reset_link_expired", "This reset link has expired or was already used. Ask for a new one.");
      s.passwords[found.id] = password;
      s.failures[found.email ?? ""] = 0;
      s.resetFor = null;
      s.session = null;
    }, 600),

  saveProfile: ({ firstName, lastName, avatar }) =>
    respond(() => {
      const s = load();
      const u = me(s);
      Object.assign(u, { firstName: firstName.trim(), lastName: lastName.trim(), avatar });
      return u;
    }),

  signOut: () =>
    respond(() => {
      load().session = null;
    }, 150),

  getHome: () =>
    respond(() => {
      const s = load();
      tick(s);
      const u = me(s);
      const pools = visiblePools(s, u.id);
      const summaries = pools.map((p) => summary(s, p, u.id));
      const open = summaries.filter((p) => ["active", "met", "approval"].includes(p.status));
      const lockedPools = open.filter((p) => p.role === "diver" && p.youPaid);
      const locked = roundUsdc(lockedPools.reduce((sum, p) => sum + p.share, 0));
      const leading = open.filter((p) => p.role === "lifeguard");
      const alerts: HomeAlert[] = [
        ...leading.filter((p) => p.status === "met").map((p) => ({ kind: "goal_met" as const, poolId: p.id, poolName: p.name })),
        ...pools
          .filter((p) => roleOf(p, u.id) === "approver" && statusOf(p, Date.now()) === "approval")
          .filter((p) => p.payout?.approvals.find((a) => a.userId === u.id)?.status === "waiting")
          .map((p) => ({ kind: "approval_needed" as const, poolId: p.id, poolName: p.name, requester: s.users[p.lifeguardId].firstName })),
      ];
      const activityItems = pools.flatMap((p) => p.activity).sort((a, b) => b.at.localeCompare(a.at));
      return {
        balance: roundUsdc(u.balance + locked),
        available: u.balance,
        locked,
        lockedPools: lockedPools.length,
        activePools: open.length,
        contributionsIn: leading.reduce((n, p) => n + p.paidCount, 0),
        contributionsExpected: leading.reduce((n, p) => n + p.expectedCount, 0),
        alerts,
        pools: summaries.filter((p) => p.role === "lifeguard" && ["active", "met", "approval"].includes(p.status)),
        activity: activityItems.slice(0, 4),
      };
    }),

  listPools: () =>
    respond(() => {
      const s = load();
      tick(s);
      const u = me(s);
      return visiblePools(s, u.id)
        .map((p) => summary(s, p, u.id))
        .sort((a, b) => b.deadline.localeCompare(a.deadline));
    }),

  listActivity: () =>
    respond(() => {
      const s = load();
      const u = me(s);
      return visiblePools(s, u.id)
        .flatMap((p) => p.activity)
        .sort((a, b) => b.at.localeCompare(a.at));
    }),

  keepAlive: () => respond(() => undefined, 50),

  getAchievements: () => respond(() => sampleAchievements(load()), 200),

  savePreferences: ({ remindersOn }) =>
    respond(() => {
      const s = load();
      s.remindersOff = { ...s.remindersOff, [me(s).id]: !remindersOn };
      return sampleAchievements(s);
    }, 200),

  getNotifications: () =>
    respond(() => {
      const s = load();
      tick(s);
      const u = me(s);
      const seen = s.notificationsSeenAt ?? 0;
      const items = visiblePools(s, u.id)
        .flatMap((p) =>
          p.activity
            .filter((a) => a.actorName !== fullName(u) && a.kind !== "created")
            .filter((a) => a.kind !== "payment" || p.diversSeePayments || roleOf(p, u.id) !== "diver")
            .map((a) => ({
              id: a.id,
              icon: { payment: "🌊", goal_met: "🎉", approval: "🔑", payout: "💸", refund: "↩️", reminder: "📣", joined: "👋", created: "✨" }[a.kind],
              title: a.title,
              at: a.at,
              href: `/pools/${p.id}`,
            })),
        )
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 50)
        .map((n) => ({ ...n, unread: new Date(n.at).getTime() > seen }));
      return { items, unread: items.filter((n) => n.unread).length };
    }),

  // Device notifications need the real backend (and its push keys).
  getPushKey: () => respond(() => null, 50),
  savePushSubscription: () => respond(() => undefined, 50),
  deletePushSubscription: () => respond(() => undefined, 50),
  sendTestPush: () => respond(() => 0, 50),

  markNotificationsRead: () =>
    respond(() => {
      load().notificationsSeenAt = Date.now();
    }, 100),

  listContacts: () =>
    respond(() => {
      const s = load();
      const u = me(s);
      return ["ada", "tobi", "zainab", "kelechi", "ngoziOkoro", "tola", "kunle"]
        .filter((id) => id !== u.id)
        .map((id) => ({ userId: id, name: fullName(s.users[id]), detail: "In your contacts" }));
    }),

  getFeeBps: () => respond(() => FEE_BPS, 60),

  createPool: (input: CreatePoolInput) =>
    respond(() => {
      const s = load();
      const u = me(s);
      const now = Date.now();
      const id = `pool${s.nextId++}`;
      const code = newCode(s);
      const p: SamplePool = {
        id,
        code,
        emoji: input.emoji,
        name: input.name.trim(),
        type: input.type,
        description: null,
        lifeguardId: u.id,
        amount: input.amount,
        feeCovered: input.feeCoveredByDivers,
        expectedCount: Math.max(input.expectedCount, input.members.length),
        deadline: new Date(input.deadline).getTime(),
        createdAt: now,
        approverIds: input.approverIds,
        payout: null,
        cancelled: false,
        divers: input.members.map((m, k) => ({
          id: `${code}-d${k + 1}`, name: m.name, contact: m.contact || null, paid: false, paidAt: null, amount: 0,
          lastRemindedAt: null, onList: true, userId: null, receiptRef: null,
        })),
        activity: [activity(id, "created", `You created ${input.name.trim()}`, now, null, fullName(u))],
        pickYourName: input.pickYourName,
        allowNotOnList: input.allowNotOnList,
        diversCanShare: input.diversCanShare,
        diversSeePayments: input.diversSeePayments,
      };
      s.pools.unshift(p);
      return detail(s, p, u.id);
    }, 900),

  getPool: (id) =>
    respond(() => {
      const s = load();
      tick(s);
      const u = me(s);
      const p = findPool(s, id);
      if (!roleOf(p, u.id)) throw new ApiError("pool_not_found", "Pool not found.");
      return detail(s, p, u.id);
    }),

  addDivers: (poolId, newDivers: NewDiver[]) =>
    respond(() => {
      const s = load();
      const u = me(s);
      const p = findPool(s, poolId);
      if (p.lifeguardId !== u.id) throw new ApiError("not_lifeguard", "Only the lifeguard can add people.");
      for (const m of newDivers) {
        p.divers.push({
          id: `${p.code}-d${p.divers.length + 1}`, name: m.name, contact: m.contact || null, paid: false, paidAt: null,
          amount: 0, lastRemindedAt: null, onList: true, userId: null, receiptRef: null,
        });
      }
      p.expectedCount = Math.max(p.expectedCount, p.divers.length);
      return detail(s, p, u.id);
    }, 700),

  updatePoolSettings: (poolId, settings) =>
    respond(() => {
      const s = load();
      const u = me(s);
      const p = findPool(s, poolId);
      if (p.lifeguardId !== u.id) throw new ApiError("not_pool_admin", "Only the lifeguard can change the pool's settings.");
      p.diversSeePayments = settings.diversSeePayments;
      return detail(s, p, u.id);
    }),

  remindUnpaid: (poolId) =>
    respond(() => {
      const s = load();
      const u = me(s);
      const p = findPool(s, poolId);
      const unpaid = p.divers.filter((d) => !d.paid);
      const at = new Date().toISOString();
      unpaid.forEach((d) => (d.lastRemindedAt = at));
      p.activity.unshift(activity(p.id, "reminder", `You reminded ${unpaid.length} divers in ${p.name}`, Date.now(), null, fullName(u)));
      const link = `${typeof window !== "undefined" ? window.location.origin : ""}/p/${p.code}`;
      return {
        count: unpaid.length,
        emailed: 0,
        message: `Reminder 👋 If you haven't paid your ${shareOf(p).toFixed(2)} USDC for ${p.name} yet, here's the link: ${link}`,
      };
    }),

  getRecord: (poolId) =>
    respond(() => {
      const s = load();
      tick(s);
      const u = me(s);
      const p = findPool(s, poolId);
      if (!roleOf(p, u.id)) throw new ApiError("pool_not_found", "Pool not found.");
      const pool = detail(s, p, u.id);
      const refunded = pool.status === "refunded";
      // Phone numbers and emails are only for the lifeguard.
      const lifeguard = pool.role === "lifeguard";
      return {
        pool,
        reference: p.payout?.reference ?? `PF-${p.code.slice(3)}-REC`,
        rows: p.divers.map((d, i) => ({
          index: i + 1,
          name: d.name,
          contact: lifeguard ? d.contact : null,
          paidAt: d.paidAt,
          amount: d.amount,
          status: d.paid ? (refunded ? ("refunded" as const) : ("paid" as const)) : ("not_paid" as const),
        })),
      };
    }),

  getInvite: (code) =>
    respond(() => {
      const s = load();
      tick(s);
      const p = s.pools.find((x) => x.code.toUpperCase() === code.toUpperCase());
      if (!p) throw new ApiError("pool_not_found", "This invite link doesn't match any pool.");
      const lifeguard = s.users[p.lifeguardId];
      const sum = summary(s, p, s.session ?? "");
      return {
        pool: {
          id: p.id, code: p.code, emoji: p.emoji, name: p.name, share: sum.share, deadline: sum.deadline, status: sum.status,
          paidCount: sum.paidCount, expectedCount: p.expectedCount, progress: sum.progress,
          approverCount: p.approverIds.length, pickYourName: p.pickYourName, allowNotOnList: p.allowNotOnList,
        },
        lifeguard: { name: fullName(lifeguard), avatar: lifeguard.avatar },
        names: p.pickYourName ? p.divers.map((d) => ({ id: d.id, name: d.name, paid: d.paid })) : [],
      };
    }),

  payShare: (code, as) =>
    respond(() => {
      const s = load();
      const u = me(s);
      const p = s.pools.find((x) => x.code === code);
      if (!p) throw new ApiError("pool_not_found", "Pool not found.");
      const status = statusOf(p, Date.now());
      if (status === "refunded" || status === "paidout") throw new ApiError("pool_closed", "This pool is closed.");
      if (status === "approval") throw new ApiError("payout_pending", "Payments are paused while the payout waits for approval.");
      const share = shareOf(p);
      if (u.balance < share) throw new ApiError("insufficient_funds", "Your PoolFi wallet doesn't have enough USDC.");

      let d: Diver | undefined;
      if ("diverId" in as) {
        d = p.divers.find((x) => x.id === as.diverId);
        if (!d) throw new ApiError("not_on_list", "That name isn't on the list.");
        if (d.paid) throw new ApiError("already_paid", `${d.name} has already paid.`);
      } else {
        if (!p.allowNotOnList) throw new ApiError("not_on_list", "Only people on the list can pay into this pool.");
        d = { id: `${p.code}-d${p.divers.length + 1}`, name: as.name.trim() || fullName(u), contact: u.phone ?? u.email, paid: false, paidAt: null, amount: 0, lastRemindedAt: null, onList: false, userId: null, receiptRef: null };
        p.divers.push(d);
      }
      const now = Date.now();
      const raisedBefore = raisedOf(p);
      d.paid = true;
      d.paidAt = new Date(now).toISOString();
      d.amount = share;
      d.userId = u.id;
      d.receiptRef = `PF-R-${p.code.slice(3)}-${String(400 + p.divers.indexOf(d)).padStart(4, "0")}`;
      u.balance = roundUsdc(u.balance - share);
      u.transactions.unshift(tx(`pay-${d.id}`, "contribution", `Paid into ${p.name}`, now, share, "out"));
      p.activity.unshift(activity(p.id, "payment", `${d.name} paid into ${p.name}`, now, share, d.name));
      if (raisedBefore < goalOf(p) && raisedOf(p) >= goalOf(p)) {
        p.activity.unshift(activity(p.id, "goal_met", `${p.name} reached its goal`, now + 1, raisedOf(p)));
      }
      const streak = Object.values(s.pools).filter((x) => x.divers.some((y) => y.userId === u.id && y.paid)).length;
      const early = now - p.createdAt < (p.deadline - p.createdAt) * 0.25;
      return {
        receiptRef: d.receiptRef,
        amount: share,
        poolId: p.id,
        badges: [...(streak >= 2 ? [`🔥 ${streak}-pool streak`] : []), ...(early ? ["⚡ Early diver badge"] : [])],
      };
    }, 900),

  requestPayout: (poolId, destination) =>
    respond(() => {
      const s = load();
      const u = me(s);
      const p = findPool(s, poolId);
      if (p.lifeguardId !== u.id) throw new ApiError("not_pool_admin", "Only this pool's lifeguard can request the payout.");
      if (destination === "bank") throw new ApiError("coming_soon", "Bank payouts are coming soon.");
      const status = statusOf(p, Date.now());
      if (status !== "met") throw new ApiError("goal_not_reached", "This pool can't be paid out right now.");
      const now = Date.now();
      p.payout = {
        requestedAt: now,
        destination,
        paidAt: null,
        reference: null,
        declinedBy: null,
        // Other approvers act on their own; in the sample the first ones approve a few seconds later.
        approvals: p.approverIds.map((id, i) => ({ userId: id, status: i < neededOf(p) ? "approved" : "waiting", at: i < neededOf(p) ? now + (i + 1) * 3000 : null })),
      };
      if (!p.approverIds.length) payOut(s, p, now);
      return detail(s, p, u.id);
    }, 800),

  approvePayout: (poolId) =>
    respond(() => {
      const s = load();
      const u = me(s);
      const p = findPool(s, poolId);
      const mine = p.payout?.approvals.find((a) => a.userId === u.id);
      if (!mine) throw new ApiError("not_approver", "You're not an approver for this payout.");
      if (mine.status === "approved") throw new ApiError("already_approved", "You've already approved this payout.");
      mine.status = "approved";
      mine.at = Date.now();
      p.activity.unshift(activity(p.id, "approval", `${fullName(u)} approved the payout`, Date.now(), null, fullName(u)));
      settleApprovals(s, p, Date.now());
      return detail(s, p, u.id);
    }, 700),

  declinePayout: (poolId, reason) =>
    respond(() => {
      const s = load();
      const u = me(s);
      const p = findPool(s, poolId);
      const mine = p.payout?.approvals.find((a) => a.userId === u.id);
      if (!p.payout || !mine) throw new ApiError("not_approver", "You're not an approver for this payout.");
      mine.status = "declined";
      mine.at = Date.now();
      p.payout.declinedBy = { name: fullName(u), reason };
      p.activity.unshift(activity(p.id, "approval", `${fullName(u)} declined the payout: ${reason}`, Date.now(), null, fullName(u)));
      return detail(s, p, u.id);
    }, 600),

  getWallet: () =>
    respond(() => {
      const s = load();
      tick(s);
      const u = me(s);
      return { address: u.walletAddress, network: NETWORK, balance: u.balance, transactions: u.transactions };
    }),

  depositTestUsdc: (amount) =>
    respond(() => {
      const s = load();
      const u = me(s);
      if (!(amount > 0) || amount > 500) throw new ApiError("invalid_amount", "You can add up to 500 test USDC at a time.");
      u.balance = roundUsdc(u.balance + amount);
      u.transactions.unshift(tx(`dep-${Date.now()}`, "deposit", "USDC deposit", Date.now(), amount, "in"));
      return { address: u.walletAddress, network: NETWORK, balance: u.balance, transactions: u.transactions };
    }, 1200),

  getReceipt: (ref) =>
    respond(() => {
      const r = receiptFor(load(), ref);
      if (!r) throw new ApiError("receipt_not_found", "There's no receipt with that reference.");
      return r;
    }),

  verifyReceipt: (ref) => respond(() => receiptFor(load(), ref)),
};
