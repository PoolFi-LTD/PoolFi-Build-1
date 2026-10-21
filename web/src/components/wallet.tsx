"use client";

import Image from "next/image";
import { useState } from "react";
import { api } from "@/lib/api";
import { shortAddress } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { sound } from "@/lib/sound";
import type { Wallet } from "@/lib/types";
import { Icon } from "./Icon";
import { useToast } from "./providers";
import { BusyButton, ComingSoon, CopyField, ErrorText, Modal, QrCode } from "./ui";

/** Testnet builds can add test USDC straight from PoolFi's treasury. */
export const IS_TESTNET = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet") === "testnet";
const TEST_DEPOSIT = 10;

/** The wallet's Stellar address as a QR code and a copy box, plus test USDC on testnet. */
export function DepositPanel({ wallet, onDeposited, note }: { wallet: Wallet; onDeposited: (w: Wallet) => void; note?: string }) {
  const toast = useToast();
  const deposit = useAction(api.depositTestUsdc);
  return (
    <div style={{ display: "grid", gap: 14, justifyItems: "center" }}>
      <QrCode value={wallet.address} />
      <div style={{ width: "100%" }}>
        <CopyField value={wallet.address} display={shortAddress(wallet.address)} onCopied={() => toast("Address copied", "📋")} />
      </div>
      <p className="banner banner-amber" style={{ width: "100%", fontSize: 13 }}>
        {note ?? `Only send USDC on ${wallet.network} to this address. It's your own PoolFi wallet.`}
      </p>
      {IS_TESTNET && (
        <BusyButton
          busy={deposit.busy}
          className="btn btn-secondary btn-block"
          onClick={async () => {
            const done = await deposit.run(TEST_DEPOSIT);
            if (done.ok) {
              onDeposited(done.value);
              sound.win();
              toast(`${TEST_DEPOSIT} test USDC added`, "🪙");
            }
          }}
        >
          Add {TEST_DEPOSIT} test USDC
        </BusyButton>
      )}
      <ErrorText error={deposit.error} />
    </div>
  );
}

/** "Add funds": USDC on Stellar now, Naira later. */
export function AddFundsModal({ open, onClose, wallet, onDeposited }: { open: boolean; onClose: () => void; wallet: Wallet | undefined; onDeposited: (w: Wallet) => void }) {
  const [step, setStep] = useState<"choose" | "usdc">("choose");
  const [naira, setNaira] = useState(false);
  const close = () => {
    setStep("choose");
    onClose();
  };
  // Forward slides in from the right, back from the left.
  const slide = step === "usdc" ? "cs-in" : "cs-back";
  if (naira) return <ComingSoon open onClose={() => setNaira(false)} title="Naira deposits are coming soon" />;
  return (
    <Modal open={open} onClose={close} label="Add funds">
      {step === "choose" || !wallet ? (
        <div key="choose" className={slide} style={{ display: "grid", gap: 12 }}>
          <h2 className="t-h2">Add funds</h2>
          <p className="muted t-small" style={{ marginBottom: 6 }}>Top up your PoolFi wallet to pay into pools.</p>
          <MethodButton icon={<Image src="/usdc.webp" alt="" width={28} height={28} />} title="USDC" detail={`Send USDC on ${wallet?.network ?? "Stellar"}`} onClick={() => setStep("usdc")} disabled={!wallet} />
          <MethodButton icon={<Icon name="bank" />} title="Bank transfer" detail="From any Nigerian bank app" onClick={() => setNaira(true)} badge="Coming soon" />
        </div>
      ) : (
        <div key="usdc" className={slide} style={{ display: "grid", gap: 14 }}>
          <button className="btn btn-ghost" style={{ justifySelf: "start", padding: 0 }} onClick={() => setStep("choose")}>
            <Icon name="back" /> Back
          </button>
          <h2 className="t-h2">Deposit USDC</h2>
          <p className="muted t-small">Send USDC to your PoolFi wallet. It shows up here in a few seconds.</p>
          <DepositPanel wallet={wallet} onDeposited={onDeposited} />
        </div>
      )}
    </Modal>
  );
}

export function MethodButton({ icon, title, detail, right, onClick, selected, disabled, badge }: { icon: React.ReactNode; title: string; detail: string; right?: React.ReactNode; onClick: () => void; selected?: boolean; disabled?: boolean; badge?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className="method"
      data-sound="pick"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        padding: "14px 16px",
        border: `2px solid ${selected ? "var(--blue)" : "var(--line)"}`,
        borderRadius: 16,
        background: selected ? "var(--blue-50)" : "var(--white)",
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 12, background: "var(--bg)", color: "var(--slate)", flex: "none" }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 16 }}>{title}</span>
        <span style={{ display: "block", color: "var(--slate)", fontSize: 13 }}>{detail}</span>
      </span>
      {badge && <span className="pill pill-blue">{badge}</span>}
      {right && <span style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>{right}</span>}
    </button>
  );
}
