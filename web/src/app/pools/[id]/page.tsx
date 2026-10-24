"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Celebration, dropCoin } from "@/components/motion";
import { ActivityRow, DiverRow, WaterTank } from "@/components/pool";
import { useSession, useToast } from "@/components/providers";
import { RemindModal, ShareModal } from "@/components/share";
import { AppShell, PageHead } from "@/components/shells";
import { ComingSoon, EmptyState, ErrorText, Loaded, Money, Segmented, StatusPill, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { countdown, dayDate, fullDateTime } from "@/lib/format";
import { useAction, useNow, useResource } from "@/lib/hooks";
import { formatAmount, formatUsdc } from "@/lib/money";
import type { Diver, PoolDetail } from "@/lib/types";
import s from "./pool.module.css";

type Tab = "divers" | "activity" | "details";
type Filter = "all" | "paid" | "pending";

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className={s.stat}>
      <div className={s.statValue}>{value}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}

const SEEN_KEY = "poolfi-seen";
const POLL_MS = 15000;

/** What this browser last saw of a pool, so new payments since then can be shown arriving. */
interface Seen {
  paid: number;
  pct: number;
  status: PoolDetail["status"];
  at: string;
}

function readSeen(id: string): Seen | null {
  try {
    return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, Seen>)[id] ?? null;
  } catch {
    return null;
  }
}

function writeSeen(id: string, seen: Seen) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, Seen>;
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...all, [id]: seen }));
  } catch {
    // Storage can be off; payments just won't be marked as new next time.
  }
}

const newestFirst = (a: Diver, b: Diver) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "");

/**
 * Brings the pool to life: the tank fills from where it was when you last
 * looked, a coin drops in for each payment since then (and for any that land
 * while the page is open), and those divers' rows slide in highlighted.
 */
function usePoolMotion(pool: PoolDetail, tank: React.RefObject<HTMLDivElement | null>) {
  const [seen] = useState(() => readSeen(pool.id));
  const counted = useRef(seen?.paid ?? pool.paidCount);
  const pct = pool.progress;

  useEffect(() => {
    const arrived = pool.paidCount - counted.current;
    const first = counted.current === (seen?.paid ?? pool.paidCount);
    counted.current = pool.paidCount;
    writeSeen(pool.id, { paid: pool.paidCount, pct, status: pool.status, at: new Date().toISOString() });
    if (arrived <= 0) return;
    const newest = pool.divers.filter((d) => d.paid).sort(newestFirst).slice(0, Math.min(arrived, 3));
    // On opening, let the tank fill first. The drops aren't cancelled on re-render:
    // they're counted already, and a drop into a tank that has gone does nothing.
    newest.forEach((d, i) =>
      setTimeout(() => dropCoin(tank.current, `+${formatUsdc(d.amount || pool.share)} ${d.name.split(" ")[0]}`), (first ? 1400 : 0) + i * 450),
    );
  }, [pool, pct, seen, tank]);

  const fresh = (d: Diver) => Boolean(seen && d.paid && d.paidAt && d.paidAt > seen.at);
  const from = seen && seen.pct < pct ? seen.pct : undefined;
  return { fresh, from, seen };
}

function Tank({ pool, from, tank }: { pool: PoolDetail; from?: number; tank: React.RefObject<HTMLDivElement | null> }) {
  // Only the lifeguard (and approvers) see the money; divers see how full it is.
  const totals = pool.raised !== null && pool.goal !== null;
  return (
    <WaterTank
      ref={tank}
      pct={pool.progress}
      from={from}
      line={totals ? `${formatAmount(pool.raised ?? 0)} of ${formatUsdc(pool.goal ?? 0)}` : `${pool.paidCount} of ${pool.expectedCount} divers have paid`}
      sub={totals ? `${pool.paidCount} of ${pool.expectedCount} divers have paid` : `Only ${pool.lifeguard.name.split(" ")[0]} sees the amounts`}
    />
  );
}

/** The third stat: approvers on desktop; on phones, the time left while the pool is open (as in the design). */
function TimeOrApprovers({ pool, now }: { pool: PoolDetail; now: number }) {
  const approvers = <Stat value={pool.approvers.length} label={pool.approvers.length === 1 ? "Approver" : "Approvers"} />;
  const left = pool.status === "active" ? countdown(pool.deadline, now) : null;
  if (!left) return approvers;
  return (
    <>
      <div className="hide-m">{approvers}</div>
      <div className="hide-d">
        <Stat value={left.split(" ").slice(0, 2).join(" ")} label="Left" />
      </div>
    </>
  );
}

