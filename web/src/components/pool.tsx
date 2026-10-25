"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { ago, closesIn } from "@/lib/format";
import { formatAmount, formatUsdc } from "@/lib/money";
import type { ActivityItem, Diver, PoolSummary } from "@/lib/types";
import { Drip } from "./Drip";
import { Icon, type IconName } from "./Icon";
import { useCountUp } from "./motion";
import s from "./pool.module.css";
import { Avatar, Money, PoolPill, StatusPill, Toggle } from "./ui";

const ROLE: Record<PoolSummary["role"], string> = { lifeguard: "Lifeguard", diver: "Diver", approver: "Approver" };

export function PoolRow({ pool, now, index = 0 }: { pool: PoolSummary; now: number; index?: number }) {
  const pct = pool.progress;
  const when =
    pool.status === "active" ? (
      <span className={s.warn}>{closesIn(pool.deadline, now)}</span>
    ) : pool.status === "met" && pool.role === "lifeguard" ? (
      <span className={s.warn}>Ready for payout</span>
    ) : pool.status === "missed" && pool.role === "lifeguard" ? (
      <span className={s.warn}>Extend or refund</span>
    ) : null;
  const who = pool.role === "lifeguard" ? `${pool.paidCount} of ${pool.expectedCount} paid` : `lifeguard ${pool.lifeguard.name.split(" ")[0]}`;
  return (
    <Link href={`/pools/${pool.id}`} className={`${s.poolRow} rise`} style={{ animationDelay: `${index * 70}ms` }}>
      <div className={s.poolTop}>
        <span className={s.emoji} aria-hidden="true">{pool.emoji}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={s.poolName}>{pool.name}</div>
          <div className={s.poolMeta}>
            {ROLE[pool.role]}, {who}
            {when && <>, {when}</>}
          </div>
        </div>
        <PoolPill status={pool.status} role={pool.role} youPaid={pool.youPaid} owe={formatUsdc(pool.share)} />
      </div>
      <div className={s.fullLine}>
        <span className={s.fullPct}>{pct}%</span>
        <span className="muted t-small">full</span>
      </div>
      <div className="fill-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className={s.poolFoot}>
        {pool.role === "lifeguard" && pool.raised !== null && pool.goal !== null ? (
          <>
            <span>
              <b>{formatAmount(pool.raised)} USDC</b> raised
            </span>
            <span className={s.target}>
              Target: <b>{formatAmount(pool.goal)} USDC</b>
            </span>
          </>
        ) : (
          <>
            <span>
              {pool.youPaid ? "You paid" : "Your share"} <b>{formatUsdc(pool.share)}</b>
            </span>
            <span>
              {pool.paidCount} of {pool.expectedCount} paid
            </span>
          </>
        )}
      </div>
    </Link>
  );
}

const ACTIVITY: Record<ActivityItem["kind"], { tag: string; green: boolean; icon?: IconName }> = {
  payment: { tag: "Payment", green: true },
  reminder: { tag: "Reminder", green: false, icon: "bell" },
  goal_met: { tag: "Goal met", green: true, icon: "check" },
  approval: { tag: "Approval", green: false, icon: "key" },
  payout: { tag: "Payout", green: true, icon: "send" },
  refund: { tag: "Refund", green: false, icon: "refresh" },
  joined: { tag: "Joined", green: false, icon: "users" },
  created: { tag: "Created", green: false, icon: "plus2" },
  missed: { tag: "Deadline", green: false, icon: "clock" },
  extended: { tag: "Extended", green: false, icon: "cal" },
};

/** A line in an activity feed; `fresh` ones slide in highlighted, the rest rise in turn. */
export function ActivityRow({ item, now, index = 0, fresh }: { item: ActivityItem; now: number; index?: number; fresh?: boolean }) {
  const a = ACTIVITY[item.kind];
  return (
    <div className={`${s.activityRow} ${fresh ? "row-fresh" : "rise"}`} style={fresh ? undefined : { animationDelay: `${Math.min(index, 10) * 50}ms` }}>
      {item.kind === "payment" && item.actorName ? (
        <Avatar name={item.actorName} size={36} />
      ) : (
        <span className={s.activityIcon} aria-hidden="true">
          <Icon name={a.icon ?? "activity"} />
        </span>
      )}
      <div className={s.activityText}>
        <div className={s.activityTitle}>{item.title}</div>
        <div className={s.activityMeta}>
          {ago(item.at, now)}
          {item.amount !== null && `, ${item.kind === "payment" ? "+" : ""}${formatUsdc(item.amount)}`}
        </div>
      </div>
      <span className={`${s.tag} ${a.green ? s.tagGreen : s.tagBlue}`}>{a.tag}</span>
    </div>
  );
}

export function DiverRow({ diver, now, contact, fresh }: { diver: Diver; now: number; contact?: boolean; fresh?: boolean }) {
  const sub = diver.paid
    ? `Paid ${ago(diver.paidAt ?? "", now).toLowerCase()}`
    : diver.lastRemindedAt
      ? `Reminded ${ago(diver.lastRemindedAt, now).toLowerCase()}`
      : "Not paid yet";
  return (
    <div className={`${s.diverRow}${fresh ? " row-fresh" : ""}`}>
      <Avatar name={diver.name} />
      <div style={{ minWidth: 0 }}>
        <div className={s.diverName}>{diver.name}</div>
        <div className={s.diverSub}>
          {sub}
          {contact && diver.contact ? ` · ${diver.contact}` : ""}
        </div>
      </div>
      <StatusPill status={diver.paid ? "paid" : "not_paid"} />
    </div>
  );
}

