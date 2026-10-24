"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useSession } from "@/components/providers";
import { AuthShell } from "@/components/shells";
import { ErrorText, ProgressBar, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { markActive } from "@/lib/idle";
import { CODE_LENGTH, safeNextPath } from "@/lib/signin";
import { haptic, sound } from "@/lib/sound";
import s from "./auth.module.css";

const RESEND_SECONDS = 30;

/**
 * Typing in a code PoolFi emailed: to finish signing in (after the password), or to
 * unlock an account locked after too many wrong passwords.
 */
export function CodeScreen({ to, purpose }: { to: string; purpose: "sign_in" | "unlock" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const { refresh } = useSession();
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [state, setState] = useState<"idle" | "checking" | "verified" | "wrong">("idle");
  const [error, setError] = useState<unknown>(null);
  const [left, setLeft] = useState(RESEND_SECONDS);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  async function check(code: string) {
    setState("checking");
    setError(null);
    try {
      if (purpose === "unlock") {
        await api.unlockAccount(to, code);
        setState("verified");
        sound.win();
        haptic([20, 30, 20]);
        const q = new URLSearchParams({ mode: "login", email: to, unlocked: "1", ...(next ? { next } : {}) });
        setTimeout(() => router.replace(`/signup?${q}`), 450);
        return;
      }
      const { needsProfile } = await api.verifyCode(code);
      // Just signed in: that's activity, so the idle sign-out starts counting from now.
      markActive(true);
      setState("verified");
      sound.win();
      haptic([20, 30, 20]);
      await refresh();
      const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
      setTimeout(() => router.replace(needsProfile ? `/signup/profile${nextQuery}` : safeNextPath(next)), 450);
    } catch (e) {
      setError(e);
      setState("wrong");
      sound.nope();
      haptic([30, 30, 30]);
      setDigits(Array(CODE_LENGTH).fill(""));
      boxes.current[0]?.focus();
    }
  }

  function enter(index: number, value: string) {
    const typed = value.replace(/\D/g, "");
    if (!typed) return;
    const nextDigits = [...digits];
    // Typing or pasting several digits fills the following boxes too.
    typed.split("").forEach((d, k) => {
      if (index + k < CODE_LENGTH) nextDigits[index + k] = d;
    });
    setDigits(nextDigits);
    if (state === "wrong") setState("idle");
    const filled = Math.min(CODE_LENGTH - 1, index + typed.length);
    boxes.current[filled]?.focus();
    if (nextDigits.every(Boolean)) void check(nextDigits.join(""));
  }

  function key(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      const nextDigits = [...digits];
      nextDigits[index - 1] = "";
      setDigits(nextDigits);
      boxes.current[index - 1]?.focus();
    }
  }

  async function resend() {
    setError(null);
    try {
      await (purpose === "unlock" ? api.resendUnlockCode(to) : api.resendCode());
      setDigits(Array(CODE_LENGTH).fill(""));
      setState("idle");
      setLeft(RESEND_SECONDS);
      boxes.current[0]?.focus();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <AuthShell>
      <div className={s.column}>
        <div className={s.top}>
          <button type="button" className={s.back} onClick={() => router.back()} aria-label="Back">
            <Icon name="back" />
          </button>
          <ProgressBar value={0.5} />
        </div>
        <h1 className={s.title}>{purpose === "unlock" ? "Unlock your account" : `Enter the ${CODE_LENGTH}-digit code`}</h1>
        {purpose === "unlock" ? (
          <p className={s.sub} style={{ marginBottom: 0 }}>
            After too many wrong passwords we locked it to keep it safe. Type the code we emailed to{" "}
            <span style={{ color: "var(--ink)" }}>{to}</span>. Forgot your password?{" "}
            <Link className={s.link} href={`/forgot?${new URLSearchParams({ email: to })}`}>
              Reset it
            </Link>
          </p>
        ) : (
          <p className={s.sub} style={{ marginBottom: 0 }}>
            Sent to <span style={{ color: "var(--ink)" }}>{to}</span>{" "}
            <button type="button" className={s.link} onClick={() => router.back()}>
              Change
            </button>
          </p>
        )}
        <div className={`${s.boxes} ${state === "verified" ? s.verified : ""} ${state === "wrong" ? s.wrong : ""}`}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              className={`${s.box} ${d ? s.filled : ""}`}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              aria-label={`Digit ${i + 1}`}
              value={d}
              autoFocus={i === 0}
              disabled={state === "checking" || state === "verified"}
              onChange={(e) => enter(i, e.target.value)}
              onKeyDown={(e) => key(i, e)}
              onFocus={(e) => e.target.select()}
            />
          ))}
        </div>
        {state === "checking" ? (
          <span className={s.resend} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Spinner size={14} /> Checking…
          </span>
        ) : left > 0 ? (
          <span className={s.resend}>
            Resend code in 0:{String(left).padStart(2, "0")}
          </span>
        ) : (
          <button type="button" className={s.link} onClick={resend} style={{ alignSelf: "flex-start", fontSize: 13 }}>
            Resend code
          </button>
        )}
        <ErrorText error={error} />
      </div>
    </AuthShell>
  );
}
