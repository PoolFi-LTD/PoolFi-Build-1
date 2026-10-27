"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import s from "@/components/admin/admin.module.css";
import { Amount, Card, GrowthChart, Hero, Kpis, Seg, useAdminAction } from "@/components/admin/parts";
import { Icon } from "@/components/Icon";
import { Loaded } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { ago } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import { formatUsdc } from "@/lib/money";
import type { AdminEvent, AdminOverview } from "@/lib/types";

/** The front page refreshes itself this often while it's on screen. */
const REFRESH_MS = 20_000;

const EVENT_ICON: Record<AdminEvent["kind"], string> = {
  signup: "👋",
  deposit: "🪙",
  admin: "🛠️",
  created: "✨",
  joined: "🙌",
  payment: "💧",
  reminder: "📣",
  goal_met: "🎉",
  approval: "🔑",
  payout: "💸",
  refund: "↩️",
  missed: "⏰",
  extended: "📅",
};

function Overview() {
  const overview = useResource(() => adminApi.overview(), []);
  const { reload } = overview;
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && reload(), REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);
  return <Loaded resource={overview}>{(o) => <OverviewBody o={o} reload={reload} />}</Loaded>;
}

function OverviewBody({ o, reload }: { o: AdminOverview; reload: () => void }) {
  const { run, busy } = useAdminAction();
  const [show, setShow] = useState<"users" | "collected">("users");
  const k = o.kpis;
  const a = o.attention;
  const f = o.friction;
  const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
  const testnet = o.chain.network !== "Stellar";
  return (
    <>
      <Hero
        title={
          <>
            {k.users.toLocaleString("en-US")} {k.users === 1 ? "person is" : "people are"} on <span>PoolFi</span>
          </>
        }
        sub={`${k.activeUsers7d} used it in the last 7 days. ${k.poolsOpen} of ${k.pools} pools are open. Money is USDC on ${o.chain.network}${testnet ? ", so none of it is real" : ""}.`}
        actions={
          <>
            <span className={`${s.chip} ${testnet ? "" : s.chipLive}`}>
              <i />
              {o.chain.network}
            </span>
            <button type="button" className={`${s.heroBtn} ${s.heroBtnGhost}`} onClick={reload}>
              <Icon name="refresh" size={16} /> Refresh
            </button>
            <button
              type="button"
              className={s.heroBtn}
              disabled={busy === "job"}
              onClick={() =>
                run("job", () => adminApi.runRefundJob(), (r) => `Refund job ran: ${r.refunds} refunded, ${r.failures} failed`).then((r) => {
                  if (r) reload();
                })
              }
            >
              {busy === "job" ? "Running…" : "Run the refund job"}
            </button>
          </>
        }
      >
        <Kpis
          items={[
            { label: "Signed up", value: k.users.toLocaleString("en-US"), note: `${k.usersNew7d} in the last 7 days` },
            { label: "Active this week", value: k.activeUsers7d.toLocaleString("en-US"), note: `${pct(k.activeUsers7d, k.users)} of everyone` },
            { label: "Pools", value: k.pools.toLocaleString("en-US"), note: `${k.poolsOpen} open now` },
            { label: "Paid into pools", value: formatUsdc(k.collected), note: k.payments === 1 ? "in 1 payment" : `in ${k.payments.toLocaleString("en-US")} payments` },
            { label: "Added to wallets", value: formatUsdc(k.deposited), note: k.deposits === 1 ? "in 1 deposit" : `in ${k.deposits.toLocaleString("en-US")} deposits` },
            { label: "Paid out", value: formatUsdc(k.paidOut), note: `${k.payouts === 1 ? "1 payout" : `${k.payouts} payouts`} · ${formatUsdc(k.fees)} in fees` },
          ]}
        />
      </Hero>

      <main className={s.main}>
        <div className={s.split}>
          <div className={s.col}>
            <Card title="Needs a look" sub="Things the refund job couldn't finish on its own, and pools waiting on people">
              <div className={s.mini}>
                <Stat href="/admin/money" label="Refunds unfinished" value={a.refunds} note="pools still owing USDC back" />
                <Stat href="/admin/money" label="Wallets not on Stellar" value={a.wallets} note="can't pay or be paid yet" />
                <Stat href="/admin/pools?status=missed" label="Deadlines passed" value={a.poolsMissed} note="waiting for the lifeguard" />
                <Stat href="/admin/pools?status=approval" label="Payouts awaiting approval" value={a.payoutsAwaitingApproval} note="waiting for approvers" calm />
                <Stat href="/admin/users?filter=locked" label="Locked accounts" value={a.lockedAccounts} note="too many wrong passwords" />
                <Stat label="In pools now" value={<Amount value={k.inPools} />} note={`${formatUsdc(k.owed)} still to refund`} calm />
              </div>
            </Card>

            <Card
              title="Growth"
              sub={show === "users" ? "Everyone on PoolFi, day by day (Lagos time)" : "USDC paid into pools each day"}
              tools={
                <Seg
                  label="Chart"
                  value={show}
                  onChange={setShow}
                  options={[
                    { value: "users", label: "People" },
                    { value: "collected", label: "USDC paid in" },
                  ]}
                />
              }
            >
              <GrowthChart data={o.growth} show={show} />
            </Card>

            <Card title="Where people get stuck" sub="The last 7 days, unless it says otherwise">
              <div className={s.mini}>
                <Stat label="Wrong-password streaks" value={f.signInFailures} note="emails with recent wrong passwords" calm />
                <Stat label="Sign-in codes used" value={f.codesSent ? pct(f.codesUsed, f.codesSent) : "—"} note={`${f.codesSent} codes sent`} calm />
                <Stat href="/admin/users?filter=new" label="Signed up, did nothing" value={f.signedUpOnly} note="all time: no pool joined or paid" calm />
                <Stat label="Wallets never funded" value={f.walletsNeverFunded} note="all time: no USDC ever added" calm />
                <Stat label="Notifications on" value={f.pushOn} note={`of ${k.users} people`} calm />
                <Stat label="Refunded" value={<Amount value={k.refunded} />} note="all time, back in wallets" calm />
              </div>
            </Card>
          </div>

          <div className={s.col}>
            <Card title="Activity" sub={`Latest first · updated ${ago(o.generatedAt)}`}>
              {o.events.length ? (
                <ul className={s.feed}>
                  {o.events.map((e) => {
                    const href = e.poolId ? `/admin/pools/${e.poolId}` : e.userId ? `/admin/users/${e.userId}` : null;
                    return (
                      <li key={e.id}>
                        <span className={s.feedIcon} aria-hidden="true">
                          {EVENT_ICON[e.kind]}
                        </span>
                        <div>
                          {href ? <Link href={href}>{e.title}</Link> : e.title}
                          <small>
                            {e.amount !== null && `${formatUsdc(e.amount)} · `}
                            {ago(e.at)}
                          </small>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={s.empty}>No activity yet.</p>
              )}
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}

/** A count that links to where it can be dealt with; amber while there's something to do. */
function Stat({ label, value, note, href, calm }: { label: string; value: React.ReactNode; note: string; href?: string; calm?: boolean }) {
  const warn = !calm && typeof value === "number" && value > 0;
  const body = (
    <>
      <p>{label}</p>
      <b className={s.num}>{value}</b>
      <small>{note}</small>
    </>
  );
  const className = `${s.stat} ${warn ? s.statWarn : ""}`;
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default function Page() {
  return <AdminShell>{() => <Overview />}</AdminShell>;
}
