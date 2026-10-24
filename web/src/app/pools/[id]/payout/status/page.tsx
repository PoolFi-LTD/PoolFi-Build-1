"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Drip } from "@/components/Drip";
import { Icon } from "@/components/Icon";
import { Celebration } from "@/components/motion";
import { useToast } from "@/components/providers";
import { sound } from "@/lib/sound";
import { AppShell, PageHead } from "@/components/shells";
import { Avatar, Loaded, Money } from "@/components/ui";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { useNow, useResource } from "@/lib/hooks";
import { formatUsdc } from "@/lib/money";

/** The lifeguard watches approvals come in; the page checks again every few seconds. */
function Status() {
  const { id } = useParams<{ id: string }>();
  const now = useNow(1000);
  const router = useRouter();
  const toast = useToast();
  const pool = useResource(() => api.getPool(id), [id]);
  const waiting = pool.data?.status === "approval";

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(pool.reload, 3000);
    return () => clearInterval(t);
  }, [waiting, pool.reload]);

  // Each approval that arrives while you watch gets a toast.
  const approvedIds = pool.data?.approvers.filter((a) => a.status === "approved").map((a) => a.userId).join(",");
  const known = useRef<string | null>(null);
  useEffect(() => {
    if (approvedIds === undefined) return;
    const before = known.current?.split(",").filter(Boolean);
    known.current = approvedIds;
    if (!before) return;
    pool.data?.approvers
      .filter((a) => a.status === "approved" && !before.includes(a.userId))
      .forEach((a) => {
        toast(`${a.name.split(" ")[0]} approved`, "🔑");
        sound.win();
      });
  }, [approvedIds, pool.data, toast]);

  // Celebrate if the payout lands while you're watching.
  const [watched, setWatched] = useState(false);
  if (waiting && !watched) setWatched(true);

  return (
    <div style={{ display: "grid", gap: 16, width: "min(532px, 100%)", margin: "0 auto" }}>
      <PageHead back={`/pools/${id}`} title="Payout approval" />
      <Loaded resource={pool}>
        {(p) => {
          const payout = p.payout;
          if (!payout) {
            return (
              <p className="note">
                <Icon name="info" /> No payout has been requested for this pool yet.
              </p>
            );
          }
          if (payout.paidAt) {
            return (
              <div style={{ display: "grid", justifyItems: "center", gap: 12, textAlign: "center", padding: "20px 0" }}>
                {watched && (
                  <Celebration
                    l1="Payout"
                    l2="landed."
                    k="You received"
                    value={payout.net ?? 0}
                    format={(v) => <Money value={v} />}
                    text="Added to your PoolFi balance. A full record is saved in your pool history."
                    pills={["🎉 Full pool badge"]}
                    buttons={[
                      { label: "View the record", onClick: () => router.replace(`/pools/${p.id}/record`) },
                      { label: "Back to home", ghost: true, onClick: () => router.replace("/home") },
                    ]}
                  />
                )}
                <Drip size={96} mood="cheer" pop />
                <h2 className="t-h1" style={{ fontSize: 28 }}>Payout landed</h2>
                <div className="t-amount-l">
                  <Money value={payout.net ?? 0} />
                </div>
                <p className="muted">Added to your PoolFi balance. A full record is saved in your pool history.</p>
                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                  <Link href={`/pools/${p.id}/record`} className="btn btn-primary">
                    View the record
                  </Link>
                  <Link href="/home" className="btn btn-secondary">
                    Back to home
                  </Link>
                </div>
              </div>
            );
          }
          if (payout.declinedBy) {
            return (
              <div style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
                <Drip size={90} mood="think" pop />
                <h2 className="t-h2">{payout.declinedBy.name} declined the payout</h2>
                <p className="muted">&ldquo;{payout.declinedBy.reason}&rdquo;. The money stays safely in the pool.</p>
                <Link href={`/pools/${p.id}/payout`} className="btn btn-primary">
                  Request again
                </Link>
              </div>
            );
          }
          const approved = p.approvers.filter((a) => a.status === "approved").length;
          return (
            <>
              <div style={{ display: "grid", justifyItems: "center", gap: 8, textAlign: "center" }}>
                <Drip size={80} pop />
                <h2 className="t-h2">Waiting for your approvers</h2>
                <p className="t-small muted">
                  {formatUsdc(payout.net ?? 0)} from {p.name}. We&apos;ve let them know in the app.
                </p>
              </div>
              <div style={{ padding: 16, border: "2px solid var(--line-soft)", borderRadius: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <b className="t-h3" style={{ fontWeight: 700 }}>
                    {payout.approvalsNeeded} of {p.approvers.length} must approve
                  </b>
                  <span className="t-small muted">{approved} approved</span>
                </div>
                <div className="tracker">
                  {Array.from({ length: payout.approvalsNeeded }, (_, i) => (
                    <i key={i} className={i < approved ? "f" : undefined} />
                  ))}
                </div>
              </div>
              {p.approvers.map((a) => (
                <div
                  key={a.userId}
                  className={`appr${a.status === "approved" ? " ok" : ""}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    border: `2px solid ${a.status === "approved" ? "var(--green)" : "var(--line-soft)"}`,
                    borderRadius: 16,
                    background: a.status === "approved" ? "var(--green-50)" : "var(--white)",
                  }}
                >
                  <Avatar name={a.name} avatar={a.avatar} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{a.name}</div>
                    <div className="t-small muted">{a.status === "approved" && a.at ? `Approved ${ago(a.at, now).toLowerCase()}` : "Waiting"}</div>
                  </div>
                  <span className="kicon" style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 999, background: "var(--line-soft)", color: "var(--slate)" }}>
                    <Icon name="key" size={18} />
                  </span>
                </div>
              ))}
              <div style={{ padding: "8px 16px", border: "2px solid var(--line-soft)", borderRadius: 18 }}>
                <div className="timeline">
                  <div className="tl done">
                    <b>Payout requested</b>
                    <span>{ago(payout.requestedAt, now)}</span>
                  </div>
                  <div className="tl now">
                    <b>Approvers approving</b>
                    <span>
                      {approved} of {payout.approvalsNeeded} so far
                    </span>
                  </div>
                  <div className="tl">
                    <b>Money lands in your PoolFi balance</b>
                    <span>As soon as enough approvers agree</span>
                  </div>
                </div>
              </div>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

export default function Page() {
  return (
    <AppShell>
      {() => (
        <Suspense>
          <Status />
        </Suspense>
      )}
    </AppShell>
  );
}
