"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Drip } from "@/components/Drip";
import { Icon } from "@/components/Icon";
import { AuthShell } from "@/components/shells";
import { BusyButton, ErrorText, ProgressBar } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { IDLE_MINUTES } from "@/lib/idle";
import { PasswordField } from "./PasswordField";
import { CODE_LENGTH, MIN_PASSWORD } from "@/lib/signin";
import s from "./auth.module.css";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Sign up and sign in: email and password, then a code we email (the next screen). */
function SignUp() {
  const router = useRouter();
  const params = useSearchParams();
  const login = params.get("mode") !== "signup";
  const next = params.get("next");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const go = useAction((address: string, pw: string) => (login ? api.signIn(address, pw) : api.signUp(address, pw)));

  const to = email.trim().toLowerCase();
  const valid = EMAIL.test(to) && password.length >= (login ? 1 : MIN_PASSWORD);
  const nextQuery: Record<string, string> = next ? { next } : {};

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const done = await go.run(to, password);
    if (!done.ok) {
      if (done.error instanceof ApiError && done.error.code === "account_locked") {
        router.push(`/signup/unlock?${new URLSearchParams({ to, ...nextQuery })}`);
      }
      return;
    }
    router.push(`/signup/verify?${new URLSearchParams({ to, mode: login ? "login" : "signup", ...nextQuery })}`);
  }

  const switchMode = `/signup?${new URLSearchParams({ mode: login ? "signup" : "login", ...(to ? { email: to } : ({} as Record<string, string>)), ...nextQuery })}`;
  const exists = go.error instanceof ApiError && go.error.code === "account_exists";

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
        <h1 className={s.title}>{login ? "Sign in" : "Create your account"}</h1>
        <p className={s.sub}>
          {login
            ? `Your email and password, then a ${CODE_LENGTH}-digit code we email you.`
            : `Choose a password. We'll then email you a ${CODE_LENGTH}-digit code to confirm it's you.`}
        </p>

        <div style={{ display: "grid", gap: 14 }}>
          <label className="field">
            <span className="field-label">Email address</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={!email}
            />
          </label>
          <PasswordField
            label={login ? "Password" : "Create a password"}
            value={password}
            onChange={setPassword}
            autoComplete={login ? "current-password" : "new-password"}
            hint={login ? undefined : `At least ${MIN_PASSWORD} characters.`}
          />
        </div>

        {login && (
          <p style={{ marginTop: 12 }}>
            <Link className={s.link} href={`/forgot?${new URLSearchParams(to ? { email: to } : {})}`}>
              Forgot password?
            </Link>
          </p>
        )}
        {params.get("idle") && !go.error && (
          <p className="banner banner-blue" style={{ marginTop: 12 }}>
            You were signed out after {IDLE_MINUTES} minutes without activity. Sign in to continue.
          </p>
        )}
        {params.get("unlocked") && !go.error && (
          <p className="banner banner-green" style={{ marginTop: 12 }}>
            Your account is unlocked. Sign in again.
          </p>
        )}
        <ErrorText error={go.error} />
        <p style={{ marginTop: 14, fontSize: 14 }}>
          {login ? "New to PoolFi? " : exists ? "" : "Already have an account? "}
          <Link className={s.link} href={switchMode}>
            {login ? "Create an account" : "Sign in"}
          </Link>
        </p>
        {!login && <p className={s.terms}>By continuing you agree to PoolFi&apos;s Terms and Privacy Policy.</p>}

        <div className={s.footer}>
          <BusyButton type="submit" busy={go.busy} disabled={!valid} className="btn btn-primary btn-block">
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
