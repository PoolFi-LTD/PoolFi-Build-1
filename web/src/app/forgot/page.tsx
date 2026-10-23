"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Drip } from "@/components/Drip";
import { Icon } from "@/components/Icon";
import { AuthShell } from "@/components/shells";
import { BusyButton, ErrorText, ProgressBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import s from "../signup/auth.module.css";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Forgot password: we email a link to choose a new one (the only sign-in link PoolFi sends). */
function Forgot() {
  const router = useRouter();
  const [email, setEmail] = useState(useSearchParams().get("email") ?? "");
  const [sent, setSent] = useState(false);
  const send = useAction(api.requestPasswordReset);
  const to = email.trim().toLowerCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!EMAIL.test(to)) return;
    if ((await send.run(to)).ok) setSent(true);
  }

  return (
    <AuthShell>
      <form className={s.column} onSubmit={submit}>
        <div className={s.top}>
          <button type="button" className={s.back} onClick={() => router.back()} aria-label="Back">
            <Icon name="back" />
          </button>
          <ProgressBar value={sent ? 0.6 : 0.3} />
        </div>
        {sent ? (
          <div className="cs-in">
            <Drip size={64} mood="cheer" pop />
            <h1 className={s.title} style={{ marginTop: 12 }}>Check your email</h1>
            <p className={s.sub}>
              If there&apos;s a PoolFi account for <b style={{ color: "var(--ink)" }}>{to}</b>, we&apos;ve sent it a link to choose a new
              password. Open it on this device. It works once and expires soon.
            </p>
            <Link className="btn btn-secondary btn-block" href={`/signup?${new URLSearchParams({ mode: "login", email: to })}`}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className={s.title}>Forgot your password?</h1>
            <p className={s.sub}>Type your email and we&apos;ll send you a link to choose a new one.</p>
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
            <ErrorText error={send.error} />
            <div className={s.footer}>
              <BusyButton type="submit" busy={send.busy} disabled={!EMAIL.test(to)} className="btn btn-primary btn-block">
                Send the link
              </BusyButton>
            </div>
          </>
        )}
      </form>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Forgot />
    </Suspense>
  );
}
