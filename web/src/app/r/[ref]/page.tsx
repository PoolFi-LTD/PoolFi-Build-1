"use client";

import { useParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { Logo } from "@/components/Icon";
import { Ripples } from "@/components/motion";
import { Loaded } from "@/components/ui";
import { api } from "@/lib/api";
import { fullDateTime } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import { sound } from "@/lib/sound";
import { formatUsdc } from "@/lib/money";

/** Public: anyone can check a receipt reference against PoolFi's records. */
function Check() {
  const { ref } = useParams<{ ref: string }>();
  const result = useResource(() => api.verifyReceipt(ref), [ref]);
  const real = Boolean(result.data);
  // A little win when the receipt checks out.
  const won = useRef(false);
  useEffect(() => {
    if (!real || won.current) return;
    won.current = true;
    sound.win();
  }, [real]);
  return (
    <main style={{ minHeight: "100vh", display: "grid", justifyItems: "center", alignContent: "start", gap: 28, padding: "44px 24px", background: "var(--bg)" }}>
      <div className="rise">
        <Logo size={40} />
      </div>
      <div className="rise" style={{ width: "min(466px, 100%)", padding: "28px 28px 24px", borderRadius: 28, border: "1px solid var(--line-soft)", background: "var(--white)", textAlign: "center", animationDelay: "80ms" }}>
        <Loaded resource={result} label="Checking PoolFi's records…">
          {(r) =>
            r ? (
              <>
                {/* Rings spread while the tick draws itself: checked. */}
                <Ripples size={96} done />
                <h1 className="t-h1" style={{ marginTop: 16, fontSize: 28 }}>This receipt is real</h1>
                <p className="muted" style={{ margin: "10px 0 18px" }}>PoolFi recorded this payment. Records like this cannot be edited.</p>
                <dl className="kv" style={{ background: "var(--bg)", border: 0, textAlign: "left" }}>
                  <div><dt>Amount</dt><dd>{formatUsdc(r.amount)}</dd></div>
                  <div><dt>Pool</dt><dd>{r.poolName}</dd></div>
                  <div><dt>Paid by</dt><dd>{r.paidBy}</dd></div>
                  <div><dt>Date</dt><dd>{fullDateTime(r.paidAt)}</dd></div>
                  <div><dt>Reference</dt><dd>{r.ref}</dd></div>
                </dl>
                <p className="t-small muted" style={{ marginTop: 14 }}>If the details don&apos;t match what you were shown, the receipt you saw was changed.</p>
              </>
            ) : (
              <>
                <span className="tick-pop" style={{ display: "inline-grid", placeItems: "center", width: 68, height: 68, borderRadius: 999, background: "#fef3f2", color: "var(--red)", fontSize: 32, fontWeight: 700 }}>!</span>
                <h1 className="t-h1" style={{ marginTop: 16, fontSize: 28 }}>We can&apos;t find this receipt</h1>
                <p className="muted" style={{ marginTop: 10 }}>
                  PoolFi has no payment with the reference <b>{ref}</b>. If someone showed you this receipt, ask them to send the PoolFi link instead.
                </p>
              </>
            )
          }
        </Loaded>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Check />
    </Suspense>
  );
}
