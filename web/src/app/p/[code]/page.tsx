"use client";

import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { Ripples } from "@/components/motion";
import { NamePickerRow } from "@/components/pool";
import { useSession } from "@/components/providers";
import { InviteShell } from "@/components/shells";
import { Avatar, BusyButton, ComingSoon, ErrorText, Loaded, Modal } from "@/components/ui";
import { DepositPanel, MethodButton } from "@/components/wallet";
import { api } from "@/lib/api";
import { countdown } from "@/lib/format";
import { useAction, useNow, useResource } from "@/lib/hooks";
import { formatAmount, formatUsdc } from "@/lib/money";
import type { InviteView, Wallet } from "@/lib/types";
import s from "./invite.module.css";

type Step = "method" | "confirm" | "topup" | "paying" | null;

/** "Confirming your payment…" stays up at least this long, so it doesn't just flash. */
const PAYING_MS = 1600;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Choosing a method, topping up and confirming a USDC payment from the PoolFi wallet. */
function PayFlow({ invite, payer, step, setStep }: { invite: InviteView; payer: { diverId: string } | { name: string }; step: Step; setStep: (s: Step) => void }) {
  const router = useRouter();
  const { user } = useSession();
  const [method, setMethod] = useState<"bank" | "usdc">("usdc");
  const [bank, setBank] = useState(false);
  const wallet = useResource<Wallet | null>(() => (user ? api.getWallet() : Promise.resolve(null)), [user?.id, step]);
  const pay = useAction(api.payShare);
  const share = invite.pool.share;
  const balance = wallet.data?.balance ?? 0;
  const payerName = "diverId" in payer ? (invite.names.find((n) => n.id === payer.diverId)?.name ?? "") : payer.name;

  function signInToPay() {
    const back = `/p/${invite.pool.code}?${new URLSearchParams("diverId" in payer ? { as: payer.diverId } : { name: payer.name })}`;
    router.push(`/?next=${encodeURIComponent(back)}`);
  }

  async function confirm() {
    setStep("paying");
    const [done] = await Promise.all([pay.run(invite.pool.code, payer), wait(PAYING_MS)]);
    if (!done.ok) return setStep("confirm");
    const q = new URLSearchParams({ ref: done.value.receiptRef, pool: done.value.poolId, badges: done.value.badges.join("|") });
    router.push(`/p/${invite.pool.code}/paid?${q}`);
  }

  if (bank) {
    return (
      <ComingSoon open onClose={() => setBank(false)} title="Bank transfer is coming soon">
        Paying from a Nigerian bank app is on the way. For now, pay with USDC from your PoolFi wallet.
      </ComingSoon>
    );
  }

  return (
    <Modal open={step !== null} onClose={() => step !== "paying" && setStep(null)} label="Pay your share">
      {step === "paying" && (
        <div className="cs-in" role="status" style={{ display: "grid", justifyItems: "center", gap: 6, padding: "24px 0", textAlign: "center" }}>
          <Ripples />
          <h2 className="t-h2" style={{ marginTop: 16 }}>Confirming your payment…</h2>
          <p className="muted t-small">Hang tight. This usually takes a few seconds.</p>
        </div>
      )}
      {step === "method" && (
        <div className="cs-in" style={{ display: "grid", gap: 12 }}>
          <h2 className="t-h2">How do you want to pay?</h2>
          <p className="muted t-small" style={{ marginBottom: 4 }}>
            {formatUsdc(share)} into {invite.pool.name} as {payerName}
          </p>
          <MethodButton icon={<Icon name="bank" />} title="Bank transfer" detail="From any Nigerian bank app" badge="Coming soon" selected={method === "bank"} onClick={() => setMethod("bank")} />
          <MethodButton
            icon={<Image src="/usdc.webp" alt="" width={28} height={28} />}
            title="USDC"
            detail={user ? `From your PoolFi wallet, balance ${formatAmount(balance)}` : "From your PoolFi wallet. Sign in first"}
            right={`${formatAmount(share)} USDC`}
            selected={method === "usdc"}
            onClick={() => setMethod("usdc")}
          />
          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 6 }}
            onClick={() => {
              if (method === "bank") return setBank(true);
              if (!user) return signInToPay();
              setStep(balance >= share ? "confirm" : "topup");
            }}
            disabled={method === "usdc" && Boolean(user) && wallet.loading}
          >
            {method === "usdc" && !user ? "Sign in to pay" : "Continue"}
          </button>
        </div>
      )}

      {step === "topup" && wallet.data && (
        <div className="cs-in" style={{ display: "grid", gap: 12 }}>
          <button className="btn btn-ghost" style={{ justifySelf: "start", padding: 0 }} onClick={() => setStep("method")}>
            <Icon name="back" />
          </button>
          <h2 className="t-h2">Top up your USDC wallet</h2>
          <p className="muted t-small">
            You have {formatUsdc(balance)}. Add at least {formatUsdc(Math.max(0, share - balance))} to pay {formatUsdc(share)}.
          </p>
          <DepositPanel wallet={wallet.data} onDeposited={(w) => wallet.set(w)} />
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              if (balance >= share) setStep("confirm");
              else wallet.reload();
            }}
          >
            {balance >= share ? "Continue to pay" : "I've sent it"}
          </button>
          {!wallet.loading && balance < share && (
            <p className="t-caption muted" style={{ textAlign: "center" }}>
              We check your wallet each time you tap. Deposits usually land within a few seconds.
            </p>
          )}
        </div>
      )}

      {step === "confirm" && (
        <div className="cs-in" style={{ display: "grid", gap: 14 }}>
          <button className="btn btn-ghost" style={{ justifySelf: "start", padding: 0 }} onClick={() => setStep("method")}>
            <Icon name="back" />
          </button>
          <div className={s.bigCoin}>
            <Image src="/usdc.webp" alt="" width={72} height={72} className="bounce" />
            <h2 className="t-h2">Pay {formatUsdc(share)}</h2>
            <p className="muted t-small">
              into {invite.pool.emoji} {invite.pool.name} as {payerName}
            </p>
          </div>
          <div className={s.rows}>
            <div>
              <span>From</span>
              <span>Your PoolFi wallet</span>
            </div>
            <div>
              <span>Balance</span>
              <span>{formatUsdc(balance)}</span>
            </div>
            <div>
              <span>Network fee</span>
              <span>Paid by PoolFi</span>
            </div>
            <div>
              <span>Total</span>
              <span>{formatUsdc(share)}</span>
            </div>
          </div>
          <BusyButton busy={pay.busy} className="btn btn-primary btn-block" onClick={confirm}>
            Pay {formatUsdc(share)}
          </BusyButton>
          <ErrorText error={pay.error} />
        </div>
      )}
    </Modal>
  );
}

