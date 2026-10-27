"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/providers";
import { Avatar, BusyButton, ErrorText, Modal, Spinner } from "@/components/ui";
import { messageOf } from "@/lib/errors";
import { formatUsdc } from "@/lib/money";
import type { AdminAction, AdminChain, AdminPerson, AdminPoolRow, AdminUserRow, Avatar as AvatarData, PoolStatus, Usdc } from "@/lib/types";
import s from "./admin.module.css";

/** The deep-blue band at the top of each page: what it is, and what can be done here. */
export function Hero({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <section className={s.hero}>
      <div className={s.heroIn}>
        <div className={s.heroHead}>
          <div style={{ minWidth: 0 }}>
            <h1>{title}</h1>
            {sub && <p className={s.sub}>{sub}</p>}
          </div>
          {actions && <div className={s.heroActions}>{actions}</div>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function Kpis({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <div className={s.kpis}>
      {items.map((k) => (
        <div key={k.label} className={s.kpi}>
          <p>{k.label}</p>
          <b className={s.num}>{k.value}</b>
          {k.note && <span>{k.note}</span>}
        </div>
      ))}
    </div>
  );
}

export function Card({ title, sub, tools, children, id }: { title: ReactNode; sub?: ReactNode; tools?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className={s.card} id={id}>
      <div className={s.cardHead}>
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {tools && <div className={s.cardTools}>{tools}</div>}
      </div>
      {children}
    </section>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className={s.seg} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A search box that reports what's typed once typing pauses. */
export function Search({ value, onChange, placeholder }: { value: string; onChange: (q: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => changed.current(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text, value]);
  return (
    <label className={s.search}>
      <Icon name="search" />
      <input type="search" value={text} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setText(e.target.value)} />
    </label>
  );
}

/** Someone, linked to their page when they're a PoolFi user. */
export function Person({ person, avatar, note }: { person: AdminPerson; avatar?: AvatarData | null; note?: ReactNode }) {
  const name = <b>{person.name}</b>;
  return (
    <div className={s.person}>
      <Avatar name={person.name} avatar={avatar} size={32} />
      <div>
        {person.id ? <Link href={`/admin/users/${encodeURIComponent(person.id)}`}>{name}</Link> : name}
        <small>{note ?? person.email ?? "Not a PoolFi user"}</small>
      </div>
    </div>
  );
}

export function PoolLink({ pool }: { pool: { id: string; name: string; emoji: string } }) {
  return (
    <Link href={`/admin/pools/${encodeURIComponent(pool.id)}`} className={s.person} style={{ minWidth: 140 }}>
      <span aria-hidden="true">{pool.emoji}</span>
      <b>{pool.name}</b>
    </Link>
  );
}

export type Tone = "green" | "amber" | "red" | "blue" | "navy" | "grey";

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}

export const POOL_STATUS: Record<PoolStatus, { label: string; tone: Tone }> = {
  active: { label: "Open", tone: "blue" },
  met: { label: "Goal met", tone: "green" },
  approval: { label: "Awaiting approval", tone: "navy" },
  paidout: { label: "Paid out", tone: "green" },
  missed: { label: "Deadline passed", tone: "amber" },
  refunded: { label: "Refunded", tone: "grey" },
};

export function PoolStatusPill({ status }: { status: PoolStatus }) {
  return <Pill tone={POOL_STATUS[status].tone}>{POOL_STATUS[status].label}</Pill>;
}

/** How someone is doing, and anything stopping them. */
export function UserPills({ u }: { u: Pick<AdminUserRow, "state" | "suspended" | "locked" | "admin"> }) {
  return (
    <div className={s.pills}>
      {u.state === "active" && <Pill tone="green">Active</Pill>}
      {u.state === "quiet" && <Pill tone="amber">Quiet</Pill>}
      {u.state === "new" && <Pill tone="grey">Did nothing yet</Pill>}
      {u.suspended && <Pill tone="red">Suspended</Pill>}
      {u.locked && <Pill tone="red">Locked</Pill>}
      {u.admin && <Pill tone="navy">Team</Pill>}
    </div>
  );
}

export function Amount({ value }: { value: Usdc }) {
  return <span className={s.num}>{formatUsdc(value)}</span>;
}

/** A transaction hash, linked to the network's explorer when there is one. */
export function TxLink({ hash, chain }: { hash: string | null; chain: AdminChain }) {
  if (!hash) return <span className="muted">—</span>;
  const short = `${hash.slice(0, 6)}…${hash.slice(-4)}`;
  return chain.explorer ? (
    <a href={`${chain.explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className={s.code} title={hash}>
      {short}
    </a>
  ) : (
    <span className={s.code} title={hash}>
      {short}
    </span>
  );
}

/** A wallet address, linked to the network's explorer when there is one. */
export function AddressLink({ address, chain }: { address: string; chain: AdminChain }) {
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
  return chain.explorer ? (
    <a href={`${chain.explorer}/account/${address}`} target="_blank" rel="noreferrer" className={s.code} title={address}>
      {short}
    </a>
  ) : (
    <span className={s.code} title={address}>
      {short}
    </span>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className={s.facts}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Runs one of the team's fixes: a toast when it worked, and the server's reason when
 * it didn't (a payout already sent, a pool already closed…).
 */
export function useAdminAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function run<T>(key: string, fn: () => Promise<T>, done: string | ((result: T) => string), icon = "✅"): Promise<T | null> {
    setBusy(key);
    try {
      const result = await fn();
      toast(typeof done === "string" ? done : done(result), icon);
      return result;
    } catch (error) {
      toast(messageOf(error), "⚠️");
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { run, busy };
}

export function ActButton({ busy, onClick, children, disabled }: { busy: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className={s.actBtn} onClick={onClick} disabled={busy || disabled} aria-busy={busy}>
      {busy ? <Spinner size={14} /> : children}
    </button>
  );
}

/**
 * Asks why before a fix that changes someone's account or pool; the reason goes in the
 * admin log. `extra` is any other field the fix needs (a new deadline).
 */
export function ReasonModal({
  open,
  onClose,
  title,
  children,
  confirm,
  danger,
  optional,
  extra,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  confirm: string;
  danger?: boolean;
  optional?: boolean;
  extra?: ReactNode;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ok = optional || reason.trim().length >= 3;
  return (
    <Modal open={open} onClose={onClose} label={title} wide>
      <h2 className="t-h2" style={{ margin: "0 40px 0 0" }}>
        {title}
      </h2>
      {children && (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          {children}
        </p>
      )}
      <form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          setBusy(true);
          setError(null);
          try {
            await onConfirm(reason.trim());
            setReason("");
            onClose();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {extra}
        <label className="field">
          <span className="field-label">{optional ? "Note for the admin log (optional)" : "Why? This goes in the admin log"}</span>
          <textarea className="input" style={{ minHeight: 90 }} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </label>
        <ErrorText error={error} />
        <div className={s.formActs}>
          <BusyButton busy={busy} disabled={!ok} className={danger ? "btn btn-signout" : "btn btn-primary"} type="submit">
            {confirm}
          </BusyButton>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Where a log line's target lives on the dashboard. */
export function actionHref(a: AdminAction): string | null {
  if (a.target.kind === "user" && a.target.id) return `/admin/users/${encodeURIComponent(a.target.id)}`;
  if (a.target.kind === "pool" && a.target.id) return `/admin/pools/${encodeURIComponent(a.target.id)}`;
  return null;
}

/** Day-by-day signups (running total) or money paid in, with the day under the pointer. */
export function GrowthChart({ data, show }: { data: { day: string; users: number; collected: Usdc }[]; show: "users" | "collected" }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(300, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (data.length === 0) return <p className={s.empty}>Nothing to chart yet.</p>;
  const H = 220, L = 58, R = 10, T = 12, B = 26;
  const iw = width - L - R, ih = H - T - B;
  const values = data.map((d) => (show === "users" ? d.users : d.collected));
  const max = Math.max(...values, 1) * 1.1;
  const n = data.length;
  const bw = iw / n;
  const x = (i: number) => L + i * bw + bw / 2;
  const y = (v: number) => T + ih - (v / max) * ih;
  const label = (v: number) => (show === "users" ? Math.round(v).toLocaleString("en-US") : compact(v));
  const step = Math.max(1, Math.ceil(n / 7));
  const day = (i: number) => new Date(`${data[i]?.day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return (
    <div className={s.chart} ref={host} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={H} role="img" aria-label={show === "users" ? "People on PoolFi, day by day" : "USDC paid into pools each day"}>
        {[0, 1, 2, 3, 4].map((k) => {
          const v = (max * k) / 4;
          return (
            <g key={k}>
              <line className={s.gridLine} x1={L} x2={width - R} y1={y(v)} y2={y(v)} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end">
                {label(v)}
              </text>
            </g>
          );
        })}
        {data.map((_, i) =>
          i % step === 0 ? (
            <text key={i} x={x(i)} y={H - 7} textAnchor="middle">
              {day(i)}
            </text>
          ) : null,
        )}
        {show === "users" ? (
          <>
            <path d={`M${points.join("L")}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill="rgba(27,79,216,.12)" />
            <polyline points={points.join(" ")} fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinejoin="round" />
            <circle cx={x(n - 1)} cy={y(values[n - 1] ?? 0)} r={5} fill="var(--blue)" stroke="#fff" strokeWidth={2.5} />
          </>
        ) : (
          values.map((v, i) => (v > 0 ? <rect key={i} x={x(i) - Math.max(1, bw / 2 - 2)} y={y(v)} width={Math.max(2, bw - 4)} height={y(0) - y(v)} rx={3} fill="var(--blue)" /> : null))
        )}
        {data.map((_, i) => (
          <rect key={`hit${i}`} x={L + i * bw} y={T} width={bw} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <div className={s.tip} style={{ left: x(hover), top: y(values[hover] ?? 0) }}>
          <b>{day(hover)}</b> · {show === "users" ? `${values[hover]} people` : formatUsdc(values[hover] ?? 0)}
        </div>
      )}
    </div>
  );
}

/** "1.2M", "45K", "800". */
function compact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(v));
}

/** A pool as a card: how full it is, and where its payout stands. */
export function PoolCard({ pool: p, now }: { pool: AdminPoolRow; now: number }) {
  const pct = p.goal > 0 ? Math.min(100, Math.round((p.raised / p.goal) * 100)) : 0;
  const deadline = new Date(p.deadline).getTime();
  return (
    <Link href={`/admin/pools/${encodeURIComponent(p.id)}`} className={s.poolCard}>
      <h3>
        <span>
          {p.emoji} {p.name}
        </span>
        <PoolStatusPill status={p.status} />
      </h3>
      <p className={s.meta}>
        {p.code} · {p.lifeguard.name} · started {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
      </p>
      <div className={s.bar}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className={s.barRow}>
        <span>
          <b>{formatUsdc(p.raised)}</b> of {formatUsdc(p.goal)}
        </span>
        <span>{pct}%</span>
      </div>
      <div className={s.pills}>
        <Pill tone="grey">
          {p.paidCount} of {p.expectedCount} paid
        </Pill>
        {p.approvers > 0 && <Pill tone="grey">{p.approvers === 1 ? "1 approver" : `${p.approvers} approvers`}</Pill>}
        {p.payout && !p.payout.paidAt && (
          <Pill tone="navy">
            {p.payout.approvals} of {p.payout.needed} approvals
          </Pill>
        )}
        {p.refunded > 0 && <Pill tone="grey">{formatUsdc(p.refunded)} refunded</Pill>}
        {(p.status === "active" || p.status === "missed") && (
          <Pill tone={deadline < now ? "red" : "grey"}>
            {deadline < now ? "Deadline passed" : `Closes ${new Date(p.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
          </Pill>
        )}
      </div>
    </Link>
  );
}
