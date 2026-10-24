"use client";

import { useParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useToast } from "@/components/providers";
import { AppShell, PageHead } from "@/components/shells";
import { Loaded, Modal, StatusPill, Toggle } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { dateTime, shortDate } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import { amountOrDash, formatUsdc } from "@/lib/money";
import { downloadCsv, downloadStatement, downloadSummaryImage } from "@/lib/record-files";

function Tile({ label, value, index }: { label: string; value: string; index: number }) {
  return (
    <div className="rise" style={{ padding: "14px 16px", borderRadius: 18, background: "var(--bg)", animationDelay: `${index * 60}ms` }}>
      <div className="t-small muted">{label}</div>
      <div className="t-amount-l" style={{ fontSize: 26, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Download({ emoji, title, detail, onClick, busy }: { emoji: string; title: string; detail: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="method rise"
      style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "2px solid var(--line)", borderRadius: 18, background: "var(--white)", textAlign: "left", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, flex: "none", borderRadius: 12, background: "var(--bg)", fontSize: 20 }} aria-hidden="true">{emoji}</span>
      <span>
        <span style={{ display: "block", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 16 }}>{title}</span>
        <span style={{ display: "block", color: "var(--slate)", fontSize: 13 }}>{detail}</span>
      </span>
    </button>
  );
}

function Record() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const record = useResource(() => api.getRecord(id), [id]);
  const [withContacts, setWithContacts] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  async function run(name: string, fn: () => Promise<void> | void) {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(messageOf(e), "⚠️");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Loaded resource={record}>
      {(r) => {
        const p = r.pool;
        const paid = r.rows.filter((x) => x.status !== "not_paid").length;
        const contacts = p.role === "lifeguard";
        const subtitle =
          p.status === "paidout" && p.payout?.paidAt
            ? `Paid out ${shortDate(p.payout.paidAt)}, reference ${r.reference}`
            : p.status === "refunded"
              ? `Refunded ${p.closedAt ? shortDate(p.closedAt) : ""}, reference ${r.reference}`
              : `Open, reference ${r.reference}`;
        const checkUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin}/r/`;
        return (
          <>
            <PageHead back={`/pools/${id}`} title={`${p.emoji} ${p.name}`} subtitle={subtitle} aside={<StatusPill status={p.status} />} />
            <div className="grid-4">
              <Tile index={0} label="Raised" value={amountOrDash(p.raised)} />
              <Tile index={1} label="Divers paid" value={`${paid} of ${p.expectedCount}`} />
              <Tile index={2} label="PoolFi fee" value={p.payout ? amountOrDash(p.payout.fee) : "—"} />
              <Tile index={3} label={p.status === "refunded" ? "Refunded" : "Paid out"} value={p.status === "refunded" ? amountOrDash(p.totalRefunded) : p.payout?.paidAt ? amountOrDash(p.payout.net) : "Not yet"} />
            </div>
            <div className="grid-3">
              <Download emoji="📄" title="Statement PDF" detail="Branded, every contribution, can be checked" busy={busy === "pdf"} onClick={() => run("pdf", () => downloadStatement(r, contacts && withContacts, checkUrl))} />
              <Download emoji="🖼️" title="Summary image" detail="For the group chat. Never shows phone numbers" busy={busy === "img"} onClick={() => run("img", () => downloadSummaryImage(r))} />
              <Download emoji="📊" title="More options" detail="Spreadsheet (Excel or CSV)" onClick={() => setMore(true)} />
            </div>
            <div className="table-scroll" style={{ overflow: "hidden", border: "1px solid var(--line-soft)", borderRadius: 20 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "var(--bg)", color: "var(--slate)", textAlign: "left" }}>
                    {["#", "Diver", ...(contacts ? ["Phone"] : []), "When", "Amount", "Status"].map((h) => (
                      <th key={h} style={{ padding: "12px 16px", fontWeight: 500, fontFamily: "var(--font-display)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row) => (
                    <tr key={row.index} className="rise" style={{ borderTop: "1px solid var(--line-soft)", animationDelay: `${Math.min(row.index, 12) * 30}ms` }}>
                      <td style={{ padding: "11px 16px" }}>{row.index}</td>
                      <td style={{ padding: "11px 16px", fontFamily: "var(--font-display)", fontWeight: 500 }}>{row.name}</td>
                      {contacts && <td style={{ padding: "11px 16px" }} className="muted">{row.contact ?? "—"}</td>}
                      <td style={{ padding: "11px 16px" }}>{row.paidAt ? dateTime(row.paidAt) : "—"}</td>
                      <td style={{ padding: "11px 16px" }}>{row.amount ? formatUsdc(row.amount) : "—"}</td>
                      <td style={{ padding: "11px 16px" }}>
                        {row.status === "refunded" ? <StatusPill status="refunded" /> : <StatusPill status={row.status === "paid" ? "paid" : "not_paid"} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {contacts && (
              <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Toggle on={withContacts} onChange={setWithContacts} label="Include phone numbers in the statement" />
                <span className="t-small muted">Include phone numbers in the statement. A keep-private note is printed on the file.</span>
              </label>
            )}
            <Modal open={more} onClose={() => setMore(false)} label="Download a spreadsheet">
              <div style={{ display: "grid", gap: 12 }}>
                <h2 className="t-h2">Download a spreadsheet</h2>
                <p className="muted t-small">A CSV file opens in Excel, Google Sheets and Numbers.</p>
                <button
                  className="btn btn-primary btn-block"
                  onClick={() => {
                    downloadCsv(r, contacts && withContacts);
                    setMore(false);
                  }}
                >
                  Download CSV
                </button>
              </div>
            </Modal>
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
          <Record />
        </Suspense>
      )}
    </AppShell>
  );
}
