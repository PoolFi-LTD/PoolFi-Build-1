"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import s from "@/components/admin/admin.module.css";
import { Amount, Card, Facts, Hero, Kpis, Person, Pill, PoolStatusPill, ReasonModal, TxLink, useAdminAction } from "@/components/admin/parts";
import { ContributionTable, LogTable, PayoutTable, RefundTable } from "@/components/admin/tables";
import { useToast } from "@/components/providers";
import { Loaded } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { ago, dateTime, fullDateTime } from "@/lib/format";
import { useNow, useResource } from "@/lib/hooks";
import { formatUsdc } from "@/lib/money";
import type { AdminPoolDetail } from "@/lib/types";

const LEDGER_STATUS: Record<AdminPoolDetail["ledger"]["status"], string> = {
  open: "Open: taking payments",
  funded: "Funded: goal reached",
  settled: "Settled: paid out",
  refunded: "Cancelled: refunding",
  expired: "Expired: waiting for the lifeguard",
};

const TX: Record<AdminPoolDetail["transactions"][number]["kind"], string> = {
  created: "Pool created",
  joined: "Joined",
  contributed: "Paid in",
  extended: "Deadline moved",
  payout_requested: "Payout requested",
  voted: "Approver voted",
  paid_out: "Paid out",
  refunded: "Refunded",
};

