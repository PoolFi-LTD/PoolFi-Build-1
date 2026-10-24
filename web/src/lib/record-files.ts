import { dateTime, fullDateTime } from "./format";
import { amountOrDash, formatUsdc } from "./money";
import type { PoolRecord } from "./types";

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function fileBase(record: PoolRecord): string {
  return `PoolFi-${record.pool.name.replace(/[^\w-]+/g, "-")}-${record.pool.code}`;
}

/** A spreadsheet of every contribution; opens in Excel and Google Sheets. */
export function downloadCsv(record: PoolRecord, withContacts: boolean) {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ["#", "Diver", ...(withContacts ? ["Phone or email"] : []), "When", "Amount (USDC)", "Status"];
  const lines = record.rows.map((r) =>
    [r.index, r.name, ...(withContacts ? [r.contact ?? ""] : []), r.paidAt ? fullDateTime(r.paidAt) : "", r.amount.toFixed(2), r.status.replace("_", " ")].map(cell).join(","),
  );
  save(new Blob([`﻿${[header.map(cell).join(","), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" }), `${fileBase(record)}.csv`);
}

/** The branded statement: every contribution and how to check it. */
export async function downloadStatement(record: PoolRecord, withContacts: boolean, checkUrl: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const p = record.pool;
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(27, 79, 216);
  doc.rect(0, 0, W, 92, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold").setFontSize(22).text("PoolFi", 40, 50);
  doc.setFont("helvetica", "normal").setFontSize(11).text("Pool statement", 40, 70);
  doc.setTextColor(11, 21, 48);
  doc.setFont("helvetica", "bold").setFontSize(18).text(p.name, 40, 130);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(91, 100, 120);
  doc.text(`Pool ID ${p.code}   ·   Lifeguard ${p.lifeguard.name}   ·   Reference ${record.reference}`, 40, 148);
  const paid = record.rows.filter((r) => r.status !== "not_paid");
  const summary: [string, string][] = [
    ["Raised", amountOrDash(p.raised)],
    ["Divers paid", `${paid.length} of ${p.expectedCount}`],
    ["PoolFi fee", p.payout ? amountOrDash(p.payout.fee) : "—"],
    [p.status === "refunded" ? "Refunded" : "Paid out", p.status === "refunded" ? amountOrDash(p.totalRefunded) : p.payout ? amountOrDash(p.payout.net) : "Not yet"],
  ];
  summary.forEach(([k, v], i) => {
    const x = 40 + i * 130;
    doc.setFontSize(9).setTextColor(91, 100, 120).text(k, x, 182);
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(11, 21, 48).text(v, x, 200);
    doc.setFont("helvetica", "normal");
  });
  const cols = withContacts ? [40, 70, 230, 370, 470, 530] : [40, 70, 300, 450, 530];
  const head = withContacts ? ["#", "Diver", "Phone or email", "When", "Amount", "Status"] : ["#", "Diver", "When", "Amount", "Status"];
  let y = 240;
  doc.setFillColor(245, 247, 251);
  doc.rect(36, y - 14, W - 72, 22, "F");
  doc.setFontSize(9).setTextColor(91, 100, 120);
  head.forEach((h, i) => doc.text(h, cols[i], y));
  doc.setTextColor(11, 21, 48);
  for (const r of record.rows) {
    y += 20;
    if (y > 790) {
      doc.addPage();
      y = 60;
    }
    const values = [String(r.index), r.name, ...(withContacts ? [r.contact ?? ""] : []), r.paidAt ? dateTime(r.paidAt) : "", r.amount ? r.amount.toFixed(2) : "", r.status.replace("_", " ")];
    values.forEach((v, i) => doc.text(v, cols[i], y, { maxWidth: (cols[i + 1] ?? W - 40) - cols[i] - 6 }));
  }
  y = Math.min(y + 36, 800);
  doc.setFontSize(9).setTextColor(91, 100, 120);
  doc.text(`Every contribution can be checked at ${checkUrl}. Amounts in USDC. Generated ${fullDateTime(new Date().toISOString())}.`, 40, y, { maxWidth: W - 80 });
  if (withContacts) doc.text("Contains phone numbers and emails. Keep this file private.", 40, y + 14);
  doc.save(`${fileBase(record)}.pdf`);
}

/** A picture for the group chat: totals and who has paid, never phone numbers. */
export async function downloadSummaryImage(record: PoolRecord) {
  await document.fonts.ready;
  const p = record.pool;
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font-space-grotesk").trim() || "sans-serif";
  const names = record.rows.filter((r) => r.status !== "not_paid").map((r) => r.name);
  const W = 1080;
  const rowsPerCol = 20;
  const H = 520 + Math.min(rowsPerCol, Math.ceil(names.length / 2)) * 44 + 80;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return;
  g.fillStyle = "#1B4FD8";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#FFFFFF";
  g.font = `700 44px ${font}`;
  g.fillText("PoolFi", 72, 100);
  g.font = `700 64px ${font}`;
  g.fillText(`${p.emoji} ${p.name}`, 72, 220, W - 144);
  g.font = `500 34px ${font}`;
  g.globalAlpha = 0.9;
  g.fillText(`${p.raised !== null ? `${formatUsdc(p.raised)} raised · ` : ""}${names.length} of ${p.expectedCount} paid`, 72, 290);
  g.globalAlpha = 1;
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.beginPath();
  g.roundRect(56, 340, W - 112, H - 400, 32);
  g.fill();
  g.fillStyle = "#FFFFFF";
  g.font = `500 30px ${font}`;
  names.slice(0, rowsPerCol * 2).forEach((n, i) => {
    const col = i < rowsPerCol ? 0 : 1;
    g.fillText(`✓ ${n}`, 96 + col * 470, 400 + (i % rowsPerCol) * 44, 430);
  });
  if (names.length > rowsPerCol * 2) g.fillText(`+ ${names.length - rowsPerCol * 2} more`, 96, H - 90);
  await new Promise<void>((resolve) =>
    c.toBlob((b) => {
      if (b) save(b, `${fileBase(record)}-summary.png`);
      resolve();
    }, "image/png"),
  );
}
