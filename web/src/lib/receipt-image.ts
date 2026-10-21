import QRCode from "qrcode";
import { fullDateTime } from "./format";
import { formatAmount } from "./money";
import type { Receipt } from "./types";

const W = 1080;
const H = 1640;

function fontFamily(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

/** Draws the shareable 1080 × 1640 receipt from the design and returns it as a PNG. */
export async function receiptPng(receipt: Receipt, checkUrl: string): Promise<Blob> {
  await document.fonts.ready;
  const display = fontFamily("--font-space-grotesk", "sans-serif");
  const body = fontFamily("--font-inter", "sans-serif");
  const serif = fontFamily("--font-instrument-serif", "serif");
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This browser can't draw images.");

  g.fillStyle = "#1B4FD8";
  g.fillRect(0, 0, W, H);
  g.textAlign = "center";
  g.fillStyle = "#FFFFFF";
  g.font = `700 52px ${display}`;
  g.fillText("PoolFi", W / 2, 110);
  g.globalAlpha = 0.85;
  g.font = `500 32px ${display}`;
  g.fillText("Payment receipt", W / 2, 170);
  g.globalAlpha = 1;

  // The card
  g.fillStyle = "#FFFFFF";
  roundRect(g, 48, 318, W - 96, 1230, 56);
  g.fillStyle = "#12B76A";
  g.beginPath();
  g.arc(W / 2, 430, 64, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#FFFFFF";
  g.lineWidth = 9;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(W / 2 - 24, 432);
  g.lineTo(W / 2 - 6, 450);
  g.lineTo(W / 2 + 26, 414);
  g.stroke();

  g.fillStyle = "#0B1530";
  g.font = `700 104px ${display}`;
  g.fillText(`${formatAmount(receipt.amount)} USDC`, W / 2, 620);
  g.fillStyle = "#1B4FD8";
  g.font = `italic 400 58px ${serif}`;
  g.fillText(`paid to ${receipt.poolName}`, W / 2, 705);

  g.strokeStyle = "#E6EAF2";
  g.lineWidth = 3;
  g.setLineDash([12, 12]);
  g.beginPath();
  g.moveTo(104, 740);
  g.lineTo(W - 104, 740);
  g.stroke();
  g.setLineDash([]);

  const rows: [string, string][] = [
    ["Pool", `${receipt.poolEmoji} ${receipt.poolName}`],
    ["Lifeguard", receipt.lifeguardName],
    ["Paid by", receipt.paidBy],
    ["Method", receipt.method],
    ["Date", fullDateTime(receipt.paidAt)],
    ["Reference", receipt.ref],
  ];
  rows.forEach(([label, value], i) => {
    const y = 800 + i * 70;
    g.textAlign = "left";
    g.fillStyle = "#5B6478";
    g.font = `400 31px ${body}`;
    g.fillText(label, 104, y);
    g.textAlign = "right";
    g.fillStyle = "#0B1530";
    g.font = `500 31px ${display}`;
    g.fillText(value, W - 104, y);
  });
  // Status
  const sy = 800 + rows.length * 70;
  g.textAlign = "left";
  g.fillStyle = "#5B6478";
  g.font = `400 31px ${body}`;
  g.fillText("Status", 104, sy);
  g.fillStyle = "#ECFDF3";
  roundRect(g, W - 104 - 200, sy - 38, 200, 56, 28);
  g.fillStyle = "#067647";
  g.textAlign = "center";
  g.font = `500 28px ${display}`;
  g.fillText("✓ Confirmed", W - 104 - 100, sy);

  // "Is this receipt real?"
  g.fillStyle = "#EFF3FC";
  roundRect(g, 104, 1250, W - 208, 248, 40);
  g.fillStyle = "#FFFFFF";
  roundRect(g, 134, 1280, 188, 188, 24);
  const qr = new Image();
  qr.src = await QRCode.toDataURL(checkUrl, { margin: 0, width: 160, color: { dark: "#052698", light: "#ffffff" } });
  await qr.decode();
  g.drawImage(qr, 148, 1294, 160, 160);
  g.textAlign = "left";
  g.fillStyle = "#052698";
  g.font = `700 32px ${display}`;
  g.fillText("Is this receipt real?", 352, 1330);
  g.font = `400 25px ${body}`;
  g.fillText(`Scan or visit ${checkUrl.replace(/^https?:\/\//, "")}`, 352, 1376);
  g.fillStyle = "#5B6478";
  g.font = `400 23px ${body}`;
  g.fillText("Bank screenshots can be edited.", 352, 1420);
  g.fillText("PoolFi receipts can always be checked.", 352, 1454);

  g.textAlign = "center";
  g.fillStyle = "#FFFFFF";
  g.font = `500 32px ${display}`;
  g.fillText(new URL(checkUrl).host, W / 2, 1600);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't create the image."))), "image/png"));
}
