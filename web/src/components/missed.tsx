"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { dayDate, fullDateTime } from "@/lib/format";
import { useAction, useNow } from "@/lib/hooks";
import { formatUsdc } from "@/lib/money";
import type { PoolDetail } from "@/lib/types";
import { Icon } from "./Icon";
import { useToast } from "./providers";
import { BusyButton, ErrorText, Modal } from "./ui";

/** Quick picks for the new deadline, in days after the current one (or today, once it has passed). */
const MORE_TIME: [string, number][] = [
  ["3 more days", 3],
  ["1 more week", 7],
  ["2 more weeks", 14],
];

function endOfDay(from: number, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return d;
}

/** The lifeguard gives the pool more time: a new deadline, as often as they need. */
export function ExtendModal({ open, onClose, pool, onExtended }: { open: boolean; onClose: () => void; pool: PoolDetail; onExtended: () => void }) {
  const toast = useToast();
  const extend = useAction(api.extendDeadline);
  const [choice, setChoice] = useState(1);
  const [picked, setPicked] = useState<Date | null>(null);
  const now = useNow(60_000);
  const from = Math.max(now, new Date(pool.deadline).getTime());
  const deadline = choice >= 0 ? endOfDay(from, MORE_TIME[choice][1]) : picked;
  const earliest = endOfDay(from, 1).toISOString().slice(0, 10);
  return (
    <Modal open={open} onClose={onClose} label="Give the pool more time">
      <div style={{ display: "grid", gap: 14 }}>
        <h2 className="t-h2">Give the pool more time</h2>
        <p className="muted t-small">
          Divers can pay again until the new deadline, and everyone in the pool is told. If it passes without the goal, you choose again.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {MORE_TIME.map(([label], i) => (
            <button key={label} type="button" className="chip" aria-pressed={choice === i} onClick={() => setChoice(i)}>
              {label}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field-label">Or pick a date</span>
          <input
            className="input"
            type="date"
            min={earliest}
            onChange={(e) => {
              if (!e.target.value) return;
              setPicked(endOfDay(new Date(`${e.target.value}T12:00:00`).getTime(), 0));
              setChoice(-1);
            }}
          />
        </label>
        {deadline && (
          <p className="note">
            <Icon name="cal" />
            <span>
              New deadline: <b>{fullDateTime(deadline.toISOString())}</b>
            </span>
          </p>
        )}
        <BusyButton
          busy={extend.busy}
          disabled={!deadline}
          className="btn btn-primary btn-block"
          onClick={async () => {
            if (!deadline) return;
            const done = await extend.run(pool.id, deadline.toISOString());
            if (done.ok) {
              onExtended();
              onClose();
              toast(`Deadline moved to ${dayDate(deadline.toISOString())}`, "📅");
            }
          }}
        >
          {deadline ? `Extend to ${dayDate(deadline.toISOString())}` : "Pick a new deadline"}
        </BusyButton>
        <ErrorText error={extend.error} />
      </div>
    </Modal>
  );
}

/** The lifeguard ends the pool: everyone who paid gets their money back now. */
export function RefundModal({ open, onClose, pool, onRefunded }: { open: boolean; onClose: () => void; pool: PoolDetail; onRefunded: () => void }) {
  const toast = useToast();
  const refund = useAction(api.refundDivers);
  const who = pool.paidCount === 1 ? "The 1 diver who paid gets" : `The ${pool.paidCount} divers who paid each get`;
  return (
    <Modal open={open} onClose={onClose} label="Refund the divers">
      <div style={{ display: "grid", gap: 14 }}>
        <h2 className="t-h2">Refund everyone who paid?</h2>
        <p className="muted t-small">
          {pool.paidCount > 0 ? `${who} their money back in their PoolFi balance` : "Nobody has paid in, so there is nothing to send back"}
          {pool.paidCount > 0 && pool.raised !== null ? `, ${formatUsdc(pool.raised)} in all.` : "."} The pool then closes for good. This
          can&apos;t be undone.
        </p>
        <BusyButton
          busy={refund.busy}
          className="btn btn-primary btn-block"
          onClick={async () => {
            const done = await refund.run(pool.id);
            if (done.ok) {
              onRefunded();
              onClose();
              toast(pool.paidCount > 0 ? "Refunds are on their way" : "Pool closed", "↩️");
            }
          }}
        >
          <Icon name="refresh" /> Refund and close the pool
        </BusyButton>
        <button className="btn btn-secondary btn-block" onClick={onClose} disabled={refund.busy}>
          Not now
        </button>
        <ErrorText error={refund.error} />
      </div>
    </Modal>
  );
}
