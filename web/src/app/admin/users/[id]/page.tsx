"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import s from "@/components/admin/admin.module.css";
import { AddressLink, Amount, Card, Facts, Hero, PoolCard, ReasonModal, TxLink, UserPills, useAdminAction } from "@/components/admin/parts";
import { ContributionTable, DepositTable, LogTable, PayoutTable, RefundTable } from "@/components/admin/tables";
import { useSession } from "@/components/providers";
import { Loaded } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { ago, dateTime, fullDateTime } from "@/lib/format";
import { useNow, useResource } from "@/lib/hooks";
import type { AdminUserDetail } from "@/lib/types";

function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const user = useResource(() => adminApi.user(id), [id]);
  return <Loaded resource={user}>{(u) => <PersonBody u={u} set={user.set} />}</Loaded>;
}

function PersonBody({ u, set }: { u: AdminUserDetail; set: (u: AdminUserDetail) => void }) {
  const { user: me } = useSession();
  const { run, busy } = useAdminAction();
  const [suspending, setSuspending] = useState(false);
  const self = me?.id === u.id;
  const act = async (key: string, fn: () => Promise<AdminUserDetail>, done: string) => {
    const updated = await run(key, fn, done);
    if (updated) set(updated);
  };
  const now = useNow();

  return (
    <>
      <Hero
        title={u.name}
        sub={[u.email, u.phone, `joined ${fullDateTime(u.joinedAt)}`].filter(Boolean).join(" · ")}
        actions={
          <>
            {u.wallet && !u.wallet.activated && (
              <button type="button" className={s.heroBtn} disabled={busy !== null} onClick={() => act("wallet", () => adminApi.activateWallet(u.id), "Wallet is on Stellar")}>
                {busy === "wallet" ? "Putting it on Stellar…" : "Put wallet on Stellar"}
              </button>
            )}
            {u.locked && (
              <button type="button" className={s.heroBtn} disabled={busy !== null} onClick={() => act("unlock", () => adminApi.unlock(u.id), "Account unlocked")}>
                Unlock account
              </button>
            )}
            <button
              type="button"
              className={`${s.heroBtn} ${s.heroBtnGhost}`}
              disabled={busy !== null || u.sessions === 0}
              onClick={() => act("signout", () => adminApi.signOut(u.id), `${u.name} was signed out everywhere`)}
            >
              Sign out everywhere
            </button>
            {u.suspended ? (
              <button type="button" className={s.heroBtn} disabled={busy !== null} onClick={() => act("unsuspend", () => adminApi.unsuspend(u.id), "Suspension lifted")}>
                Lift suspension
              </button>
            ) : (
              !self &&
              !u.admin && (
                <button type="button" className={`${s.heroBtn} ${s.heroBtnDanger}`} onClick={() => setSuspending(true)}>
                  Suspend
                </button>
              )
            )}
          </>
        }
      >
        <div style={{ marginTop: 12 }}>
          <UserPills u={u} />
        </div>
      </Hero>

      <main className={s.main}>
        {u.suspended && (
          <p className={`${s.note} ${s.noteBad}`}>
            Suspended {u.suspendedAt ? dateTime(u.suspendedAt) : ""}: {u.suspendedReason}. They can&apos;t sign in until the suspension is lifted. Their pools and refunds carry on.
          </p>
        )}
        {u.locked && <p className={s.note}>Locked after {u.signInFailures} wrong passwords in a row. They were emailed an unlock code; unlocking here does the same.</p>}
        {u.wallet && !u.wallet.activated && <p className={s.note}>Their wallet isn&apos;t on Stellar yet, so they can&apos;t add USDC, pay or be paid. Put it on Stellar to try again.</p>}

        <Card title="About them">
          <Facts
            items={[
              ["Last seen", u.lastSeenAt ? ago(u.lastSeenAt, now) : "Never"],
              ["Signed-in devices", String(u.sessions)],
              ["Wallet", u.wallet ? <AddressLink key="w" address={u.wallet.address} chain={u.chain} /> : "None yet"],
              ["USDC in the wallet", u.balance === null ? "—" : <Amount key="b" value={u.balance} />],
              ["Put on Stellar by", <TxLink key="a" hash={u.activationTx} chain={u.chain} />],
              ["Added to the wallet", <Amount key="d" value={u.deposited} />],
              ["Paid into pools", <Amount key="p" value={u.paid} />],
              ["Pools they're in", `${u.pools} (started ${u.created})`],
              ["Wrong passwords in a row", String(u.signInFailures)],
              ["User id", <span key="id" className={s.code}>{u.id}</span>],
            ]}
          />
        </Card>

        <Card title="Pools" sub="As lifeguard, approver or diver">
          {u.poolList.length ? (
            <div className={s.pools}>
              {u.poolList.map((p) => (
                <PoolCard key={p.id} pool={p} now={now} />
              ))}
            </div>
          ) : (
            <p className={s.empty}>Not in any pool yet.</p>
          )}
        </Card>

        <Card title="Payments" sub="Shares they paid from their wallet">
          <ContributionTable rows={u.contributionList} chain={u.chain} />
        </Card>
        <Card title="USDC added" sub="Deposits into their wallet">
          <DepositTable rows={u.depositList} chain={u.chain} />
        </Card>
        {u.payoutList.length > 0 && (
          <Card title="Payouts" sub="Their pools' USDC, paid to them">
            <PayoutTable rows={u.payoutList} chain={u.chain} />
          </Card>
        )}
        {u.refundList.length > 0 && (
          <Card title="Refunds" sub="USDC that came back to them">
            <RefundTable rows={u.refundList} chain={u.chain} />
          </Card>
        )}
        <Card title="Admin log" sub="What the team did to this account">
          <LogTable rows={u.log} empty="Nothing yet." />
        </Card>
      </main>

      <ReasonModal
        open={suspending}
        onClose={() => setSuspending(false)}
        title={`Suspend ${u.name}?`}
        confirm="Suspend"
        danger
        onConfirm={async (reason) => set(await adminApi.suspend(u.id, reason))}
      >
        They&apos;re signed out everywhere at once and can&apos;t sign in until you lift it. Pools they run and USDC owed to them carry on.
      </ReasonModal>
    </>
  );
}

export default function Page() {
  return <AdminShell>{() => <PersonPage />}</AdminShell>;
}
