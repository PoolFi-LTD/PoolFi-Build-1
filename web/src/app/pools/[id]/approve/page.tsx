"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Drip } from "@/components/Drip";
import { Icon } from "@/components/Icon";
import { Celebration, confettiFrom } from "@/components/motion";
import { haptic, sound } from "@/lib/sound";
import { useSession } from "@/components/providers";
import { AppShell, PageHead } from "@/components/shells";
import { Avatar, BusyButton, ErrorText, Loaded, Modal, Money } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction, useResource } from "@/lib/hooks";
import { formatUsdc } from "@/lib/money";
import type { PoolDetail } from "@/lib/types";

const HOLD_MS = 1200;
const RING = 2 * Math.PI * 54;
const REASONS = ["Amount looks wrong", "Not what we agreed", "Need to talk first"];

/** Press and hold for a moment to approve, so it can't happen by accident. The key turns when it's done. */
function HoldToApprove({ onApproved, disabled }: { onApproved: (button: HTMLButtonElement) => void; disabled: boolean }) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const start = useRef(0);
  const frame = useRef(0);
  const done = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  const stop = () => {
    cancelAnimationFrame(frame.current);
    setHolding(false);
    // Let go early and the ring runs back.
    if (!done.current) setProgress(0);
  };
  const begin = () => {
    if (disabled || done.current) return;
    setHolding(true);
    sound.tap();
    start.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        done.current = true;
        setHolding(false);
        if (button.current) onApproved(button.current);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const finished = progress >= 1;

  return (
    <button
      ref={button}
      type="button"
      aria-label="Hold to approve"
      className={`hold${holding ? " down" : ""}${finished ? " done" : ""}`}
      data-sound="none"
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && begin()}
      onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop()}
      style={{ position: "relative", width: 124, height: 124, padding: 0, border: 0, borderRadius: 999, background: "none", cursor: disabled ? "default" : "pointer", touchAction: "none" }}
    >
      <svg width="124" height="124" viewBox="0 0 124 124" aria-hidden="true" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx="62" cy="62" r="54" fill="none" stroke="var(--line)" strokeWidth="8" />
        <circle
          cx="62"
          cy="62"
          r="54"
          fill="none"
          stroke="var(--green)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - progress)}
          style={{ transition: holding || finished ? "none" : "stroke-dashoffset 300ms" }}
        />
      </svg>
      <span className="core" style={{ position: "absolute", inset: 18, display: "grid", placeItems: "center", borderRadius: 999, background: "var(--blue)", color: "var(--white)", boxShadow: "0 5px 0 var(--blue-edge)" }}>
        <Icon name="key" size={36} />
      </span>
    </button>
  );
}

function Decided({ pool }: { pool: PoolDetail }) {
  const payout = pool.payout;
  const paid = Boolean(payout?.paidAt);
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 10, textAlign: "center", padding: "12px 0" }}>
      <Drip size={90} mood={paid ? "proud" : "calm"} pop />
      <h2 className="t-h1" style={{ fontSize: 28 }}>{payout?.declinedBy ? "Payout declined" : "Approved. Thank you."}</h2>
      <p className="muted">
        {payout?.declinedBy
          ? "The money stays safely in the pool. The lifeguard and the other approvers can see your reason."
          : paid
            ? `That's ${payout?.approvals} of ${payout?.approvalsNeeded}. ${pool.lifeguard.name.split(" ")[0]}'s ${formatUsdc(payout?.net ?? 0)} payout is on its way, and everyone in the pool can see it.`
            : `${payout?.approvals} of ${payout?.approvalsNeeded} approvals so far. We'll pay out once enough approvers agree.`}
      </p>
      <Link href="/home" className="btn btn-primary" style={{ marginTop: 6 }}>
        Back to home
      </Link>
    </div>
  );
}