export function NamePickerRow({ name, selected, paid, onSelect }: { name: string; selected: boolean; paid: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`${s.pick} ${selected ? s.pickSelected : ""} ${paid ? s.pickPaid : ""}`}
      onClick={paid ? undefined : onSelect}
      aria-pressed={selected}
      disabled={paid}
    >
      <Avatar name={name} size={34} />
      <span className={s.pickName}>{name}</span>
      {paid ? <StatusPill status="paid" /> : <span className={`${s.radio}${selected ? " okpop" : ""}`}>{selected && <Icon name="check" />}</span>}
    </button>
  );
}

// Bubbles rising through the water: size, left %, seconds per trip, start offset.
const BUBBLES: [number, number, number, number][] = [
  [8, 9, 4.6, 0.4], [12, 21, 6.2, 3.1], [6, 33, 3.9, 5.2], [10, 47, 5.4, 1.7], [7, 58, 6.8, 4.4],
  [13, 69, 4.2, 2.6], [5, 78, 5.9, 6.1], [9, 88, 3.6, 0.9], [11, 94, 6.5, 2.2],
];

/** Where the water sits for a percentage: it starts at a base so the numbers always sit in the water. */
/** The water's height in the tank: exactly the share of the goal raised. */
const levelOf = (pct: number) => Math.max(0, Math.min(100, pct));


/**
 * The pool as a tank of water. It fills from `from` to `pct` when it appears
 * (or drains, for a refund), the number counting along, and fills again
 * whenever `pct` changes. Pass `ref` to drop coins in with `dropCoin`.
 */
export function WaterTank({ pct, from, line, sub, height = 248, refunded, drain, ref }: { pct: number; from?: number; line: ReactNode; sub: ReactNode; height?: number; refunded?: boolean; drain?: boolean; ref?: Ref<HTMLDivElement> }) {
  const start = from ?? Math.max(0, pct - 15);
  const [level, setLevel] = useState(start);
  useEffect(() => {
    const t = setTimeout(() => setLevel(pct), drain ? 700 : 250);
    return () => clearTimeout(t);
  }, [pct, drain]);
  const shown = useCountUp(level, { duration: drain ? 1600 : 1100, from: start });
  const empty = shown < 0.5;
  const met = !refunded && Math.round(shown) >= 100;
  const classes = ["wt", met && "met", empty && "empty", drain && "drain", refunded && "refunded"].filter(Boolean).join(" ");
  return (
    <div ref={ref} className={classes} style={{ height }} role="img" aria-label={`${pct}% of the goal`}>
      <div className="wt-water" style={{ height: `${levelOf(level)}%` }}>
        <div className="wt-waves" aria-hidden="true">
          <svg className="w2" viewBox="0 0 400 16" preserveAspectRatio="none">
            <path d="M0 8 Q50 0 100 8 T200 8 T300 8 T400 8 V16 H0Z" />
          </svg>
          <svg className="w1" viewBox="0 0 400 16" preserveAspectRatio="none">
            <path d="M0 8 Q50 0 100 8 T200 8 T300 8 T400 8 V16 H0Z" />
          </svg>
        </div>
        <Image src="/usdc.webp" alt="" width={44} height={44} className="wt-ride r1" />
        <Image src="/usdc.webp" alt="" width={36} height={36} className="wt-ride r2" />
        <div className="wt-bubs" aria-hidden="true">
          {BUBBLES.map(([size, left, secs, offset]) => (
            <span key={left} className="wt-bub" style={{ width: size, height: size, left: `${left}%`, animationDuration: `${secs}s`, animationDelay: `${-offset}s` } as CSSProperties} />
          ))}
        </div>
      </div>
      {/* The numbers twice: blue on the white tank, and a white copy shown only where the
          water covers them, cut at the waterline and rising and falling with it. */}
      <div className="wt-text">
        <div className="wt-pct">{Math.round(shown)}%</div>
        <div className="wt-line">{line}</div>
        <div className="wt-sub">{sub}</div>
      </div>
      <div className="wt-wet" style={{ clipPath: `inset(${100 - levelOf(level)}% 0 0 0)` }} aria-hidden="true">
        <div className="wt-text">
          <div className="wt-pct">{Math.round(shown)}%</div>
          <div className="wt-line">{line}</div>
          <div className="wt-sub">{sub}</div>
        </div>
      </div>
      <span className="pill pill-green wt-gm">
        <Icon name="check" size={14} />
        Goal met
      </span>
    </div>
  );
}

export function FeeTip({ feeBps, on, onChange, children }: { feeBps: number; on: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <div className={`${s.feeTip} say-in`}>
      <Drip size={34} pop />
      <div style={{ flex: 1 }}>
        <div className={s.feeTitle}>Let divers cover PoolFi&apos;s {feeBps / 100}% fee?</div>
        <div className={s.feeText}>{children}</div>
      </div>
      <Toggle on={on} onChange={onChange} label="Let divers cover the fee" />
    </div>
  );
}

export function BalanceTile({ label, value, caption, raw, className }: { label: string; value: number | string; caption: string; raw?: boolean; className?: string }) {
  return (
    <div className={`${s.tile}${className ? ` ${className}` : ""}`}>
      <span className={s.tileLabel}>{label}</span>
      <div className={s.tileValue}>{raw || typeof value === "string" ? value : <Money value={value} />}</div>
      <div className={s.tileCaption}>{caption}</div>
    </div>
  );
}

export { s as poolStyles };