/** A datetime-local value, in this browser's time zone. */
function localInput(at: number): string {
  const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

function PoolPage() {
  const { id } = useParams<{ id: string }>();
  const pool = useResource(() => adminApi.pool(id), [id]);
  return <Loaded resource={pool}>{(p) => <PoolBody p={p} set={pool.set} />}</Loaded>;
}

function PoolBody({ p, set }: { p: AdminPoolDetail; set: (p: AdminPoolDetail) => void }) {
  const toast = useToast();
  const { run, busy } = useAdminAction();
  const [extending, setExtending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [deadline, setDeadline] = useState(() => localInput(Math.max(Date.now(), new Date(p.deadline).getTime()) + 7 * 86_400_000));
  const canExtend = p.status === "active" || p.status === "missed";
  const canClose = p.status !== "paidout" && p.status !== "refunded";
  const refundsLeft = p.ledger.status === "refunded" && !p.refundsFinishedAt;
  const pct = p.goal > 0 ? Math.round((p.raised / p.goal) * 100) : 0;
  const now = useNow();

  return (
    <>
      <Hero
        title={
          <>
            {p.emoji} {p.name}
          </>
        }
        sub={`${p.code} · ${p.type} · started ${fullDateTime(p.createdAt)} · lifeguard ${p.lifeguard.name}`}
        actions={
          <>
            <Link href={`/p/${p.code}`} target="_blank" className={`${s.heroBtn} ${s.heroBtnGhost}`}>
              Open invite page
            </Link>
            {canExtend && (
              <button type="button" className={s.heroBtn} onClick={() => setExtending(true)}>
                Give more time
              </button>
            )}
            {refundsLeft && (
              <button
                type="button"
                className={s.heroBtn}
                disabled={busy !== null}
                onClick={() =>
                  run("refunds", () => adminApi.retryRefunds(p.id), (x) => (x.refundsFinishedAt ? "Everyone has been refunded" : "Some refunds are still left: the refund job keeps trying")).then(
                    (x) => x && set(x),
                  )
                }
              >
                {busy === "refunds" ? "Sending…" : "Send the refunds left"}
              </button>
            )}
            {canClose && (
              <button type="button" className={`${s.heroBtn} ${s.heroBtnDanger}`} onClick={() => setClosing(true)}>
                Close and refund
              </button>
            )}
          </>
        }
      >
        <div style={{ marginTop: 12 }}>
          <PoolStatusPill status={p.status} />
        </div>
        <Kpis
          items={[
            { label: "Raised", value: formatUsdc(p.raised), note: `${pct}% of ${formatUsdc(p.goal)}` },
            { label: "Paid", value: `${p.paidCount} of ${p.expectedCount}`, note: `${formatUsdc(p.share)} each` },
            { label: "Deadline", value: new Date(p.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" }), note: new Date(p.deadline).getTime() < now ? `passed ${ago(p.deadline, now)}` : dateTime(p.deadline) },
            { label: "Approvers", value: String(p.approvers), note: p.approvers ? "a majority must approve the payout" : "paid out straight away" },
            { label: "PoolFi fee", value: `${p.feeBps / 100}%`, note: p.feeCovered ? "divers cover it" : "taken from the payout" },
            { label: "Refunded", value: formatUsdc(p.refunded), note: p.refundsFinishedAt ? `finished ${dateTime(p.refundsFinishedAt)}` : refundsLeft ? "some still to send" : "to people who paid" },
          ]}
        />
      </Hero>

      <main className={s.main}>
        {p.status === "missed" && (
          <p className={s.note}>
            The deadline passed below the goal{p.missedNotifiedAt ? ` and the lifeguard was asked ${ago(p.missedNotifiedAt, now)}` : ""}. Nothing moves until they (or you) give it more time or refund
            everyone.
          </p>
        )}
        <div className={s.split}>
          <div className={s.col}>
            <Card title="People in the pool" sub={`${p.divers.length} on the list · contacts are only shown to the lifeguard and the team`}>
              {p.divers.length ? (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Contact</th>
                        <th className={s.r}>Paid</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.divers.map((d) => (
                        <tr key={d.id}>
                          <td>
                            {d.userId ? <Link href={`/admin/users/${encodeURIComponent(d.userId)}`}>{d.name}</Link> : d.name}
                            {!d.onList && <span className={s.small}>Joined by link</span>}
                          </td>
                          <td>{d.contact ?? <span className="muted">—</span>}</td>
                          <td className={s.r}>{d.paid ? <Amount value={d.amount} /> : "—"}</td>
                          <td>
                            {d.paid ? <Pill tone="green">Paid</Pill> : <Pill tone="amber">Not paid</Pill>}
                            {d.paidAt && <span className={s.small}>{dateTime(d.paidAt)}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={s.empty}>Nobody on the list yet.</p>
              )}
            </Card>
            <Card title="Payments" sub="Shares paid into this pool">
              <ContributionTable rows={p.contributionList} chain={p.chain} showPool={false} />
            </Card>
            {p.payoutList.length > 0 && (
              <Card title="Payout" sub="The pool's USDC, paid to the lifeguard">
                <PayoutTable rows={p.payoutList} chain={p.chain} showPool={false} />
              </Card>
            )}
            {p.refundList.length > 0 && (
              <Card title="Refunds" sub="USDC sent back to everyone who paid">
                <RefundTable rows={p.refundList} chain={p.chain} showPool={false} />
              </Card>
            )}
            <Card title="Transactions" sub="Every transaction PoolFi sent the contract for this pool, oldest first">
              {p.transactions.length ? (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>What</th>
                        <th>Who</th>
                        <th className={s.r}>Amount</th>
                        <th>Transaction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.transactions.map((t) => (
                        <tr key={`${t.kind}-${t.hash}`}>
                          <td className={s.num}>{dateTime(t.at)}</td>
                          <td>{TX[t.kind]}</td>
                          <td>{t.user ? t.user.name : "—"}</td>
                          <td className={s.r}>{t.amount === null ? "—" : <Amount value={t.amount} />}</td>
                          <td>
                            <TxLink hash={t.hash} chain={p.chain} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={s.empty}>No transactions.</p>
              )}
            </Card>
          </div>

          <div className={s.col}>
            <Card title="What the contract says" sub="The contract holding the USDC decides the pool's real state">
              <Facts
                items={[
                  ["State", LEDGER_STATUS[p.ledger.status]],
                  ["Paid in", <Amount key="in" value={p.ledger.contributed} />],
                  ["Refunded", <Amount key="out" value={p.ledger.refunded} />],
                  ["Goal", <Amount key="goal" value={p.ledger.goal} />],
                  ["Members", String(p.ledger.members)],
                  ["Deadline", fullDateTime(p.ledger.deadline)],
                  ["Contract pool", `#${p.chainPoolId} on ${p.chain.network}`],
                ]}
              />
            </Card>
            <Card title="Lifeguard">
              <Person person={p.lifeguard} />
            </Card>
            {p.approverList.length > 0 && (
              <Card title="Approvers" sub={p.payout && !p.payout.paidAt ? `${p.payout.approvals} of ${p.payout.needed} approvals so far` : "A majority must approve the payout"}>
                <div style={{ display: "grid", gap: 10 }}>
                  {p.approverList.map((a) => (
                    <div key={a.user.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <Person person={a.user} />
                      {a.vote === "approved" ? <Pill tone="green">Approved</Pill> : a.vote === "declined" ? <Pill tone="red">Declined</Pill> : <Pill tone="grey">No vote</Pill>}
                    </div>
                  ))}
                </div>
              </Card>
            )}
            <Card title="Settings">
              <Facts
                items={[
                  ["Divers pick their name", p.settings.pickYourName ? "Yes" : "No"],
                  ["People not on the list can pay", p.settings.allowNotOnList ? "Yes" : "No"],
                  ["Divers can share the link", p.settings.diversCanShare ? "Yes" : "No"],
                  ["Divers see each other's payments", p.settings.diversSeePayments ? "Yes" : "No"],
                ]}
              />
              {p.description && <p className="muted" style={{ margin: "12px 0 0" }}>{p.description}</p>}
            </Card>
            <Card title="Activity">
              {p.activity.length ? (
                <ul className={s.feed}>
                  {p.activity.map((a) => (
                    <li key={a.id}>
                      <span className={s.feedIcon} aria-hidden="true">
                        •
                      </span>
                      <div>
                        {a.title}
                        <small>
                          {a.amount !== null && `${formatUsdc(a.amount)} · `}
                          {ago(a.at, now)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={s.empty}>Nothing yet.</p>
              )}
            </Card>
            <Card title="Admin log" sub="What the team did to this pool">
              <LogTable rows={p.log} empty="Nothing yet." />
            </Card>
          </div>
        </div>
      </main>

      <ReasonModal
        open={extending}
        onClose={() => setExtending(false)}
        title="Give the pool more time"
        confirm="Move the deadline"
        optional
        extra={
          <label className="field">
            <span className="field-label">New deadline</span>
            <input className="input" type="datetime-local" value={deadline} min={localInput(now + 5 * 60_000)} onChange={(e) => setDeadline(e.target.value)} />
          </label>
        }
        onConfirm={async (reason) => {
          set(await adminApi.extendPool(p.id, new Date(deadline).toISOString(), reason));
          toast("Deadline moved", "📅");
        }}
      >
        Signed with the lifeguard&apos;s wallet. Everyone in the pool is told; a pool whose deadline passed takes payments again until the new one.
      </ReasonModal>
      <ReasonModal
        open={closing}
        onClose={() => setClosing(false)}
        title={`Close ${p.name}?`}
        confirm="Close and refund everyone"
        danger
        onConfirm={async (reason) => {
          set(await adminApi.closePool(p.id, reason));
          toast("Pool closed. Refunds are on their way", "↩️");
        }}
      >
        The contract cancels the pool (signed with the lifeguard&apos;s wallet), any payout waiting for approvers is dropped, and everyone who paid ({formatUsdc(p.raised)} in all) gets their USDC back. This can&apos;t be undone.
      </ReasonModal>
    </>
  );
}

export default function Page() {
  return <AdminShell>{() => <PoolPage />}</AdminShell>;
}
