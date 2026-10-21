"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Icon, Logo } from "@/components/Icon";
import { Sea } from "@/components/motion";
import { useToast } from "@/components/providers";
import { BusyButton, Loaded, QrCode } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { fullDateTime } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import { formatAmount } from "@/lib/money";
import { receiptPng } from "@/lib/receipt-image";
import type { Receipt } from "@/lib/types";

function checkUrl(ref: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
  return `${origin}/r/${ref}`;
}

function ReceiptCard({ r }: { r: Receipt }) {
  const url = checkUrl(r.ref);
  const rows: [string, React.ReactNode][] = [
    ["Pool", `${r.poolEmoji} ${r.poolName}`],
    ["Lifeguard", r.lifeguardName],
    ["Paid by", r.paidBy],
    ["Method", r.method],
    ["Date", fullDateTime(r.paidAt)],
    ["Reference", r.ref],
    ["Status", <span key="s" className="pill pill-green">✓ Confirmed</span>],
  ];
  return (
    <div className="rise w-540" style={{ position: "relative", isolation: "isolate", overflow: "hidden", padding: "40px 24px 24px", borderRadius: 28, background: "var(--blue)", color: "var(--white)", textAlign: "center" }}>
      <div className="grain" />
      <div style={{ position: "relative", paddingBottom: 60 }}>
        <Logo tone="white" size={40} />
        <p style={{ marginTop: 8, opacity: 0.85, fontFamily: "var(--font-display)", fontSize: 17 }}>Payment receipt</p>
        <Sea height={56} wave={40} lift={10} slow={10} fast={7} style={{ left: -24, right: -24, bottom: -10 }} />
      </div>
      <div style={{ position: "relative", padding: "28px 30px", borderRadius: 28, background: "var(--white)", color: "var(--ink)" }}>
        <span className="tick-pop" style={{ display: "inline-grid", placeItems: "center", width: 70, height: 70, borderRadius: 999, background: "var(--green)", color: "var(--white)" }}>
          <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden="true" className="draw-tick">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="t-amount-xl" style={{ marginTop: 18 }}>
          {formatAmount(r.amount)}
          <span className="unit">USDC</span>
        </div>
        <p className="t-serif" style={{ fontSize: 30, color: "var(--blue)", margin: "8px 0 18px" }}>paid to {r.poolName}</p>
        <dl style={{ margin: 0, borderTop: "2px dashed var(--line)", paddingTop: 6 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", fontSize: 15 }}>
              <dt className="muted">{k}</dt>
              <dd style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 500 }}>{v}</dd>
            </div>
          ))}
        </dl>
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 14, padding: 14, borderRadius: 20, background: "var(--blue-50)", textAlign: "left" }}>
          <QrCode value={url} size={84} />
          <div style={{ color: "var(--navy)" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>Is this receipt real?</div>
            <div className="t-small" style={{ wordBreak: "break-all" }}>Scan or visit {url.replace(/^https?:\/\//, "")}</div>
            <div className="t-caption muted">Bank screenshots can be edited. PoolFi receipts can always be checked.</div>
          </div>
        </div>
      </div>
      <p style={{ marginTop: 20, fontFamily: "var(--font-display)", fontWeight: 500 }}>{new URL(url).host}</p>
    </div>
  );
}

function ReceiptPage() {
  const { ref } = useParams<{ ref: string }>();
  const router = useRouter();
  const toast = useToast();
  const receipt = useResource(() => api.getReceipt(ref), [ref]);
  const [saving, setSaving] = useState(false);

  async function download(r: Receipt) {
    setSaving(true);
    try {
      const blob = await receiptPng(r, checkUrl(r.ref));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `PoolFi-receipt-${r.ref}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(messageOf(e), "⚠️");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", justifyItems: "center", alignContent: "start", gap: 20, padding: "32px 24px 48px", background: "var(--bg)" }}>
      <div className="w-540" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="icon-btn" onClick={() => router.back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1 className="t-h2" style={{ flex: 1 }}>Receipt</h1>
      </div>
      <Loaded resource={receipt}>
        {(r) => (
          <>
            <ReceiptCard r={r} />
            <div className="w-540" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <BusyButton busy={saving} className="btn btn-primary" style={{ flex: 1 }} onClick={() => download(r)}>
                <Icon name="download" /> Download image
              </BusyButton>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={async () => {
                  await navigator.clipboard.writeText(checkUrl(r.ref)).catch(() => {});
                  toast("Check link copied", "🔗");
                }}
              >
                <Icon name="copy" /> Copy check link
              </button>
            </div>
          </>
        )}
      </Loaded>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ReceiptPage />
    </Suspense>
  );
}
