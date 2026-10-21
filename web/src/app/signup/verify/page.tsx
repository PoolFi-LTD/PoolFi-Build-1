"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useSession } from "@/components/providers";
import { AuthShell } from "@/components/shells";
import { ErrorText, ProgressBar, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { CODE_LENGTH } from "@/lib/signin";
import { haptic, sound } from "@/lib/sound";
import s from "../auth.module.css";

const RESEND_SECONDS = 30;

function Verify() {
  const router = useRouter();
  const params = useSearchParams();
  const to = params.get("to") ?? "";
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
      const { needsProfile } = await api.verifyCode(code);
      setState("verified");
      sound.win();
      haptic([20, 30, 20]);
      await refresh();
      const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
      setTimeout(() => router.replace(needsProfile ? `/signup/profile${nextQuery}` : (next ?? "/home")), 450);
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
    await api.sendCode(to).catch(setError);
    setLeft(RESEND_SECONDS);
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
        <h1 className={s.title}>Enter the {CODE_LENGTH}-digit code</h1>
        <p className={s.sub} style={{ marginBottom: 0 }}>
          Sent to <span style={{ color: "var(--ink)" }}>{to}</span>{" "}
          <button type="button" className={s.link} onClick={() => router.back()}>
            Change
          </button>
        </p>
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

export default function Page() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
