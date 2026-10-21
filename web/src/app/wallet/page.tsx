"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useToast } from "@/components/providers";
import { AppShell, PageHead } from "@/components/shells";
import { CountUp, Sea } from "@/components/motion";
import { ComingSoon, CopyField, EmptyState, Loaded, Money } from "@/components/ui";
import { AddFundsModal } from "@/components/wallet";
import { api } from "@/lib/api";
import { shortAddress, shortDate } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import { formatUsdc } from "@/lib/money";
import type { Transaction } from "@/lib/types";
import h from "../home/home.module.css";
import ws from "./wallet.module.css";

const TX_ICON: Record<Transaction["kind"], IconName> = {
  payout: "download",
  refund: "refresh",
  deposit: "plus",
  contribution: "send",
  withdrawal: "out",
};

function WalletPage() {
  const toast = useToast();
  const wallet = useResource(() => api.getWallet(), []);
  const [addFunds, setAddFunds] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [freshTx, setFreshTx] = useState<string | null>(null);

  return (
    <>
      <PageHead title="My wallet" backOnPhone="/home" />
      <Loaded resource={wallet}>
        {(w) => (
          <>
            <section className={`${h.balance} rise`} aria-label="Balance">
              <div className="grain" style={{ borderRadius: "inherit" }} />
              <Sea height={90} wave={70} lift={16} slow={14} fast={10} style={{ opacity: 0.35, zIndex: -1 }} />
              <div className={h.balanceTop}>
                <div>
                  <span className={h.glassPill}>
                    <Icon name="wallet" /> USDC balance
                  </span>
                  <div className={h.balanceAmount}>
                    <CountUp value={w.balance} format={(v) => <Money value={v} />} />
                  </div>
                  <p className={h.balanceSub}>Payouts, refunds and deposits land here.</p>
                </div>
                <button className="btn btn-white" onClick={() => setAddFunds(true)}>
                  <Icon name="plus" /> Add funds
                </button>
                <button className="btn btn-glass" onClick={() => setWithdraw(true)}>
                  Withdraw
                </button>
              </div>
            </section>

            <div className={ws.cols}>
              <section className={ws.card}>
                <div className={ws.cardHead}>
                  <h2 className={`t-h2 ${ws.cardTitle}`}>Your Stellar wallet</h2>
                  <span className="pill pill-navy">{w.network}</span>
                </div>
                <div className="t-amount-l">
                  <CountUp value={w.balance} format={(v) => <Money value={v} />} />
                </div>
                <div className="hide-m">
                  <CopyField value={w.address} display={shortAddress(w.address)} onCopied={() => toast("Address copied", "📋")} />
                </div>
                <p className={`${ws.addressLine} hide-d`}>
                  {shortAddress(w.address)} ·
                  <button
                    data-sound="pick"
                    onClick={async () => {
                      await navigator.clipboard.writeText(w.address).catch(() => {});
                      toast("Address copied", "📋");
                    }}
                  >
                    Copy address
                  </button>
                </p>
                <p className="t-small muted hide-m">Your own wallet, created when you joined. Fund it with USDC on Stellar and pay into any pool. PoolFi pays the network fees.</p>
                <button className={`btn btn-secondary ${ws.deposit}`} onClick={() => setAddFunds(true)}>
                  Deposit USDC
                </button>
              </section>

              <section className={`${h.panel} ${ws.txPanel}`} aria-label="Transactions">
                <div className={h.panelHead}>
                  <h2 className="t-h2">Transactions</h2>
                </div>
                {w.transactions.length ? (
                  <div className={h.list}>
                    {w.transactions.map((t, i) => (
                      <div
                        key={t.id}
                        className={`row-card ${t.id === freshTx ? "row-fresh" : "rise"}`}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", animationDelay: t.id === freshTx ? undefined : `${Math.min(i, 10) * 50}ms` }}
                      >
                        <span className={ws.txIcon}>
                          <Icon name={TX_ICON[t.kind]} size={18} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{t.title}</div>
                          <div className="t-caption muted">{shortDate(t.at)}</div>
                        </div>
                        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: t.direction === "in" ? "var(--green-ink)" : "var(--ink)" }}>
                          {t.direction === "in" ? "+" : "−"}
                          {formatUsdc(t.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No transactions yet">Deposits, payments, payouts and refunds show up here.</EmptyState>
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
          setFreshTx(w.transactions[0]?.id ?? null);
          wallet.set(w);
        }}
      />
      <ComingSoon open={withdraw} onClose={() => setWithdraw(false)} title="Withdrawals to your bank are coming soon">
        Soon you&apos;ll be able to send your balance to any Nigerian bank account. Your USDC stays safe in your PoolFi wallet until then.
      </ComingSoon>
    </>
  );
}

export default function Page() {
  return <AppShell>{() => <WalletPage />}</AppShell>;
}
