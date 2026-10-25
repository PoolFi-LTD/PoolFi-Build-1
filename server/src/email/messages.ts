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
  /** A one-time code shown large, under the paragraphs. */
  code?: string;
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
${m.code ? `<div style="margin:4px 0 20px;padding:18px 8px;border-radius:16px;background:#eff3fc;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#052698">${escapeHtml(m.code)}</div>` : ""}
${details}${button}
</td></tr>
<tr><td style="padding:0 28px 26px;color:${MUTED};font-size:12px;line-height:1.5">${escapeHtml(m.footer)}</td></tr>
</table></td></tr></table>
</body></html>`;
  const text = [
    m.title,
    "",
    ...m.paragraphs.flatMap((p) => [p, ""]),
    ...(m.code ? [m.code, ""] : []),
    ...(m.details?.length ? [...m.details.map(([label, value]) => `${label}: ${value}`), ""] : []),
    ...(url ? [`${m.button?.label}: ${url}`, ""] : []),
    "--",
    m.footer,
  ].join("\n");
  return { subject: oneLine(m.subject), html, text };
}

/** The payment receipt, laid out like the app's receipt (the "Receipt" design). */
export function receiptEmail(
  p: { poolName: string; poolEmoji: string; lifeguardName: string; diverName: string; amount: number; ref: string; paidAt: Date },
  ctx: EmailContext,
): Rendered {
  const subject = `Receipt: ${usdc(p.amount)} paid into ${p.poolName}`;
  const base = ctx.appUrl?.replace(/\/$/, "") ?? null;
  const checkUrl = base ? `${base}/r/${encodeURIComponent(p.ref)}` : null;
  const receiptUrl = base ? `${base}/receipts/${encodeURIComponent(p.ref)}` : null;
  const host = base ? base.replace(/^https?:\/\//, "") : null;
  const [whole, cents] = p.amount.toFixed(2).split(".");
  const rows: [string, string][] = [
    ["Pool", `${p.poolEmoji} ${p.poolName}`],
    ["Lifeguard", p.lifeguardName],
    ["Paid by", p.diverName],
    ["Method", "USDC from PoolFi wallet"],
    ["Date", dateTime(p.paidAt, ctx.timeZone)],
    ["Reference", p.ref],
  ];
  const row = ([label, value]: [string, string]) =>
    `<tr><td style="padding:9px 0;color:${MUTED};font-size:15px">${escapeHtml(label)}</td><td align="right" style="padding:9px 0;color:${INK};font-size:15px;font-weight:600">${escapeHtml(value)}</td></tr>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${BLUE};font-family:${FONT};color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Reference ${escapeHtml(p.ref)}. Keep this for your records.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BLUE};padding:32px 14px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td align="center" style="color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px">PoolFi</td></tr>
<tr><td align="center" style="color:#ffffff;opacity:0.85;font-size:16px;padding:6px 0 26px">Payment receipt</td></tr>
<tr><td style="background:#ffffff;border-radius:26px;padding:30px 26px 26px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center"><div style="width:64px;height:64px;line-height:64px;border-radius:50%;background:#12b76a;color:#ffffff;font-size:34px;font-weight:700;text-align:center">&#10003;</div></td></tr>
    <tr><td align="center" style="padding-top:18px;font-size:44px;font-weight:800;letter-spacing:-2px;color:${INK}">${escapeHtml(whole ?? "0")}.${escapeHtml(cents ?? "00")}<span style="font-size:20px;font-weight:700;letter-spacing:0;margin-left:6px">USDC</span></td></tr>
    <tr><td align="center" style="padding:6px 0 18px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:24px;color:${BLUE}">paid to ${escapeHtml(p.poolName)}</td></tr>
    <tr><td style="border-top:2px dashed ${LINE};padding-top:8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${rows.map(row).join("")}
        <tr><td style="padding:9px 0;color:${MUTED};font-size:15px">Status</td><td align="right" style="padding:9px 0"><span style="display:inline-block;padding:5px 12px;border-radius:999px;background:#ecfdf3;color:#067647;font-size:14px;font-weight:600">&#10003; Confirmed</span></td></tr>
      </table>
    </td></tr>
    ${
      checkUrl
        ? `<tr><td style="padding-top:16px"><div style="background:#eff3fc;border-radius:18px;padding:16px 18px">
      <div style="color:#052698;font-size:16px;font-weight:700">Is this receipt real?</div>
      <div style="padding-top:4px;font-size:14px"><a href="${escapeHtml(checkUrl)}" style="color:${BLUE};text-decoration:none">Visit ${escapeHtml(`${host}/r/${p.ref}`)}</a></div>
      <div style="padding-top:6px;color:${MUTED};font-size:13px;line-height:1.5">Bank screenshots can be edited. PoolFi receipts can always be checked.</div>
    </div></td></tr>`
        : ""
    }
    ${
      receiptUrl
        ? `<tr><td align="center" style="padding-top:20px"><a href="${escapeHtml(receiptUrl)}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 24px;border-radius:999px">View or download the receipt</a></td></tr>`
        : ""
    }
  </table>
