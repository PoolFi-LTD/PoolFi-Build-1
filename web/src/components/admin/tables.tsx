"use client";

import Link from "next/link";
import { actionSentence } from "@/lib/admin-text";
import { dateTime } from "@/lib/format";
import type { AdminAction, AdminChain, AdminContribution, AdminDeposit, AdminPayout, AdminRefund } from "@/lib/types";
import s from "./admin.module.css";
import { AddressLink, Amount, Person, Pill, PoolLink, TxLink, actionHref } from "./parts";

function Empty({ children }: { children: string }) {
  return <p className={s.empty}>{children}</p>;
}

/** Paid-out pools: what each lifeguard got, and the transaction that paid them. */
export function PayoutTable({ rows, chain, showPool = true }: { rows: AdminPayout[]; chain: AdminChain; showPool?: boolean }) {
  if (rows.length === 0) return <Empty>No payouts yet.</Empty>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {showPool && <th>Pool</th>}
            <th>Lifeguard</th>
            <th className={s.r}>Paid out</th>
            <th>To</th>
            <th>When</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              {showPool && (
                <td>
                  <PoolLink pool={p.pool} />
                </td>
              )}
              <td>
                <Person person={p.lifeguard} />
              </td>
              <td className={s.r}>
                <b>
                  <Amount value={p.net} />
                </b>
                <span className={s.small}>
                  of <Amount value={p.gross} />, fee <Amount value={p.fee} />
                </span>
              </td>
              <td>
                {p.destination === "bank" ? <Pill tone="amber">Bank (coming soon)</Pill> : <Pill tone="green">Their wallet</Pill>}
                {p.reference && <span className={s.small}>Ref {p.reference}</span>}
              </td>
              <td className={s.num}>{dateTime(p.paidAt)}</td>
              <td>
                <TxLink hash={p.txHash} chain={chain} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** USDC sent back from cancelled pools. */
export function RefundTable({ rows, chain, showPool = true }: { rows: AdminRefund[]; chain: AdminChain; showPool?: boolean }) {
  if (rows.length === 0) return <Empty>No refunds.</Empty>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {showPool && <th>Pool</th>}
            <th>To</th>
            <th className={s.r}>Amount</th>
            <th>When</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {showPool && (
                <td>
                  <PoolLink pool={r.pool} />
                </td>
              )}
              <td>
                {r.user ? (
                  <Person person={r.user} />
                ) : (
                  <span>
                    Outside wallet <AddressLink address={r.wallet} chain={chain} />
                  </span>
                )}
              </td>
              <td className={s.r}>
                <b>
                  <Amount value={r.amount} />
                </b>
              </td>
              <td className={s.num}>{dateTime(r.at)}</td>
              <td>
                <TxLink hash={r.txHash} chain={chain} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shares paid into pools from people's wallets. */
export function ContributionTable({ rows, chain, showPool = true }: { rows: AdminContribution[]; chain: AdminChain; showPool?: boolean }) {
  if (rows.length === 0) return <Empty>No payments yet.</Empty>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {showPool && <th>Pool</th>}
            <th>Paid by</th>
            <th className={s.r}>Amount</th>
            <th>When</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              {showPool && (
                <td>
                  <PoolLink pool={c.pool} />
                </td>
              )}
              <td>
                <Person person={c.user} note={c.receiptRef ? `Receipt ${c.receiptRef}` : undefined} />
              </td>
              <td className={s.r}>
                <b>
                  <Amount value={c.amount} />
                </b>
              </td>
              <td className={s.num}>{dateTime(c.at)}</td>
              <td>
                <TxLink hash={c.txHash} chain={chain} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** USDC added to wallets. */
export function DepositTable({ rows, chain }: { rows: AdminDeposit[]; chain: AdminChain }) {
  if (rows.length === 0) return <Empty>No deposits yet.</Empty>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Who</th>
            <th className={s.r}>Amount</th>
            <th>From</th>
            <th>When</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>
                <Person person={d.user} />
              </td>
              <td className={s.r}>
                <b>
                  <Amount value={d.amount} />
                </b>
              </td>
              <td>{d.provider === "testnet-treasury" ? "Testnet treasury" : d.provider}</td>
              <td className={s.num}>{dateTime(d.at)}</td>
              <td>
                <TxLink hash={d.txHash} chain={chain} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the team did, newest first. */
export function LogTable({ rows, empty = "Nothing done from the dashboard yet." }: { rows: AdminAction[]; empty?: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const href = actionHref(a);
            const what = actionSentence(a.action, a.target.label);
            return (
              <tr key={a.id}>
                <td className={s.num}>{dateTime(a.at)}</td>
                <td>{a.admin.email}</td>
                <td>{href ? <Link href={href}>{what}</Link> : what}</td>
                <td>{a.reason ?? <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
