"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Drip } from "@/components/Drip";
import { Icon } from "@/components/Icon";
import { AuthShell } from "@/components/shells";
import { BusyButton, ErrorText, ProgressBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import s from "./auth.module.css";

/** Which sign-in methods are offered, first one by default. Phone needs an SMS provider. */
const METHODS = (process.env.NEXT_PUBLIC_SIGNIN_METHODS ?? "phone,email").split(",").map((m) => m.trim()) as ("phone" | "email")[];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function formatPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("234")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  d = d.slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(" ");
}

function SignUp() {
  const router = useRouter();
  const params = useSearchParams();
  const login = params.get("mode") === "login";
  const next = params.get("next");
  const [method, setMethod] = useState(METHODS[0] ?? "email");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const send = useAction(api.sendCode);

  const valid = method === "phone" ? phone.replace(/\D/g, "").length === 10 : EMAIL.test(email.trim());
  const to = method === "phone" ? `+234 ${phone}` : email.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const sent = await send.run(method === "phone" ? { phone: to } : { email: to });
    if (!sent.ok) return;
    const q = new URLSearchParams({ to, mode: login ? "login" : "signup", ...(next ? { next } : {}) });
    router.push(`/signup/verify?${q}`);
  }

  return (
    <AuthShell>
      <form className={s.column} onSubmit={submit}>
        <div className={s.top}>
          <button type="button" className={s.back} onClick={() => router.push("/")} aria-label="Back">
            <Icon name="back" />
          </button>
          <ProgressBar value={0.25} />
        </div>

        <div className={s.speech}>
          <Drip size={40} />
          <div className={s.bubble}>{login ? "Welcome back! Let's find your account." : "Hi, I'm Drip! I'll get you set up in under a minute."}</div>
        </div>
        <h1 className={s.title}>{method === "phone" ? "What’s your phone number?" : "What’s your email?"}</h1>
        <p className={s.sub}>We&apos;ll {method === "phone" ? "text" : "email"} you a 6-digit code to confirm it&apos;s you.</p>

        {method === "phone" ? (
          <div className={s.phoneRow}>
            <span className={s.country} aria-label="Nigeria, +234">
              🇳🇬 +234
            </span>
            <label className="field" style={{ flex: 1 }}>
              <span className="field-label">Phone number</span>
              <input
                className="input"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="801 234 5678"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                autoFocus
              />
            </label>
          </div>
        ) : (
          <label className="field">
            <span className="field-label">Email address</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </label>
        )}

        {METHODS.length > 1 && (
          <p style={{ marginTop: 18 }}>
            <button type="button" className={s.link} onClick={() => setMethod(method === "phone" ? "email" : "phone")}>
              {method === "phone" ? "Use email instead" : "Use phone number instead"}
            </button>
          </p>
        )}
        <p className={s.terms}>By continuing you agree to PoolFi&apos;s Terms and Privacy Policy.</p>
        <ErrorText error={send.error} />

        <div className={s.footer}>
          <BusyButton type="submit" busy={send.busy} disabled={!valid} className="btn btn-primary btn-block">
            Continue
          </BusyButton>
        </div>
      </form>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SignUp />
    </Suspense>
  );
}