</td></tr>
${host ? `<tr><td align="center" style="color:#ffffff;font-size:16px;font-weight:600;padding-top:22px">${escapeHtml(host)}</td></tr>` : ""}
</table></td></tr></table>
</body></html>`;
  const text = [
    `You paid ${usdc(p.amount)} to ${p.poolName}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "Status: Confirmed",
    "",
    ...(checkUrl ? [`Is this receipt real? Check it at ${checkUrl}`, ""] : []),
    ...(receiptUrl ? [`View or download the receipt: ${receiptUrl}`, ""] : []),
    "--",
    `${FOOTER} Anyone you show this receipt to can check it on PoolFi with its reference.`,
  ].join("\n");
  return { subject, html, text };
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
        "If you haven't paid yet, it takes a minute. The money is held safely until the goal is met. If it isn't met in time, the lifeguard gives the pool more time or refunds everyone.",
      ],
      button: { label: "Pay your share", path: `/p/${encodeURIComponent(p.code)}` },
      footer: `${p.lifeguardName} added you to this pool. If that isn't you, you can ignore this email.`,
    },
    ctx,
  );
}

/** To the lifeguard, once each time the deadline passes below the goal: they choose what happens next. */
export function goalMissedEmail(
  p: { poolName: string; poolId: string; raised: number; goal: number; paidCount: number; expectedCount: number; deadline: Date },
  ctx: EmailContext,
): Rendered {
  return render(
    {
      subject: `${p.poolName} missed its deadline`,
      preview: `${usdc(p.raised)} of ${usdc(p.goal)} came in. Extend the date or refund the divers.`,
      title: "Your pool's deadline has passed",
      paragraphs: [
        `${p.poolName} reached its deadline before its goal. ${p.paidCount} of ${p.expectedCount} divers paid.`,
        "Nothing is refunded until you decide. Give everyone more time with a new deadline, or refund everyone who paid straight away. Until then, divers can't pay in or take their money out.",
      ],
      details: [
        ["Raised", usdc(p.raised)],
        ["Goal", usdc(p.goal)],
        ["Deadline", dateTime(p.deadline, ctx.timeZone)],
      ],
      button: { label: "Extend or refund", path: `/pools/${p.poolId}` },
      footer: `${FOOTER} You're its lifeguard.`,
    },
    ctx,
  );
}

/** To everyone in the pool when the lifeguard gives it more time. */
export function deadlineExtendedEmail(
  p: { poolName: string; poolId: string; code: string; lifeguardName: string; deadline: Date; paid: boolean },
  ctx: EmailContext,
): Rendered {
  return render(
    {
      subject: `${p.poolName} has a new deadline`,
      preview: `${p.lifeguardName} gave the pool until ${day(p.deadline, ctx.timeZone)}.`,
      title: "The deadline has moved",
      paragraphs: [
        `${p.lifeguardName} gave ${p.poolName} more time. The new deadline is ${dateTime(p.deadline, ctx.timeZone)}.`,
        p.paid
          ? "Your payment stays safely in the pool. Once the goal is met, the lifeguard is paid out."
          : "There's still time to pay your share before the new deadline.",
      ],
      button: p.paid
        ? { label: "See the pool", path: `/pools/${p.poolId}` }
        : { label: "Pay your share", path: `/p/${encodeURIComponent(p.code)}` },
      footer: FOOTER,
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
        `${p.poolName} didn't reach its goal, so everyone who paid got their money back. Your ${usdc(p.amount)} is in your PoolFi balance.`,
      ],
      button: { label: "Open your wallet", path: "/wallet" },
      footer: FOOTER,
    },
    ctx,
  );
}

export function signInCodeEmail(p: { code: string; minutes: number }, ctx: EmailContext): Rendered {
  return render(
    {
      subject: `Your PoolFi code is ${p.code}`,
      preview: `Use it in the next ${p.minutes} minutes to finish signing in.`,
      title: "Finish signing in",
      paragraphs: ["Your password was right. Type this code into PoolFi to finish signing in."],
      code: p.code,
      footer: `It works once and expires in ${p.minutes} minutes. Nobody from PoolFi will ever ask you for it. If you didn't just sign in, change your password: someone may know it.`,
    },
    ctx,
  );
}

export function unlockCodeEmail(p: { email: string; code: string; minutes: number; attempts: number }, ctx: EmailContext): Rendered {
  return render(
    {
      subject: "Your PoolFi account is locked",
      preview: `After ${p.attempts} wrong passwords. Use the code inside to unlock it.`,
      title: "We locked your account to keep it safe",
      paragraphs: [
        `Someone typed the wrong password ${p.attempts} times in a row, so we've paused sign-ins to your account.`,
        "If it was you, type this code into PoolFi to unlock it, then sign in again. If you've forgotten your password, choose \"Forgot password\" instead.",
      ],
      code: p.code,
      button: { label: "Unlock my account", path: `/signup/unlock?to=${encodeURIComponent(p.email)}` },
      footer: `The code expires in ${p.minutes} minutes. If it wasn't you, your money is safe: nobody can sign in without this code.`,
    },
    ctx,
  );
}
