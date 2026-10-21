/**
 * The emails PoolFi sends, in the app's words (lifeguard, divers, pool). Each has
 * an HTML version in PoolFi's colours and a plain-text one. Names come from users,
 * so everything is escaped.
 */

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

/** Where links point and how dates read. */
export interface EmailContext {
  /** The web app's address; without it emails have no buttons. */
  appUrl: string | null;
  timeZone: string;
}

interface Message {
  subject: string;
  /** The line inboxes show after the subject. */
  preview: string;
  title: string;
  paragraphs: string[];
  details?: [string, string][];
  button?: { label: string; path: string };
  footer: string;
}

const BLUE = "#1b4fd8";
const INK = "#0b1530";
const MUTED = "#5b6478";
const BG = "#f5f7fb";
const LINE = "#e6eaf2";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FOOTER = "You're getting this because you're in a PoolFi pool.";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Subjects are one line. */
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** 1.58 → "1.58 USDC", 2171.3 → "2,171.30 USDC". */
export function usdc(value: number): string {
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

function day(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(date);
}

function dateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function render(m: Message, ctx: EmailContext): Rendered {
  const url = m.button && ctx.appUrl ? `${ctx.appUrl.replace(/\/$/, "")}${m.button.path}` : null;
  const details = m.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;border-top:1px solid ${LINE}">${m.details
        .map(
          ([label, value]) =>
            `<tr><td style="padding:11px 0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:14px">${escapeHtml(label)}</td><td align="right" style="padding:11px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:14px;font-weight:600">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const button = url
    ? `<a href="${escapeHtml(url)}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 24px;border-radius:999px">${escapeHtml(m.button?.label ?? "")}</a>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(oneLine(m.subject))}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(m.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:22px;overflow:hidden">
<tr><td style="background:${BLUE};padding:22px 28px;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px">PoolFi</td></tr>
<tr><td style="padding:30px 28px 28px">
<h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;letter-spacing:-0.4px;color:${INK}">${escapeHtml(m.title)}</h1>
${m.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${INK}">${escapeHtml(p)}</p>`).join("\n")}
${details}${button}
</td></tr>
<tr><td style="padding:0 28px 26px;color:${MUTED};font-size:12px;line-height:1.5">${escapeHtml(m.footer)}</td></tr>
</table></td></tr></table>
</body></html>`;
  const text = [
    m.title,
    "",
    ...m.paragraphs.flatMap((p) => [p, ""]),
    ...(m.details?.length ? [...m.details.map(([label, value]) => `${label}: ${value}`), ""] : []),
    ...(url ? [`${m.button?.label}: ${url}`, ""] : []),
    "--",
    m.footer,
  ].join("\n");
  return { subject: oneLine(m.subject), html, text };
}

export function receiptEmail(
  p: { poolName: string; poolEmoji: string; lifeguardName: string; diverName: string; amount: number; ref: string; paidAt: Date },
  ctx: EmailContext,
): Rendered {
  return render(
    {
      subject: `Receipt: ${usdc(p.amount)} paid into ${p.poolName}`,
      preview: `Reference ${p.ref}. Keep this for your records.`,
      title: `You paid ${usdc(p.amount)} ✅`,
      paragraphs: [`Your share is in ${p.poolEmoji} ${p.poolName}, held safely until the goal is met. ${p.lifeguardName} can see you've paid.`],
      details: [
        ["Paid as", p.diverName],
        ["Amount", usdc(p.amount)],
        ["Date", dateTime(p.paidAt, ctx.timeZone)],
        ["Reference", p.ref],
      ],
      button: { label: "View receipt", path: `/receipts/${encodeURIComponent(p.ref)}` },
      footer: `${FOOTER} Anyone you show this receipt to can check it on PoolFi with its reference.`,
    },
    ctx,
  );
}

export function goalMetEmail(p: { poolName: string; poolId: string; raised: number; approvers: number }, ctx: EmailContext): Rendered {
  return render(
    {
      subject: `${p.poolName} reached its goal 🎉`,
      preview: `${usdc(p.raised)} is in. Request the payout when you're ready.`,
      title: `${p.poolName} reached its goal`,
      paragraphs: [
        `Everyone's in: ${usdc(p.raised)} is held in the pool.`,
        p.approvers > 0
          ? "Request the payout when you're ready. Your approvers will be asked to confirm it."
          : "Request the payout when you're ready and it lands in your PoolFi balance.",
      ],
      button: { label: "Request the payout", path: `/pools/${p.poolId}/payout` },
      footer: FOOTER,
    },
    ctx,
  );
}

export function approvalNeededEmail(
  p: { poolName: string; poolId: string; lifeguardName: string; gross: number; needed: number; approvers: number },
  ctx: EmailContext,
): Rendered {
  return render(
    {
      subject: `${p.lifeguardName} needs your approval for ${p.poolName}`,
      preview: `A payout of ${usdc(p.gross)} is waiting for approvers.`,
      title: "A payout needs your approval",
      paragraphs: [
        `${p.lifeguardName} asked to pay out ${usdc(p.gross)} from ${p.poolName}. ${p.needed} of the ${p.approvers} approvers must agree before the money moves.`,
        "Check it looks right, then approve or decline it in PoolFi.",
      ],
      button: { label: "Review the payout", path: `/pools/${p.poolId}/approve` },
      footer: `${FOOTER} You're one of its approvers.`,
    },
    ctx,
  );
}

export function paidOutEmail(
  p: { poolName: string; poolId: string; gross: number; fee: number; net: number; reference: string },
  ctx: EmailContext,
): Rendered {
  return render(
    {
      subject: `${usdc(p.net)} from ${p.poolName} is in your PoolFi balance`,
      preview: `Payout reference ${p.reference}.`,
      title: "Your payout landed 💸",
      paragraphs: [`${p.poolName} is paid out. The money is in your PoolFi balance, and the pool's full record is saved.`],
      details: [
        ["Raised", usdc(p.gross)],
        ["PoolFi fee", usdc(p.fee)],
        ["You received", usdc(p.net)],
        ["Reference", p.reference],
      ],
      button: { label: "View the record", path: `/pools/${p.poolId}/record` },
      footer: FOOTER,
    },
    ctx,
  );
}

export function payoutDeclinedEmail(
  p: { poolName: string; poolId: string; approverName: string; reason: string },
  ctx: EmailContext,
): Rendered {
  return render(
    {
      subject: `${p.approverName} declined the payout for ${p.poolName}`,
      preview: p.reason,
      title: "Your payout was declined",
      paragraphs: [
        `${p.approverName} declined the payout for ${p.poolName}: “${p.reason}”`,
        "The money stays safely in the pool. Sort it out with your approvers, then request the payout again.",
      ],
      button: { label: "Open the pool", path: `/pools/${p.poolId}` },
      footer: FOOTER,
    },
    ctx,
  );
}

export function reminderEmail(
  p: { poolName: string; poolEmoji: string; code: string; lifeguardName: string; diverName: string; share: number; deadline: Date },
  ctx: EmailContext,
): Rendered {
  return render(
    {
      subject: `Reminder: your ${usdc(p.share)} for ${p.poolName}`,
      preview: `${p.lifeguardName} is collecting for ${p.poolName} until ${day(p.deadline, ctx.timeZone)}.`,
      title: `Hi ${p.diverName.split(" ")[0]}, your share is waiting 👋`,
      paragraphs: [
        `${p.lifeguardName} is collecting ${usdc(p.share)} each for ${p.poolEmoji} ${p.poolName} on PoolFi, until ${day(p.deadline, ctx.timeZone)}.`,
        "If you haven't paid yet, it takes a minute. The money is held safely until the goal is met, and everyone is refunded if it isn't.",
      ],
      button: { label: "Pay your share", path: `/p/${encodeURIComponent(p.code)}` },
      footer: `${p.lifeguardName} added you to this pool. If that isn't you, you can ignore this email.`,
    },
    ctx,
  );
}

export function refundEmail(p: { poolName: string; amount: number }, ctx: EmailContext): Rendered {
  return render(
    {
      subject: `Your ${usdc(p.amount)} from ${p.poolName} is back`,
      preview: "The pool missed its goal, so everyone who paid got their money back.",
      title: "You've been refunded",
      paragraphs: [
        `${p.poolName} didn't reach its goal by the deadline, so everyone who paid got their money back. Your ${usdc(p.amount)} is in your PoolFi balance.`,
      ],
      button: { label: "Open your wallet", path: "/wallet" },
      footer: FOOTER,
    },
    ctx,
  );
}