/** The lifeguard's moment when the pool fills up: once, the first time they see it full. */
function FullPool({ pool, motion }: { pool: PoolDetail; motion: ReturnType<typeof usePoolMotion> }) {
  const router = useRouter();
  const due = pool.role === "lifeguard" && pool.status === "met" && motion.seen?.status !== "met";
  const [shown, setShown] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!due) return;
    // After the tank has had a moment to fill.
    const t = setTimeout(() => setShown(true), 1500);
    return () => clearTimeout(t);
  }, [due]);
  if (!due || !shown || closed) return null;
  return (
    <Celebration
      l1={pool.name.length <= 16 ? pool.name : "Your pool"}
      l2="is full."
      k="Raised"
      value={pool.raised ?? 0}
      format={(v) => <Money value={v} />}
      text="Everyone has paid. Request your payout whenever you are ready."
      buttons={[
        { label: "Request payout", onClick: () => router.push(`/pools/${pool.id}/payout`) },
        { label: "Not now", ghost: true, onClick: () => setClosed(true) },
      ]}
    />
  );
}

function Divers({ pool, now, showContacts, fresh }: { pool: PoolDetail; now: number; showContacts: boolean; fresh?: (d: Diver) => boolean }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const paid = pool.divers.filter((d) => d.paid).length;
  const shown = useMemo(
    () =>
      pool.divers
        .filter((d) => (filter === "paid" ? d.paid : filter === "pending" ? !d.paid : true))
        .filter((d) => d.name.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => Number(b.paid) - Number(a.paid) || (b.paidAt ?? "").localeCompare(a.paidAt ?? "")),
    [pool.divers, filter, q],
  );
  return (
    <>
      <label className="field hide-m">
        <span className="field-label">Search divers</span>
        <input className="input" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className={s.chips}>
        {(
          [
            ["all", `All ${pool.divers.length}`],
            ["paid", `Paid ${paid}`],
            ["pending", `Pending ${pool.divers.length - paid}`],
          ] as const
        ).map(([value, label]) => (
          <button key={value} className="chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className={s.list}>
        {shown.length ? (
          shown.map((d) => <DiverRow key={d.id} diver={d} now={now} contact={showContacts} fresh={fresh?.(d)} />)
        ) : (
          <p className="muted t-small" style={{ padding: 16 }}>
            {pool.divers.length ? "Nobody matches that search." : "Nobody has joined yet. Share the link to get started."}
          </p>
        )}
      </div>
    </>
  );
}

function Details({ pool }: { pool: PoolDetail }) {
  const approvers = pool.approvers.map((a) => a.name).join(", ");
  return (
    <dl className="kv">
      <div>
        <dt>Each diver pays</dt>
        <dd>
          {formatUsdc(pool.share)}
          {pool.feeCoveredByDivers ? " (fee included)" : ""}
        </dd>
      </div>
      <div>
        <dt>Divers expected</dt>
        <dd>{pool.expectedCount}</dd>
      </div>
      <div>
        <dt>Goal</dt>
        <dd>{formatUsdc(pool.goal ?? 0)}</dd>
      </div>
      <div>
        <dt>PoolFi fee</dt>
        <dd>{pool.feeBps / 100}% of the payout</dd>
      </div>
      <div>
        <dt>Approvers</dt>
        <dd>{approvers || "None, the lifeguard releases the payout"}</dd>
      </div>
      <div>
        <dt>Closes</dt>
        <dd>{fullDateTime(pool.deadline)}</dd>
      </div>
      <div>
        <dt>Pool ID</dt>
        <dd>{pool.code}</dd>
      </div>
      <div>
        <dt>Created</dt>
        <dd>{fullDateTime(pool.createdAt)}</dd>
      </div>
    </dl>
  );
}

/** The lifeguard's switch: whether divers can see each other's payments. */
function PaymentsPrivacy({ pool, reload }: { pool: PoolDetail; reload: () => void }) {
  const toast = useToast();
  const save = useAction((on: boolean) => api.updatePoolSettings(pool.id, { diversSeePayments: on }));
  return (
    <div className="kv" style={{ padding: 16, display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div className="t-h3">Divers can see who has paid</div>
          <div className="muted t-small">
            {pool.diversSeePayments
              ? "Everyone in the pool sees each payment."
              : "Each diver sees only their own payment and the totals. You and your approvers see everything."}
          </div>
        </div>
        <Toggle
          on={pool.diversSeePayments}
          onChange={async (on) => {
            if ((await save.run(on)).ok) {
              reload();
              toast(on ? "Divers can now see who has paid" : "Payments are private to each diver", on ? "👀" : "🔒");
            }
          }}
          label="Divers can see who has paid"
        />
      </div>
      <ErrorText error={save.error} />
    </div>
  );
}

/** What the lifeguard sees: who has paid and the tools to chase the rest. */
function LifeguardView({ pool, now, reload, onShare }: { pool: PoolDetail; now: number; reload: () => void; onShare: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("divers");
  const [remind, setRemind] = useState(false);
  const unpaid = pool.divers.filter((d) => !d.paid).length;
  const open = pool.status === "active" || pool.status === "met";
  const tank = useRef<HTMLDivElement>(null);
  const motion = usePoolMotion(pool, tank);

  return (
    <>
      <div className={s.layout}>
        <div className={s.left}>
          <Tank pool={pool} from={motion.from} tank={tank} />
          <div className={s.stats}>
            <Stat value={pool.paidCount} label="Paid" />
            <Stat value={Math.max(0, pool.expectedCount - pool.paidCount)} label="Pending" />
            <TimeOrApprovers pool={pool} now={now} />
          </div>
          {pool.status === "active" && (
            <p className="note">
              <Icon name="refresh" />
              If the goal isn&apos;t met by {dayDate(pool.deadline)}, every diver is refunded automatically.
            </p>
          )}
          {pool.status === "met" && (
            <p className="note" style={{ background: "var(--green-50)", color: "var(--green-ink)" }}>
              <Icon name="check" />
              Goal met. Request your payout whenever you&apos;re ready.
            </p>
          )}
          {pool.status === "approval" && pool.payout && (
            <p className="note">
              <Icon name="key" />
              Payout requested. {pool.payout.approvals} of {pool.payout.approvalsNeeded} approvals so far.
            </p>
          )}
          {pool.status === "paidout" && pool.payout && (
            <p className="note" style={{ background: "var(--green-50)", color: "var(--green-ink)" }}>
              <Icon name="check" />
              {formatUsdc(pool.payout.net ?? 0)} paid out to you. Reference {pool.payout.reference}.
            </p>
          )}
          {pool.status === "refunded" && (
            <p className="note">
              <Icon name="refresh" />
              The deadline passed before the goal, so every diver was refunded automatically.
            </p>
          )}
        </div>

        <div className={s.right}>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "divers", label: "Divers" },
              { value: "activity", label: "Activity" },
              { value: "details", label: "Details" },
            ]}
          />
          {tab === "divers" && <Divers pool={pool} now={now} showContacts={false} fresh={motion.fresh} />}
          {tab === "activity" &&
            (pool.activity.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {pool.activity.map((a, i) => (
                  <ActivityRow key={a.id} item={a} now={now} index={i} />
                ))}
              </div>
            ) : (
              <EmptyState title="Nothing yet">Payments and reminders show up here.</EmptyState>
            ))}
          {tab === "details" && (
            <div style={{ display: "grid", gap: 14 }}>
              <PaymentsPrivacy pool={pool} reload={reload} />
              <Details pool={pool} />
            </div>
          )}
        </div>
      </div>

      {/* On phones these pin to the bottom: the main action, with Add divers as a square button. */}
      <div className={s.actions}>
        {open && (
          <button className="btn btn-secondary hide-m" onClick={onShare}>
            Share link
          </button>
        )}
        {pool.status === "active" && (
          <Link className={`btn btn-secondary ${s.addDivers}`} href={`/pools/${pool.id}/divers`} aria-label="Add divers">
            <Icon name="uplus" className="hide-d" />
            <span className="hide-m">Add divers</span>
          </Link>
        )}
        {(pool.status === "paidout" || pool.status === "refunded") && (
          <Link className="btn btn-secondary" href={`/pools/${pool.id}/record`}>
            View record
          </Link>
        )}
        {pool.status === "active" && (
          <button className="btn btn-primary" onClick={() => setRemind(true)} disabled={unpaid === 0}>
            Remind {unpaid} divers
          </button>
        )}
        {pool.status === "met" && (
          <button className="btn btn-success" onClick={() => router.push(`/pools/${pool.id}/payout`)}>
            Request payout
          </button>
        )}
        {pool.status === "approval" && (
          <Link className="btn btn-primary" href={`/pools/${pool.id}/payout/status`}>
            See approvals
          </Link>
        )}
      </div>

      <RemindModal open={remind} onClose={() => setRemind(false)} poolId={pool.id} unpaid={unpaid} onReminded={reload} />
      <FullPool pool={pool} motion={motion} />
    </>
  );
}

/** What a diver sees: their own payment, and who else has paid. */
function DiverView({ pool, now, onShare }: { pool: PoolDetail; now: number; onShare: () => void }) {
  const tank = useRef<HTMLDivElement>(null);
  const motion = usePoolMotion(pool, tank);
  return (
    <div className={s.layout}>
      <div className={s.left}>
        {pool.youPaid ? (
          <div className={s.youPaid}>
            <span className={`${s.check} tick-pop`}>
              <Icon name="check" />
            </span>
            <div>
              <b>You&apos;ve paid {formatUsdc(pool.share)}</b>
              <div className="t-small muted">No more reminders for this pool.</div>
            </div>
            {pool.yourReceiptRef && (
              <Link className={s.receiptLink} href={`/receipts/${pool.yourReceiptRef}`}>
                Receipt
              </Link>
            )}
          </div>
        ) : (
          <Link href={`/p/${pool.code}`} className="btn btn-primary btn-block">
            Pay your share, {formatUsdc(pool.share)}
          </Link>
        )}
        <Tank pool={pool} from={motion.from} tank={tank} />
        <p className="note">
          <Icon name="lock" />
          Held safely until the goal is met. {pool.approvers.length ? `${pool.approvers.length} approvers confirm the payout with ${pool.lifeguard.name.split(" ")[0]}.` : ""}
        </p>
        {pool.status === "active" && (
          <button className="btn btn-secondary hide-m" onClick={onShare}>
            Share link
          </button>
        )}
      </div>
      <div className={s.right}>
        <h2 className="t-h2" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          {pool.diversSeePayments ? "Who has paid" : "Payments"}{" "}
          <span className="t-small muted">
            {pool.paidCount} of {pool.expectedCount} paid
          </span>
        </h2>
        {pool.diversSeePayments ? (
          <Divers pool={pool} now={now} showContacts={false} fresh={motion.fresh} />
        ) : (
          <>
            <p className="note">
              <Icon name="lock" />
              {pool.lifeguard.name.split(" ")[0]} keeps payments private: you see your own and the totals.
            </p>
            {pool.divers.length > 0 && <Divers pool={pool} now={now} showContacts={false} fresh={motion.fresh} />}
          </>
        )}
      </div>
    </div>
  );
}

/** What an approver sees before the payout page. */
function ApproverView({ pool, now }: { pool: PoolDetail; now: number }) {
  const { user } = useSession();
  const mine = pool.approvers.find((a) => a.userId === user?.id);
  const waiting = pool.status === "approval" && mine?.status === "waiting";
  const first = pool.lifeguard.name.split(" ")[0];
  const tank = useRef<HTMLDivElement>(null);
  const motion = usePoolMotion(pool, tank);
  return (
    <div className={s.layout}>
      <div className={s.left}>
        <Tank pool={pool} from={motion.from} tank={tank} />
        <p className="note">
          <Icon name="key" />
          {pool.status === "paidout"
            ? `You were one of ${pool.approvers.length} approvers. ${first} has been paid.`
            : mine?.status === "approved"
              ? `You approved this payout. ${pool.payout?.approvals ?? 0} of ${pool.approvalsNeeded} so far.`
              : mine?.status === "declined"
                ? "You declined this payout. The money stays in the pool."
                : `You're one of ${pool.approvers.length} approvers. ${pool.approvalsNeeded} must agree before ${first} is paid.`}
        </p>
        {waiting && (
          <Link href={`/pools/${pool.id}/approve`} className="btn btn-primary btn-block">
            Review the payout
          </Link>
        )}
      </div>
      <div className={s.right}>
        <h2 className="t-h2">Who has paid</h2>
        <Divers pool={pool} now={now} showContacts={false} fresh={motion.fresh} />
      </div>
    </div>
  );
}

/** A diver's view of a pool that missed its goal: their money is back. */
function RefundedView({ pool }: { pool: PoolDetail }) {
  const [bank, setBank] = useState(false);
  const pct = pool.progress;
  return (
    <div className={s.narrow}>
      {/* The water drains away: the money went back. */}
      <WaterTank refunded drain pct={0} from={pct} line={`${pct}% of the goal`} sub="Deadline passed before the goal" />
      {pool.yourRefund !== null && (
        <div className={`${s.refundCard} bub-in`} style={{ animationDelay: "900ms" }}>
          <span className={s.refundIcon}>
            <Icon name="refresh" />
          </span>
          <div>
            <b>{formatUsdc(pool.yourRefund)} is back in your PoolFi balance</b>
            <p>The deadline passed before the goal was met, so everyone was refunded automatically. Nobody had to ask.</p>
          </div>
        </div>
      )}
      <div className={s.twoButtons}>
        <button className="btn btn-primary" onClick={() => setBank(true)}>
          Withdraw to bank
        </button>
        <Link className="btn btn-secondary" href="/wallet">
          Keep in PoolFi
        </Link>
      </div>
      <ComingSoon open={bank} onClose={() => setBank(false)} title="Withdrawals to your bank are coming soon">
        Your refund is safe in your PoolFi wallet. You can use it for your next pool.
      </ComingSoon>
    </div>
  );
}

function PoolPage() {
  const { id } = useParams<{ id: string }>();
  const now = useNow(1000);
  const pool = useResource(() => api.getPool(id), [id]);
  const { reload } = pool;
  const opened = useSearchParams().get("share") === "1";
  const [share, setShare] = useState(opened);
  // Keep the pool live, so payments show up as they land.
  useEffect(() => {
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <Loaded resource={pool}>
      {(p) => {
        const left = countdown(p.deadline, now);
        const refundedDiver = p.status === "refunded" && p.role === "diver";
        const open = p.status === "active" || p.status === "met";
        const canShare = open && (p.role === "lifeguard" || (p.role === "diver" && p.status === "active" && p.diversCanShare));
        return (
          <>
            <PageHead
              back="/pools"
              emoji={refundedDiver ? undefined : p.emoji}
              title={refundedDiver ? `${p.emoji} ${p.name}` : p.name}
              subtitle={refundedDiver ? undefined : <span className="hide-m">{`${p.role === "lifeguard" ? "Lifeguard: You" : `Lifeguard: ${p.lifeguard.name}`}, Pool ID ${p.code}`}</span>}
              aside={
                refundedDiver ? undefined : (
                  <>
                    <div className={`${s.headAside} hide-m`}>
                      <StatusPill status={p.status} />
                      {p.status === "active" && left && <span className={s.countdown}>Closes in {left}</span>}
                    </div>
                    {canShare && (
                      <button className={`${s.headShare} hide-d`} onClick={() => setShare(true)} aria-label="Share the invite link">
                        <Icon name="share" />
                      </button>
                    )}
                  </>
                )
              }
            />
            {refundedDiver ? (
              <RefundedView pool={p} />
            ) : p.role === "lifeguard" ? (
              <LifeguardView pool={p} now={now} reload={pool.reload} onShare={() => setShare(true)} />
            ) : p.role === "approver" ? (
              <ApproverView pool={p} now={now} />
            ) : (
              <DiverView pool={p} now={now} onShare={() => setShare(true)} />
            )}
            {p.status === "paidout" && p.role !== "lifeguard" && p.payout && (
              <p className="note" style={{ background: "var(--green-50)", color: "var(--green-ink)" }}>
                <Icon name="check" />
                Paid out to {p.lifeguard.name}
                {p.payout.net !== null && (
                  <>
                    : <Money value={p.payout.net} />
                  </>
                )}
              </p>
            )}
            <ShareModal open={share} onClose={() => setShare(false)} pool={p} title={opened ? "Your pool is ready. Share the link" : "Share the link"} />
          </>
        );
      }}
    </Loaded>
  );
}

export default function Page() {
  return (
    <AppShell>
      {() => (
        <Suspense>
          <PoolPage />
        </Suspense>
      )}
    </AppShell>
  );
}
