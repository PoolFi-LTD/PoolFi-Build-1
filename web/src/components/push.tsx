"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useToast } from "./providers";
import { Toggle } from "./ui";
import { api } from "@/lib/api";
import { messageOf } from "@/lib/errors";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";

const EXPLAIN: Record<PushState, string> = {
  on: "This device shows PoolFi notifications, even when the app is closed.",
  off: "Payments, approvals and payouts pop up on this device, even when PoolFi is closed.",
  blocked: "Blocked in this browser. Allow notifications for this site in the browser's settings, then come back.",
  "needs-install": "On iPhone: tap Share, then Add to Home Screen, and open PoolFi from your Home Screen. Then turn this on.",
  unsupported: "This browser can't show notifications. Try Chrome, Edge, Firefox or Safari.",
};

/** This device's notification state, kept current. */
export function usePushState(): [PushState | null, (s: PushState) => void] {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    let alive = true;
    pushState().then((s) => alive && setState(s), () => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);
  return [state, setState];
}

/** Turning device notifications on or off, with a test notification once they're on. */
export function usePushSwitch() {
  const toast = useToast();
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  async function set(on: boolean) {
    setBusy(true);
    try {
      const next = on ? await enablePush() : await disablePush();
      setState(next);
      if (on && next === "on") {
        const sent = await api.sendTestPush().catch(() => 0);
        toast(sent ? "Notifications on. We sent a test." : "Notifications on", "🔔");
      } else if (on && next === "blocked") {
        toast("Notifications are blocked in this browser", "🚫");
      } else if (!on) {
        toast("Notifications off on this device", "🔕");
      }
    } catch (error) {
      toast(messageOf(error), "⚠️");
    } finally {
      setBusy(false);
    }
  }
  return { state, busy, set };
}

/** The Settings row: a switch, or what to do when this device can't take notifications yet. */
export function PushSetting({ rowClass, iconClass, labelClass }: { rowClass: string; iconClass: string; labelClass: string }) {
  const { state, busy, set } = usePushSwitch();
  return (
    <div className={rowClass} style={{ flexWrap: "wrap" }}>
      <span className={iconClass}>
        <Icon name="bell" />
      </span>
      <b className={labelClass}>Device notifications</b>
      {(state === "on" || state === "off") && (
        <Toggle on={state === "on"} onChange={(on) => !busy && void set(on)} label="Device notifications" />
      )}
      {state && <span className="t-small muted" style={{ flexBasis: "100%", paddingLeft: 48 }}>{EXPLAIN[state]}</span>}
    </div>
  );
}

/** The Notifications page prompt, shown until this device has notifications on. */
export function PushPrompt() {
  const { state, busy, set } = usePushSwitch();
  if (!state || state === "on" || state === "unsupported") return null;
  return (
    <div className="banner banner-blue" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", maxWidth: 760, marginBottom: 14 }}>
      <span aria-hidden="true">🔔</span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong>Get these on your {state === "needs-install" ? "iPhone" : "device"}</strong>
        <div className="t-small" style={{ marginTop: 2 }}>
          {EXPLAIN[state]}
        </div>
      </div>
      {state === "off" && (
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void set(true)}>
          Turn on
        </button>
      )}
    </div>
  );
}