function Approve() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [cheer, setCheer] = useState<PoolDetail | null>(null);
  const [turned, setTurned] = useState(false);
  const { user } = useSession();
  const pool = useResource(() => api.getPool(id), [id]);
  const approve = useAction(api.approvePayout);
  const decline = useAction(api.declinePayout);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [decided, setDecided] = useState<PoolDetail | null>(null);

  return (
    <div style={{ display: "grid", gap: 16, width: "min(532px, 100%)", margin: "0 auto" }}>
      <PageHead back={`/pools/${id}`} title="Approve payout" />
      <Loaded resource={pool}>
        {(p) => {
          if (decided) return <Decided pool={decided} />;
          if (p.approvers.some((a) => a.userId === user?.id && a.status !== "waiting")) return <Decided pool={p} />;
          const payout = p.payout;
          if (p.role !== "approver" || !payout || p.status !== "approval") {
            return (
              <p className="note">
                <Icon name="info" />
                {p.role !== "approver" ? "You're not an approver for this pool." : "There's no payout waiting for approval."}
              </p>
            );
          }
          const approvedBy = p.approvers.filter((a) => a.status === "approved");
          return (
            <>
              <section style={{ display: "grid", justifyItems: "center", gap: 6, padding: 24, border: "1px solid var(--line-soft)", borderRadius: 24, textAlign: "center" }}>
                <Avatar name={p.lifeguard.name} size={60} />
                <p className="t-small muted" style={{ marginTop: 4 }}>{p.lifeguard.name} is asking for</p>
                <div className="t-amount-xl">
                  <Money value={payout.net ?? 0} />
                </div>
                <p className="t-small muted">
                  from {p.emoji} {p.name}
                </p>
              </section>
              <dl className="kv">
                <div>
                  <dt>Raised</dt>
                  <dd>
                    {formatUsdc(payout.gross ?? 0)} from {p.paidCount} of {p.expectedCount} divers
                  </dd>
                </div>
                <div>
                  <dt>Goes to</dt>
                  <dd>{p.lifeguard.name}, PoolFi balance</dd>
                </div>
                <div>
                  <dt>PoolFi fee</dt>
                  <dd>{formatUsdc(payout.fee ?? 0)}</dd>
                </div>
                <div>
                  <dt>Approvals</dt>
                  <dd>
                    {payout.approvals} of {payout.approvalsNeeded} needed
                    {approvedBy.length ? `, ${approvedBy.map((a) => a.name.split(" ")[0]).join(", ")} approved` : ""}
                  </dd>
                </div>
              </dl>
              <div style={{ display: "grid", justifyItems: "center", gap: 6, textAlign: "center", marginTop: 4 }}>
                <HoldToApprove
                  disabled={approve.busy}
                  onApproved={async (button) => {
                    confettiFrom(button, 40);
                    sound.win();
                    haptic([30, 40, 30]);
                    const shownAt = Date.now();
                    const done = await approve.run(p.id);
                    if (!done.ok) return;
                    setTurned(true);
                    // The key stays turned a moment, then the big thank-you.
                    setTimeout(() => {
                      setDecided(done.value);
                      setCheer(done.value);
                    }, Math.max(0, 900 - (Date.now() - shownAt)));
                  }}
                />
                <b className="t-h3" style={{ fontWeight: 700, marginTop: 6 }}>{turned ? "Approved" : approve.busy ? "Approving…" : "Hold to approve"}</b>
                <p className="t-small muted">Only approve if this matches what your group agreed.</p>
                <button className="btn btn-ghost" style={{ textDecoration: "underline", textUnderlineOffset: 3 }} onClick={() => setDeclining(true)}>
                  Decline this payout
                </button>
                <ErrorText error={approve.error} />
              </div>
              <Modal open={declining} onClose={() => setDeclining(false)} label="Decline this payout">
                <div style={{ display: "grid", gap: 12 }}>
                  <h2 className="t-h2">Decline this payout?</h2>
                  <p className="muted t-small">
                    {p.lifeguard.name.split(" ")[0]} and the other approvers will see your reason. The money stays safely in the pool.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {REASONS.map((r) => (
                      <button key={r} className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
                        {r}
                      </button>
                    ))}
                  </div>
                  <BusyButton
                    busy={decline.busy}
                    className="btn btn-signout btn-block"
                    style={{ borderRadius: 999 }}
                    onClick={async () => {
                      const done = await decline.run(p.id, reason);
                      if (done.ok) {
                        setDeclining(false);
                        setDecided(done.value);
                      }
                    }}
                  >
                    Decline payout
                  </BusyButton>
                  <button className="btn btn-secondary btn-block" onClick={() => setDeclining(false)}>
                    Go back
                  </button>
                  <ErrorText error={decline.error} />
                </div>
              </Modal>
            </>
          );
        }}
      </Loaded>
      {cheer && (
        <Celebration
          mood="proud"
          l1="Approved."
          l2="Thank you."
          text={
            cheer.payout?.paidAt
              ? `That's ${cheer.payout.approvals} of ${cheer.payout.approvalsNeeded}. ${cheer.lifeguard.name.split(" ")[0]}'s ${formatUsdc(cheer.payout.net ?? 0)} payout is on its way, and everyone in the pool can see it.`
              : `${cheer.payout?.approvals} of ${cheer.payout?.approvalsNeeded} approvals so far. We'll pay out once enough approvers agree.`
          }
          pills={["🔑 Trusted approver"]}
          buttons={[{ label: "Back to home", onClick: () => router.replace("/home") }]}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <AppShell>
      {() => (
        <Suspense>
          <Approve />
        </Suspense>
      )}
    </AppShell>
  );
}
