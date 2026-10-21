"use client";

import QRCode from "qrcode";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { messageOf } from "@/lib/errors";
import { initials } from "@/lib/format";
import { formatAmount } from "@/lib/money";
import type { Avatar as AvatarData, PoolStatus, Role } from "@/lib/types";
import { Drip } from "./Drip";
import { Icon } from "./Icon";
import { Ripples } from "./motion";

export function Avatar({ name, avatar, size = 40 }: { name: string; avatar?: AvatarData | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.33) };
  if (avatar?.kind === "photo") {
    return (
      <span className="avatar" style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatar.url} alt="" />
      </span>
    );
  }
  if (avatar?.kind === "emoji") {
    return (
      <span className="avatar" style={{ ...style, background: avatar.bg, fontSize: size * 0.5 }}>
        {avatar.emoji}
      </span>
    );
  }
  return <span className="avatar" style={style}>{initials(name)}</span>;
}

/** An amount in USDC: the number large, the unit small. */
export function Money({ value, className, sign }: { value: number; className?: string; sign?: boolean }) {
  const prefix = sign ? (value >= 0 ? "+" : "−") : value < 0 ? "−" : "";
  return (
    <span className={className}>
      {prefix}
      {formatAmount(Math.abs(value))}
      <span className="unit">USDC</span>
    </span>
  );
}

const STATUS: Record<string, { label: string; tone: string; dot?: boolean }> = {
  active: { label: "Active", tone: "pill-green", dot: true },
  met: { label: "Goal met", tone: "pill-green" },
  approval: { label: "Awaiting approval", tone: "pill-navy" },
  paidout: { label: "Paid out", tone: "pill-green" },
  refunded: { label: "Refunded", tone: "pill-grey" },
  owe: { label: "You owe", tone: "pill-amber" },
  paid: { label: "Paid", tone: "pill-green" },
  not_paid: { label: "Not paid", tone: "pill-amber" },
  optional: { label: "Optional", tone: "pill-blue" },
};

export function StatusPill({ status, label }: { status: keyof typeof STATUS | PoolStatus; label?: string }) {
  const s = STATUS[status];
  return <span className={`pill ${s.tone}${s.dot ? " pill-dot" : ""}`}>{label ?? s.label}</span>;
}

/** The pill shown on a pool row for the viewer: their role decides what matters. */
export function PoolPill({ status, role, youPaid, owe }: { status: PoolStatus; role: Role; youPaid: boolean; owe: string }) {
  if (status !== "active") return <StatusPill status={status} />;
  if (role === "diver") return youPaid ? <StatusPill status="paid" /> : <StatusPill status="owe" label={`You owe ${owe}`} />;
  return <StatusPill status="active" />;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const n = options.length;
  // A white thumb slides under the chosen option.
  const thumb = { width: `calc((100% - 8px - ${(n - 1) * 4}px) / ${n})`, transform: `translateX(calc(${i} * (100% + 4px)))` } as CSSProperties;
  return (
    <div className="segmented" role="tablist">
      <span className="seg-thumb" style={thumb} aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

let lastProgress = 0;

/** A progress bar that grows on from where the previous screen's bar was. */
export function ProgressBar({ value }: { value: number }) {
  const target = Math.max(4, value * 100);
  const [width, setWidth] = useState(() => lastProgress || target);
  useEffect(() => {
    lastProgress = target;
    const frame = requestAnimationFrame(() => setWidth(target));
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${width}%` }} />
    </div>
  );
}

export function Spinner({ size = 22 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

/** A button that shows a spinner while its action runs. */
export function BusyButton({ busy, children, className = "btn btn-primary", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy: boolean }) {
  return (
    <button {...rest} className={`${className}${busy ? " is-busy" : ""}`} disabled={rest.disabled || busy} aria-busy={busy}>
      {busy ? <Spinner size={18} /> : children}
    </button>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state" role="status">
      <Ripples size={72} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <Drip size={72} mood="think" pop />
      <h3 className="t-h3">That didn&apos;t load</h3>
      <p>{messageOf(error)}</p>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <Drip size={72} mood="calm" pop />
      <h3 className="t-h3">{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Loading, error, then content, for any resource. */
export function Loaded<T>({ resource, children, label }: { resource: { data: T | undefined; error: unknown; loading: boolean; reload: () => void }; children: (data: T) => ReactNode; label?: string }) {
  if (resource.error && !resource.data) return <ErrorState error={resource.error} onRetry={resource.reload} />;
  if (!resource.data) return <LoadingState label={label} />;
  return <>{children(resource.data)}</>;
}

export function Modal({ open, onClose, children, wide, label }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; label: string }) {
  // Stays on screen a moment after closing so it can shrink away.
  const [shown, setShown] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setShown(true);
  }
  useEffect(() => {
    if (open || !shown) return;
    const t = setTimeout(() => setShown(false), 200);
    return () => clearTimeout(t);
  }, [open, shown]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!shown || typeof document === "undefined") return null;
  return createPortal(
    <div className={`overlay${open ? "" : " is-closing"}`} onMouseDown={(e) => open && e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? " dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
        <button className="icon-btn dialog-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Everything Naira or bank-based shows this until those payment rails exist. */
export function ComingSoon({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children?: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} label={title}>
      <div style={{ display: "grid", justifyItems: "center", gap: 12, textAlign: "center", paddingTop: 8 }}>
        <Drip size={84} mood="calm" pop />
        <span className="pill pill-blue">Coming soon</span>
        <h2 className="t-h2">{title}</h2>
        <p className="muted">{children ?? "Naira payments and bank transfers are on the way. For now, use USDC from your PoolFi wallet."}</p>
        <button className="btn btn-primary btn-block" onClick={onClose} style={{ marginTop: 8 }}>
          Got it
        </button>
      </div>
    </Modal>
  );
}

/** A QR code drawn in the brand navy. */
export function QrCode({ value, size = 140 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: size * 2, color: { dark: "#052698", light: "#ffffff" } }).then(setSrc, () => setSrc(undefined));
  }, [value, size]);
  return (
    <span style={{ display: "inline-grid", placeItems: "center", width: size + 16, height: size + 16, border: "2px solid var(--line-soft)", borderRadius: 16, background: "var(--white)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="QR code" width={size} height={size} /> : <Spinner />}
    </span>
  );
}

/** A dashed box with a value and a Copy button. */
export function CopyField({ value, display, onCopied }: { value: string; display?: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className={`copy-box${copied ? " copied" : ""}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: 8, paddingLeft: 16, border: "2px dashed var(--blue-200)", borderRadius: 16, background: "var(--white)" }}>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--blue)", fontFamily: "var(--font-display)", fontWeight: 500 }}>
        {display ?? value}
      </span>
      <button className="btn btn-primary btn-sm" onClick={copy} data-sound="pick">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="field-error" role="alert">
      {messageOf(error)}
    </p>
  );
}
