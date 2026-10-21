"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Icon } from "@/components/Icon";
import { Celebration, CountUp } from "@/components/motion";
import { AppShell, PageHead } from "@/components/shells";
import { BusyButton, ComingSoon, ErrorText, Loaded, Money } from "@/components/ui";
import { MethodButton } from "@/components/wallet";
import { api } from "@/lib/api";
import { useAction, useResource } from "@/lib/hooks";
import { feeOf, formatUsdc, roundUsdc } from "@/lib/money";

function RequestPayout() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pool = useResource(() => api.getPool(id), [id]);
  const request = useAction(api.requestPayout);
  const [dest, setDest] = useState<"wallet" | "bank">("wallet");
  const [bank, setBank] = useState(false);
  const [landed, setLanded] = useState<number | null>(null);

  return (
    <div style={{ display: "grid", gap: 16, width: "min(532px, 100%)", margin: "0 auto" }}>
      <PageHead back={`/pools/${id}`} title="Request payout" />
      <Loaded resource={pool}>
        {(p) => {
          const fee = feeOf(p.raised, p.feeBps);
          const net = roundUsdc(p.raised - fee);
          if (p.role !== "lifeguard" || p.status !== "met") {
            return (
              <div className="note">
                <Icon name="info" />
                <span>
                  {p.role !== "lifeguard"
                    ? "Only this pool's lifeguard can request the payout."
                    : p.status === "active"
                      ? "This pool hasn't reached its goal yet."
                      : p.status === "approval"
                        ? "The payout is already waiting for approvers."
                        : "This pool is closed."}{" "}
                  <Link href={p.status === "approval" ? `/pools/${id}/payout/status` : `/pools/${id}`} style={{ textDecoration: "underline" }}>
                    {p.status === "approval" ? "See approvals" : "Back to the pool"}
                  </Link>
                </span>
              </div>
            );
          }
          const names = p.approvers.map((a) => a.name.split(" ")[0]);
          return (
            <>
              <section style={{ padding: "26px 24px", borderRadius: 24, background: "var(--blue)", color: "var(--white)", textAlign: "center", boxShadow: "var(--shadow-balance)" }}>
                <p style={{ opacity: 0.85 }}>You&apos;ll receive</p>
                <div className="t-amount-xl" style={{ margin: "6px 0" }}>
                  <CountUp value={net} delay={200} format={(v) => <Money value={v} />} />
                </div>
                <p className="t-small" style={{ opacity: 0.85 }}>
                  from {p.emoji} {p.name}
                </p>
              </section>
              <dl className="kv">
                <div>
                  <dt>Raised from {p.paidCount} divers</dt>
                  <dd>{formatUsdc(p.raised)}</dd>
                </div>
                <div>
                  <dt>PoolFi fee ({p.feeBps / 100}%){p.feeCoveredByDivers ? ", covered by divers" : ""}</dt>
                  <dd>−{formatUsdc(fee)}</dd>
                </div>
                <div>
                  <dt>You receive</dt>
                  <dd style={{ color: "var(--blue)" }}>{formatUsdc(net)}</dd>
                </div>
              </dl>
              <p className="t-h3" style={{ fontWeight: 700 }}>Send it to</p>
              <MethodButton icon={<Icon name="wallet" />} title="My PoolFi balance" detail="Keep it in PoolFi as USDC" selected={dest === "wallet"} onClick={() => setDest("wallet")} />
              <MethodButton icon={<Icon name="bank" />} title="Bank account" detail="Paid out in Naira" badge="Coming soon" selected={dest === "bank"} onClick={() => setDest("bank")} />
              <p className="note">
                <Icon name={names.length ? "key" : "users"} />
                {names.length
                  ? `${names.join(", ")} will be asked to approve. ${p.approvalsNeeded} of ${names.length} must say yes before the money moves.`
                  : "This pool has no approvers, so the payout goes straight to you. Everyone in the pool can see it happen."}
              </p>
              <div className="phone-foot">
                <BusyButton
                  busy={request.busy}
                  className="btn btn-success btn-block"
                  onClick={async () => {
                    if (dest === "bank") return setBank(true);
                    const done = await request.run(p.id, dest);
                    if (!done.ok) return;
                    if (done.value.status === "approval") router.push(`/pools/${p.id}/payout/status`);
                    // No approvers: it lands straight away.
                    else setLanded(net);
                  }}
                >
                  Request payout
                </BusyButton>
              </div>
              <ErrorText error={request.error} />
              <ComingSoon open={bank} onClose={() => setBank(false)} title="Bank payouts are coming soon">
                Soon you&apos;ll be able to receive payouts straight to a Nigerian bank account. For now, keep it in your PoolFi balance.
              </ComingSoon>
              {landed !== null && (
                <Celebration
                  l1="Payout"
                  l2="landed."
                  k="You received"
                  value={landed}
                  format={(v) => <Money value={v} />}
                  text="Added to your PoolFi balance. A full record is saved in your pool history."
                  pills={["🎉 Full pool badge"]}
                  buttons={[
                    { label: "View the record", onClick: () => router.replace(`/pools/${p.id}/record`) },
                    { label: "Back to home", ghost: true, onClick: () => router.replace("/home") },
                  ]}
                />
              )}
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
          <RequestPayout />
        </Suspense>
      )}
    </AppShell>
  );
}
