"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import s from "@/components/admin/admin.module.css";
import { ActButton, AddressLink, Amount, Card, Hero, Person, Pill, PoolLink, useAdminAction } from "@/components/admin/parts";
import { ContributionTable, DepositTable, PayoutTable, RefundTable } from "@/components/admin/tables";
import { Loaded } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { ago, dateTime } from "@/lib/format";
import { useResource } from "@/lib/hooks";

function Money() {
  const money = useResource(() => adminApi.money(), []);
  const { run, busy } = useAdminAction();

  return (
    <>
      <Hero
        title="Money"
        sub="USDC across PoolFi: pools still refunding, wallets not on Stellar yet, and the latest payouts, refunds, payments and deposits. The refund job sends refunds every few minutes; what it couldn't finish is marked, with a button to try again."
        actions={
          <button
            type="button"
            className={s.heroBtn}
            disabled={busy === "job"}
            onClick={() => run("job", () => adminApi.runRefundJob(), (r) => `Refund job ran: ${r.refunds} refunded, ${r.failures} failed`).then((r) => r && money.reload())}
          >
            {busy === "job" ? "Running…" : "Run the refund job"}
          </button>
        }
      />
      <main className={s.main}>
        <Loaded resource={money}>
          {(m) => (
            <>
              <Card title="Pools still refunding" sub="Cancelled pools that still owe some of their divers">
                {m.refunding.length ? (
                  <div className={s.tableWrap}>
                    <table className={s.table}>
                      <thead>
                        <tr>
                          <th>Pool</th>
                          <th className={s.r}>Still owed</th>
                          <th>Started</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {m.refunding.map((r) => (
                          <tr key={r.pool.id} className={r.needsAttention ? s.attention : undefined}>
                            <td>
                              <PoolLink pool={r.pool} />
                            </td>
                            <td className={s.r}>
                              <b>
                                <Amount value={r.owed} />
                              </b>
                              <span className={s.small}>
                                of <Amount value={r.pool.raised} />
                              </span>
                            </td>
                            <td>
                              {r.needsAttention ? <Pill tone="amber">Stuck</Pill> : <Pill tone="blue">In progress</Pill>}
                              <span className={s.small}>{ago(r.startedAt)}</span>
                            </td>
                            <td className={s.r}>
                              <ActButton
                                busy={busy === r.pool.id}
                                onClick={() =>
                                  run(r.pool.id, () => adminApi.retryRefunds(r.pool.id), (x) => (x.refundsFinishedAt ? "Everyone has been refunded" : "Some refunds are still left")).then(
                                    (x) => x && money.reload(),
                                  )
                                }
                              >
                                Send the refunds left
                              </ActButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={s.empty}>No pool is waiting on refunds.</p>
                )}
              </Card>

              <Card title="Wallets not on Stellar" sub="Their owners can't add USDC, pay or be paid until the wallet is on Stellar">
                {m.wallets.length ? (
                  <div className={s.tableWrap}>
                    <table className={s.table}>
                      <thead>
                        <tr>
                          <th>Owner</th>
                          <th>Wallet</th>
                          <th>Made</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {m.wallets.map((w) => (
                          <tr key={w.address} className={s.attention}>
                            <td>
                              <Person person={w.user} />
                            </td>
                            <td>
                              <AddressLink address={w.address} chain={m.chain} />
                            </td>
                            <td className={s.num}>{dateTime(w.createdAt)}</td>
                            <td className={s.r}>
                              <ActButton busy={busy === w.address} onClick={() => run(w.address, () => adminApi.activateWallet(w.user.id), "Wallet is on Stellar").then((x) => x && money.reload())}>
                                Put on Stellar
                              </ActButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={s.empty}>Every wallet is on Stellar.</p>
                )}
              </Card>

              <Card title="Payouts" sub="Paid-out pools: what each lifeguard got">
                <PayoutTable rows={m.payouts} chain={m.chain} />
              </Card>
              <Card title="Refunds" sub="USDC sent back from cancelled pools">
                <RefundTable rows={m.refunds} chain={m.chain} />
              </Card>
              <Card title="Payments" sub="Shares paid into pools">
                <ContributionTable rows={m.contributions} chain={m.chain} />
              </Card>
              <Card title="USDC added" sub="Deposits into wallets">
                <DepositTable rows={m.deposits} chain={m.chain} />
              </Card>
            </>
          )}
        </Loaded>
      </main>
    </>
  );
}

export default function Page() {
  return <AdminShell>{() => <Money />}</AdminShell>;
}
