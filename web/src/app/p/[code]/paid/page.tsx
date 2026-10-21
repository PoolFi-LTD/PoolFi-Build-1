"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Achievement, coinRain, confetti, Sea } from "@/components/motion";
import { Loaded } from "@/components/ui";
import { haptic, sound } from "@/lib/sound";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { formatUsdc } from "@/lib/money";

function Paid() {
  const params = useSearchParams();
  const ref = params.get("ref") ?? "";
  const poolId = params.get("pool");
  const badges = (params.get("badges") ?? "").split("|").filter(Boolean);
  const receipt = useResource(() => api.getReceipt(ref), [ref]);
  const early = badges.some((b) => b.includes("Early diver"));
  const [medal, setMedal] = useState(false);
  const cheered = useRef(false);

  // Confetti and a rain of coins, then the badge if you earned one.
  useEffect(() => {
    if (!cheered.current) {
      cheered.current = true;
      sound.big();
      haptic([20, 40, 20]);
    }
    const t1 = setTimeout(() => {
      confetti(window.innerWidth / 2, window.innerHeight * 0.32, 60);
      coinRain(30);
    }, 300);
    const t2 = early ? setTimeout(() => setMedal(true), 1900) : undefined;
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [early]);

  return (
    <main
      style={{
        position: "relative",
        isolation: "isolate",
        overflow: "hidden",
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(180deg, #1B4FD8 0%, #052698 100%)",
        color: "var(--white)",
        textAlign: "center",
      }}
    >
      <div className="grain" />
      <div className="cele-rays" />
      <Sea height={120} wave={90} lift={24} frontOpacity={0.9} style={{ zIndex: -1 }} />
      <Loaded resource={receipt}>
        {(r) => (
          <div style={{ position: "relative", display: "grid", justifyItems: "center", gap: 14, width: "min(300px, 100%)" }}>
            {/* Rings spread out while the tick draws itself. */}
            <span className="ripw" style={{ "--ripw": "150px", display: "grid", placeItems: "center" } as React.CSSProperties}>
              <span className="ring" />
              <span className="ring" />
              <span className="ring" />
              <span className="tick-pop" style={{ position: "relative", display: "grid", placeItems: "center", width: 126, height: 126, borderRadius: 999, background: "#1F7FE3" }}>
                <span style={{ display: "grid", placeItems: "center", width: 100, height: 100, borderRadius: 999, background: "var(--white)", color: "var(--green)" }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true" className="draw-tick">
                    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </span>
            </span>
            <h1 className="t-serif say-in" style={{ fontSize: 72, whiteSpace: "nowrap", animationDelay: "350ms" }}>
              You&apos;re in!
            </h1>
            <p className="rise" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, whiteSpace: "nowrap", animationDelay: "450ms" }}>
              {formatUsdc(r.amount)} paid into {r.poolName}
            </p>
            <p className="rise" style={{ opacity: 0.85, whiteSpace: "nowrap", animationDelay: "520ms" }}>
              No more reminders for this pool. Your receipt is saved.
            </p>
            {badges.length > 0 && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", margin: "4px 0 8px" }}>
                {badges.map((b, i) => (
                  <span key={b} className="cele-pill" style={{ fontSize: 15, animationDelay: `${0.6 + i * 0.15}s` }}>
                    {b}
                  </span>
                ))}
              </div>
            )}
            <Link href={poolId ? `/pools/${poolId}` : "/home"} className="btn btn-white btn-block rise" style={{ animationDelay: "700ms" }}>
              See the pool
            </Link>
            <Link href={`/receipts/${r.ref}`} className="btn btn-glass btn-block rise" style={{ animationDelay: "780ms" }}>
              View receipt
            </Link>
          </div>
        )}
      </Loaded>
      {medal && <Achievement icon="⚡" title="Early diver" text="You paid within a day of the invite. Lifeguards love to see it." onClose={() => setMedal(false)} />}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Paid />
    </Suspense>
  );
}
