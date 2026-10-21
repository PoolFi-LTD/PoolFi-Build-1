"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Drip } from "@/components/Drip";
import { Icon } from "@/components/Icon";
import { AuthShell } from "@/components/shells";
import { BusyButton, ErrorText, ProgressBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { CODE_LENGTH } from "@/lib/signin";
import s from "./auth.module.css";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function SignUp() {
  const router = useRouter();
  const params = useSearchParams();
  const login = params.get("mode") === "login";
  const next = params.get("next");
  const [email, setEmail] = useState("");
  const send = useAction(api.sendCode);

  const to = email.trim().toLowerCase();
  const valid = EMAIL.test(to);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const sent = await send.run(to);
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
        <h1 className={s.title}>What’s your email?</h1>
        <p className={s.sub}>We&apos;ll email you a {CODE_LENGTH}-digit code to confirm it&apos;s you.</p>

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