function Invite() {
  const { code } = useParams<{ code: string }>();
  const params = useSearchParams();
  const now = useNow(1000);
  const invite = useResource(() => api.getInvite(code), [code]);
  const [q, setQ] = useState("");
  const [diverId, setDiverId] = useState<string | null>(params.get("as"));
  const [notOnList, setNotOnList] = useState(Boolean(params.get("name")));
  const [name, setName] = useState(params.get("name") ?? "");
  const [step, setStep] = useState<Step>(params.get("as") || params.get("name") ? "method" : null);

  return (
    <Loaded resource={invite}>
      {(inv) => <InviteBody inv={inv} {...{ now, q, setQ, diverId, setDiverId, notOnList, setNotOnList, name, setName, step, setStep }} />}
    </Loaded>
  );
}

function InviteBody({
  inv, now, q, setQ, diverId, setDiverId, notOnList, setNotOnList, name, setName, step, setStep,
}: {
  inv: InviteView; now: number; q: string; setQ: (v: string) => void; diverId: string | null; setDiverId: (v: string | null) => void;
  notOnList: boolean; setNotOnList: (v: boolean) => void; name: string; setName: (v: string) => void; step: Step; setStep: (s: Step) => void;
}) {
  const p = inv.pool;
  const firstName = inv.lifeguard.name.split(" ")[0];
  const left = countdown(p.deadline, now);
  const pct = p.progress;
  const open = p.status === "active" || p.status === "met";
  // Everyone on the list, still to pay first, then who has paid; a search narrows it.
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? inv.names.filter((n) => n.name.toLowerCase().includes(needle)) : inv.names;
    return [...list].sort((a, b) => Number(a.paid) - Number(b.paid));
  }, [inv.names, q]);
  const chosen = inv.names.find((n) => n.id === diverId);
  const payer = notOnList || !p.pickYourName ? (name.trim() ? { name: name.trim() } : null) : chosen ? { diverId: chosen.id } : null;
  const payerFirst = notOnList || !p.pickYourName ? name.trim().split(" ")[0] : chosen?.name.split(" ")[0];

  return (
    <InviteShell
      left={
        <>
          <div className="bounce" style={{ alignSelf: "flex-start" }}>
            <Avatar name={inv.lifeguard.name} avatar={inv.lifeguard.avatar} size={60} />
          </div>
          <p className={`${s.invitedBy} rise`} style={{ animationDelay: "80ms" }}>{firstName} invited you to</p>
          <h1 className={`${s.poolTitle} rise`} style={{ animationDelay: "160ms" }}>
            <span aria-hidden="true">{p.emoji}</span> {p.name}
          </h1>
          <p className={`${s.invitedBy} rise`} style={{ animationDelay: "240ms" }}>
            {p.paidCount} of {p.expectedCount} have paid
          </p>
        </>
      }
    >
      <div className={s.column}>
        <section className={`${s.share} rise`} aria-label="Your share">
          <span className="muted t-small">Your share</span>
          <span className={s.shareAmount}>
            {formatAmount(p.share)}
            <span className="unit">USDC</span>
          </span>
          {left && open && <span className={`${s.closes} hide-m`}>Closes in {left}</span>}
          <div className="fill-bar hide-m" style={{ width: "100%" }}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="t-caption muted">{pct}% of the goal reached</span>
        </section>

        {!open ? (
          <p className={s.closed}>
            {p.status === "refunded"
              ? "This pool closed before reaching its goal, so everyone who paid was refunded."
              : p.status === "missed"
                ? `This pool's deadline passed before its goal. Payments are paused until ${firstName} gives it more time or refunds everyone.`
                : p.status === "approval"
                ? "This pool reached its goal and its payout is being approved. Payments are paused."
                : "This pool is closed."}
          </p>
        ) : (
          <>
            <section className={`${s.find} rise`} style={{ animationDelay: "80ms" }} aria-label="Find your name">
              {p.pickYourName && !notOnList ? (
                <>
                  <h2 className="t-h2" style={{ fontSize: 18 }}>Find your name</h2>
                  <p className="t-small muted hide-m">{firstName} added the group. Tap your name so your payment is matched to you.</p>
                  <label className="field">
                    <span className="field-label">Search names</span>
                    <input className="input" placeholder="Type your name" value={q} onChange={(e) => setQ(e.target.value)} />
                  </label>
                  <div key={q.trim() ? "search" : "list"} className="cs-in">
                    {matches.map((n) => (
                      <NamePickerRow key={n.id} name={n.name} paid={n.paid} selected={diverId === n.id} onSelect={() => setDiverId(n.id)} />
                    ))}
                    {!matches.length && <p className="t-small muted">No one by that name. Check the spelling, or tell us your name below.</p>}
                  </div>
                  {p.allowNotOnList && (
                    <button type="button" className={s.notOnList} onClick={() => setNotOnList(true)}>
                      I&apos;m not on this list
                    </button>
                  )}
                </>
              ) : (
                <>
                  <h2 className="t-h2" style={{ fontSize: 18 }}>What&apos;s your name?</h2>
                  <p className="t-small muted">So {firstName} knows who paid.</p>
                  <input className="input" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                  {p.pickYourName && (
                    <button type="button" className={s.notOnList} onClick={() => setNotOnList(false)}>
                      Find my name on the list instead
                    </button>
                  )}
                </>
              )}
            </section>

            <div className={`${s.trust} rise`} style={{ animationDelay: "160ms" }}>
              <div className={s.trustRow}>
                <span className={s.trustIcon}><Icon name="lock" /></span>
                Held safely until the goal is met. Not in anyone&apos;s personal account.
              </div>
              <div className={s.trustRow}>
                <span className={s.trustIcon}><Icon name={p.approverCount ? "key" : "users"} /></span>
                {p.approverCount ? `${p.approverCount} approvers confirm the payout with the lifeguard.` : "Everyone can see who has paid and when the payout happens."}
              </div>
              <div className={s.trustRow}>
                <span className={s.trustIcon}><Icon name="refresh" /></span>
                If the goal isn&apos;t met in time, {firstName} gives the pool more time or refunds everyone.
              </div>
            </div>

            <div className={s.payFoot}>
              <button className="btn btn-primary btn-block" disabled={!payer} onClick={() => setStep("method")}>
                {payer ? `Pay ${formatUsdc(p.share)} as ${payerFirst}` : `Pay ${formatUsdc(p.share)}`}
              </button>
              <p className={s.payNote}>Pay with USDC, or by bank transfer soon</p>
            </div>
          </>
        )}
      </div>
      {payer && <PayFlow invite={inv} payer={payer} step={step} setStep={setStep} />}
    </InviteShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Invite />
    </Suspense>
  );
}
