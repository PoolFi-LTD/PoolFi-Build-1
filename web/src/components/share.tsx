"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { formatUsdc } from "@/lib/money";
import { Icon } from "./Icon";
import { flyPlane } from "./motion";
import { useToast } from "./providers";
import { BusyButton, CopyField, ErrorText, Modal, QrCode } from "./ui";

export function inviteUrl(code: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin}/p/${code}`;
}

export function whatsappUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** The invite link, as a copy box, a QR code and a WhatsApp message. */
export function ShareModal({ open, onClose, pool, title = "Share the link" }: { open: boolean; onClose: () => void; pool: { code: string; name: string; emoji: string; share: number }; title?: string }) {
  const toast = useToast();
  const url = inviteUrl(pool.code);
  const message = `Hey everyone 👋 Please pay your ${formatUsdc(pool.share)} for ${pool.emoji} ${pool.name} here: ${url}`;
  return (
    <Modal open={open} onClose={onClose} label={title}>
      <div style={{ display: "grid", gap: 14, justifyItems: "center", textAlign: "center" }}>
        <h2 className="t-h2" style={{ padding: "0 36px" }}>{title}</h2>
        <p className="muted t-small">Anyone with the link can see the pool and pay their share.</p>
        <QrCode value={url} size={150} />
        <div style={{ width: "100%" }}>
          <CopyField value={url} display={url.replace(/^https?:\/\//, "")} onCopied={() => toast("Link copied", "🔗")} />
        </div>
        <a className="btn btn-success btn-block" href={whatsappUrl(message)} target="_blank" rel="noreferrer">
          <Icon name="wa" /> Share on WhatsApp
        </a>
        <p className="t-caption muted">Pool ID {pool.code}</p>
      </div>
    </Modal>
  );
}

/** Reminds everyone who hasn't paid, then offers the message to send on WhatsApp. */
export function RemindModal({ open, onClose, poolId, unpaid, onReminded }: { open: boolean; onClose: () => void; poolId: string; unpaid: number; onReminded: () => void }) {
  const toast = useToast();
  const remind = useAction(api.remindUnpaid);
  const [message, setMessage] = useState<string | null>(null);
  const close = () => {
    setMessage(null);
    onClose();
  };
  return (
    <Modal open={open} onClose={close} label="Remind divers">
      <div style={{ display: "grid", gap: 14 }}>
        <h2 className="t-h2">Remind {unpaid} divers</h2>
        {message ? (
          <div className="cs-in" style={{ display: "grid", gap: 14 }}>
            <p className="muted t-small">They&apos;ll see a reminder in PoolFi. Send it to the group too:</p>
            <div style={{ padding: 14, borderRadius: 14, background: "var(--bg)", fontSize: 14, whiteSpace: "pre-wrap" }}>{message}</div>
            <a className="btn btn-success btn-block" href={whatsappUrl(message)} target="_blank" rel="noreferrer">
              <Icon name="wa" /> Send on WhatsApp
            </a>
            <button
              className="btn btn-secondary btn-block"
              onClick={async () => {
                await navigator.clipboard.writeText(message).catch(() => {});
                toast("Message copied", "📋");
              }}
            >
              <Icon name="copy" /> Copy message
            </button>
          </div>
        ) : (
          <>
            <p className="muted t-small">Only people who joined but haven&apos;t paid get reminded. Nobody who has paid is bothered.</p>
            <BusyButton
              busy={remind.busy}
              className="btn btn-primary btn-block"
              onClick={async (e) => {
                const button = e.currentTarget;
                const done = await remind.run(poolId);
                if (done.ok) {
                  // The reminders fly off like a paper plane.
                  flyPlane(button);
                  setMessage(done.value.message);
                  onReminded();
                  toast(`${done.value.count} divers reminded`, "🔔");
                }
              }}
            >
              <Icon name="bell" /> Remind {unpaid} divers
            </BusyButton>
            <ErrorText error={remind.error} />
          </>
        )}
      </div>
    </Modal>
  );
}
