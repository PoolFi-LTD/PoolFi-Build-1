"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Icon } from "@/components/Icon";
import { Celebration, CountUp, Sea } from "@/components/motion";
import { ActivityRow, BalanceTile, PoolRow } from "@/components/pool";
import { AppShell } from "@/components/shells";
import { ComingSoon, EmptyState, Loaded, Money } from "@/components/ui";
import { AddFundsModal } from "@/components/wallet";
import { api } from "@/lib/api";
import { greeting, longDate } from "@/lib/format";
import { useNow, useResource } from "@/lib/hooks";
import { formatUsdc } from "@/lib/money";
import type { User } from "@/lib/types";
import s from "./home.module.css";

/** After sign-up, a welcome moment over the new home. */
function Welcome({ user }: { user: User }) {
  const router = useRouter();
  const [open, setOpen] = useState(useSearchParams().get("welcome") === "1");
  if (!open) return null;
  const done = (to: string) => {
    setOpen(false);
    router.replace(to);
  };
  return (
    <Celebration
      l1="Welcome in,"
      l2={`${user.firstName}.`}
      text="Your first pool is one tap away. It takes about a minute."
      buttons={[
        { label: "Create my first pool", onClick: () => done("/create") },
        { label: "Look around first", ghost: true, onClick: () => done("/home") },
      ]}
    />
  );
}

function Home({ user }: { user: User }) {
  const now = useNow();
  const home = useResource(() => api.getHome(), []);
  const wallet = useResource(() => api.getWallet(), []);
  const [addFunds, setAddFunds] = useState(false);
  const [withdraw, setWithdraw] = useState(false);

  return (
    <>
      <header className={s.header}>
        <div>
          <h1 className={`t-h1 ${s.greet}`}>
            {greeting(new Date(now))}, {user.firstName || "there"}.
          </h1>
          <p className={s.date}>{longDate(new Date(now))}</p>
        </div>
        <Link href="/notifications" className="icon-btn" aria-label="Notifications">
          {/* The bell rings while something needs you. */}
          <span className={home.data?.alerts.length ? "bell-ring" : undefined} style={{ display: "grid" }}>
            <Icon name="bell" />
          </span>
        </Link>
        <Link href="/settings" className="icon-btn hide-m" aria-label="Settings">
          <Icon name="gear" />
        </Link>
        <Link href="/create" className="btn btn-primary hide-m">
          <Icon name="plus" /> New pool
        </Link>
      </header>

      <Loaded resource={home}>
        {(h) => (
          <>
            <section className={`${s.balance} rise`} aria-label="Your PoolFi balance">
              <div className="grain" style={{ borderRadius: "inherit" }} />
              <Sea height={90} wave={70} lift={16} slow={14} fast={10} style={{ opacity: 0.35, zIndex: -1 }} />
              <div className={s.balanceTop}>
                <div>
                  <span className={s.glassPill}>
                    <Icon name="wallet" /> Your PoolFi balance
                  </span>
                  <div className={s.balanceAmount}>
                    <CountUp value={h.balance} format={(v) => <Money value={v} />} />
                  </div>
                  <p className={s.balanceSub}>
                    Total balance{h.locked > 0 ? `, including ${formatUsdc(h.locked)} in open pools` : ""}
                  </p>
                </div>
                <button className="btn btn-white" onClick={() => setAddFunds(true)}>
                  <Icon name="plus" /> Add funds
                </button>
                <button className="btn btn-glass" onClick={() => setWithdraw(true)}>
                  Withdraw
                </button>
              </div>
              <div className={s.tiles}>
                <BalanceTile label="Available" value={h.available} caption="Free to use or withdraw" />
                <BalanceTile label="Locked" value={h.locked} caption={h.lockedPools ? `Your share in ${h.lockedPools} open pool${h.lockedPools > 1 ? "s" : ""}` : "Nothing locked right now"} />
                <BalanceTile className="hide-m" label="Pools" value={`${h.activePools} active`} caption={h.contributionsExpected ? `${h.contributionsIn} of ${h.contributionsExpected} contributions in` : "Start one in under a minute"} />
              </div>
            </section>

            {h.alerts.length > 0 && (
              <div className={s.alerts}>
                {h.alerts.map((a) =>
                  a.kind === "goal_met" ? (
                    <Link key={`m-${a.poolId}`} href={`/pools/${a.poolId}/payout`} className="banner banner-green attn">
                      <span aria-hidden="true">🎉</span>
                      <strong>{a.poolName} is full.</strong>
                      <span className="banner-rest">Request your payout</span>
                    </Link>
                  ) : (
                    <Link key={`a-${a.poolId}`} href={`/pools/${a.poolId}/approve`} className="banner banner-blue attn">
                      <span aria-hidden="true">🔑</span>
                      <strong>{a.requester} needs your approval</strong>
                      <span className="banner-rest">{a.poolName}</span>
                    </Link>
                  ),
                )}
              </div>
            )}

            <div className={s.columns}>
              <section className={s.panel} aria-label="Your pools">
                <div className={s.panelHead}>
                  <h2 className="t-h2">Your pools</h2>
                  <Link href="/pools" className={s.viewAll}>
                    View all →
                  </Link>
                </div>
                {h.pools.length ? (
                  <div className={s.list}>
                    {h.pools.map((p, i) => (
                      <PoolRow key={p.id} pool={p} now={now} index={i} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No pools yet"
                    action={
                      <Link href="/create" className="btn btn-primary btn-sm">
                        Create your first pool
                      </Link>
                    }
                  >
                    Collect class dues, birthday money or office welfare with one link.
                  </EmptyState>
                )}
              </section>
              <section className={s.panel} aria-label="Recent activity">
                <div className={s.panelHead}>
                  <h2 className="t-h2">Recent activity</h2>
                  <Link href="/activity" className={s.viewAll}>
                    View all →
                  </Link>
                </div>
                {h.activity.length ? (
                  <div className={s.list}>
                    {h.activity.map((item, i) => (
                      <ActivityRow key={item.id} item={item} now={now} index={i} />
                    ))}
                  </div>
                ) : (
                  <p className="muted t-small" style={{ padding: "8px 4px 16px" }}>
                    Payments, reminders and payouts in your pools show up here.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </Loaded>

      <AddFundsModal
        open={addFunds}
        onClose={() => setAddFunds(false)}
        wallet={wallet.data}
        onDeposited={(w) => {
          wallet.set(w);
          home.reload();
        }}
      />
      <ComingSoon open={withdraw} onClose={() => setWithdraw(false)} title="Withdrawals to your bank are coming soon">
        Soon you&apos;ll be able to send your balance to any Nigerian bank account. Your USDC stays safe in your PoolFi wallet until then.
      </ComingSoon>
    </>
  );
}

export default function Page() {
  return (
    <AppShell>
      {(user) => (
        <>
          <Home user={user} />
          <Suspense>
            <Welcome user={user} />
          </Suspense>
        </>
      )}
    </AppShell>
  );
}
